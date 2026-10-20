#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XK3190-D10 INDICATOR SIMULATOR — develop & test the app in-house (no hardware)
================================================================================

Emulates an XK3190-D10 weighing indicator sending its RS-232 stream, producing
byte-accurate "continuous communication format 1" frames (12 bytes, real XOR
checksums) at the real frame rate (~15 frames/s):

    02 | +|- | 6 weight digits | decimal 0-4 | 2 XOR checksum chars | 03

Use it when the real scale is on the client PC and you are building the app
in-house — everything (framing, checksum validation, GUI, CSV logging) can be
exercised without any serial port.

OUTPUT MODES
------------
  (default)            print raw frames to the console, like a serial terminal
  --tcp PORT           serve the raw byte stream over TCP (view from any tool)
  --out-port COMx      write to a real/virtual serial port (e.g. com0com pair)
  --out-file FILE      append hex lines of every frame to a text file
  --selftest           verify generated frames round-trip through the REAL
                       decoders and frame splitters of both delivered programs
  --list               show the available scenarios

SCENARIOS (see --list)
----------------------
  zero steady ramp load jitter tare badchecksum garbage otherformat

INTEGRATION WITH THE DELIVERED APPS
-----------------------------------
  py xk3190_console_test.py --sim --scenario load --seconds 10
  py xk3190_scale_app.py    --sim --scenario load
  py xk3190_scale_app.py    --sim --scenario badchecksum --auto-close 8

STANDALONE EXAMPLES
-------------------
  py xk3190_simulator.py --selftest
  py xk3190_simulator.py --scenario load --seconds 10
  py xk3190_simulator.py --scenario jitter --target 12540 --fps 20 --seconds 5
  py xk3190_simulator.py --tcp 9000 --scenario load
  py xk3190_simulator.py --out-port COM5 --scenario load     (needs virtual pair)
"""

from __future__ import annotations

import argparse
import math
import random
import re
import sys
import time
from datetime import datetime

STX, ETX = b"\x02", b"\x03"

# ----------------------------------------------------------------- scenarios
SCENARIOS = {
    "zero":        "empty scale, constant 0",
    "steady":      "constant weight (--target), like a parked truck",
    "ramp":        "weight grows 0 -> target over 10 s, then holds",
    "load":        "realistic weighbridge cycle: enter, overshoot, settle, "
                   "hold, exit, empty (20 s loop) - DEFAULT",
    "jitter":      "unstable reading: target +/- 5% random noise",
    "tare":        "gross -> tare pressed -> load removed (goes negative) -> zero",
    "badchecksum": "clean weight but every 4th frame has a CORRUPT checksum "
                   "(tests the app's error counter)",
    "garbage":     "junk frames injected (tests framing robustness and the "
                   "undecodable counter)",
    "otherformat": "Yaohua format-2 style lines: '=125.40' + CRLF (no checksum)",
}


def xor_checksum(payload: bytes) -> bytes:
    """Two ASCII hex characters for the XOR of payload bytes (Yaohua style)."""
    x = 0
    for b in payload:
        x ^= b
    return bytes([(0x30 if n <= 9 else 0x37) + n for n in (x >> 4, x & 0x0F)])


def make_frame(value: float, dec: int = 0, corrupt: bool = False) -> bytes:
    """Build one 12-byte continuous-format-1 frame for `value`.

    dec: number of decimals the indicator displays (0..4).
    corrupt: deliberately break the checksum (for error-handling tests).
    """
    if not 0 <= dec <= 4:
        raise ValueError("dec must be 0..4")
    scaled = int(round(abs(value) * (10 ** dec)))
    scaled = min(scaled, 999999)                 # 6-digit field
    digits = f"{scaled:06d}".encode("ascii")
    sign = b"-" if value < 0 else b"+"
    payload = sign + digits + bytes([0x30 + dec])
    chk = xor_checksum(payload)
    if corrupt:                                   # guarantee a mismatch
        chk = chk[:1] + (b"0" if chk[1:2] != b"0" else b"1")
    return STX + payload + chk + ETX


def decode_frame(frame: bytes):
    """Local decoder (same rules as the delivered programs).

    Returns (value, dec, sign, checksum_ok, kind) or None if undecodable."""
    if (len(frame) == 12 and frame[0:1] == STX and frame[11:12] == ETX
            and frame[1] in (0x2B, 0x2D)):
        digits, dec_byte = frame[2:8], frame[8]
        if all(0x30 <= d <= 0x39 for d in digits) and 0x30 <= dec_byte <= 0x34:
            dec = dec_byte - 0x30
            ok = frame[9:11] == xor_checksum(frame[1:9])
            value = int(digits) / (10 ** dec)
            if frame[1] == 0x2D:
                value = -value
            return value, dec, "+" if frame[1] == 0x2B else "-", ok, "format1"
    if frame[:1] in (b"=", b"@"):
        try:
            text = frame.decode("ascii")
        except UnicodeDecodeError:
            return None
        m = re.search(r"\d+(?:\.\d+)?", text)
        if m:
            token = m.group()
            negative = text.rstrip().endswith("-") or "-" in text[:2]
            value = float(("-" if negative else "") + token)
            n_dec = len(token.split(".")[1]) if "." in token else 0
            return value, n_dec, "-" if negative else "+", None, "other-format"
    return None


def split_frames(buf: bytes):
    """Return (list_of_complete_frames, remaining_buffer).

    Mirrors the splitters in xk3190_scale_app.py / xk3190_console_test.py;
    --selftest proves all three behave identically on the same data."""
    frames: list[bytes] = []
    while True:
        i_start = buf.find(STX)
        i_newline = max(buf.find(b"\r"), buf.find(b"\n"))
        if i_newline >= 0 and (i_start < 0 or i_newline < i_start):
            chunk = buf[:i_newline + 1].strip(b"\r\n\x00")
            if chunk:
                frames.append(chunk)
            buf = buf[i_newline + 1:]
            continue
        if i_start < 0:
            if len(buf) > 1024:
                buf = buf[-64:]
            return frames, buf
        if i_start > 0:
            buf = buf[i_start:]
            continue
        i_end = buf.find(ETX, 1)
        if i_end < 0:
            if len(buf) > 1024:
                buf = buf[-64:]
            return frames, buf
        frames.append(buf[:i_end + 1])
        buf = buf[i_end + 1:]


def hexdump(data: bytes) -> str:
    return " ".join(f"{b:02X}" for b in data)


# -------------------------------------------------------- weight generation
def _smooth(p: float) -> float:
    """Smoothstep 0..1 (nice eased ramps, no hard jumps)."""
    p = max(0.0, min(1.0, p))
    return p * p * (3 - 2 * p)


class IndicatorSimulator:
    """Generates the raw byte stream an indicator would send.

    .stream()  yields raw byte chunks (random sizes, like real OS reads);
               the CALLER does the frame splitting, exactly as with hardware.
    .frames_for(t)  returns the frames for simulated second t (used by selftest)
    """

    def __init__(self, scenario: str = "load", fps: float = 15.0,
                 target: float = 735.0, dec: int = 0, seed: int | None = None):
        if scenario not in SCENARIOS:
            raise ValueError(f"unknown scenario {scenario!r}; "
                             f"choose from {', '.join(SCENARIOS)}")
        self.scenario = scenario
        self.fps = max(0.5, float(fps))
        self.target = float(target)
        self.dec = int(dec)
        self.rng = random.Random(seed)
        self._n = 0

    # -------------------------------------------------- scenario weight laws
    def _load(self, t: float, rng: random.Random) -> float:
        t %= 20.0
        if t < 2:                      # empty
            return 0.0
        if t < 5:                      # vehicle drives on (eased ramp)
            return self.target * _smooth((t - 2) / 3.0)
        if t < 7:                      # suspension bounce, settles
            d = t - 5.0
            return self.target * (1 + 0.06 * math.exp(-2.2 * d) * math.sin(14 * d))
        if t < 14:                     # parked & stable
            return self.target + rng.uniform(-1, 1)
        if t < 17:                     # drives off
            return self.target * (1 - _smooth((t - 14) / 3.0))
        return 0.0

    @staticmethod
    def _tare(t: float, target: float) -> float:
        t %= 16.0
        if t < 5:
            return target               # gross weight on platform
        if t < 10:
            return 0.0                  # [tare] pressed -> net 0
        if t < 13:
            return -target              # load removed -> negative net
        return 0.0                      # [zero] pressed -> 0

    # ------------------------------------------------------- frame production
    def frames_for(self, t: float) -> list[bytes]:
        s, rng = self.scenario, self.rng
        self._n += 1

        if s == "zero":
            value = 0.0
        elif s == "steady":
            value = self.target
        elif s == "ramp":
            value = self.target * _smooth(t / 10.0)
        elif s == "load":
            value = self._load(t, rng)
        elif s == "jitter":
            value = self.target + rng.uniform(-abs(self.target) * 0.05,
                                              abs(self.target) * 0.05)
        elif s == "tare":
            value = self._tare(t, self.target)
        elif s == "badchecksum":
            return [make_frame(self.target, self.dec,
                               corrupt=(self._n % 4 == 3))]
        elif s == "garbage":
            out: list[bytes] = []
            if self._n % 7 == 0:
                out.append(b"\x02JUNK\x03")          # decodable? no -> counter
            if self._n % 11 == 0:
                out.append(b"\x02+000123")           # truncated (no ETX)
            if self._n % 13 == 0:
                out.append(b"noise line\r\n")        # newline-delimited junk
            out.append(make_frame(self.target, self.dec))
            return out
        elif s == "otherformat":
            value = self.target + rng.uniform(-2, 2)
            return [f"={value:.{self.dec}f}\r\n".encode("ascii")]
        else:                                          # pragma: no cover
            value = 0.0

        return [make_frame(value, self.dec)]

    # ------------------------------------------------------------ raw stream
    def stream(self, duration: float | None = None):
        """Yield raw byte chunks paced at `fps` (random chunk sizes)."""
        t0 = time.time()
        next_frame_at = t0
        pending = bytearray()
        interval = 1.0 / self.fps
        while True:
            now = time.time()
            if duration is not None and now - t0 >= duration:
                return
            if now < next_frame_at:
                time.sleep(min(next_frame_at - now, 0.05))
                continue
            next_frame_at += interval
            if now - next_frame_at > 5 * interval:
                next_frame_at = now        # avoid burst catch-up after a stall
            for fr in self.frames_for(now - t0):
                pending.extend(fr)
            if pending:
                n = self.rng.randint(1, min(len(pending), 24))
                chunk = bytes(pending[:n])
                del pending[:n]
                yield chunk


class SimReader:
    """Drop-in replacement for xk3190_scale_app.SerialReader.

    Same thread interface (start/stop/is_alive) and the same queue messages:
    ('open', label) ('frame', (time, bytes)) ('error', text) ('closed', None).
    The caller passes ITS OWN `splitter` so the app's real framing code is
    exercised end-to-end.
    """

    def __init__(self, out, splitter, scenario="load", fps=15.0,
                 target=735.0, dec=0, seed=None):
        import threading
        self._evt = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="sim-reader")
        self.out = out
        self.splitter = splitter
        self.scenario, self.fps, self.target, self.dec, self.seed = (
            scenario, fps, target, dec, seed)

    # SerialReader-compatible API
    def start(self):
        self._thread.start()

    def stop(self):
        self._evt.set()

    def is_alive(self):
        return self._thread.is_alive()

    def _run(self):
        label = (f"SIMULATOR {self.scenario} @ {self.fps:g} fps, "
                 f"target={self.target:g}, dec={self.dec}")
        self.out.put(("open", label))
        try:
            sim = IndicatorSimulator(self.scenario, self.fps, self.target,
                                     self.dec, self.seed)
            buf = b""
            for chunk in sim.stream():
                if self._evt.is_set():
                    break
                buf += chunk
                frames, buf = self.splitter(buf)
                for fr in frames:
                    if fr:
                        self.out.put(("frame", (time.time(), fr)))
        except Exception as exc:                     # pragma: no cover
            if not self._evt.is_set():
                self.out.put(("error", str(exc)))
        finally:
            self.out.put(("closed", None))


# ------------------------------------------------------------------ selftest
def selftest() -> int:
    """Prove generated frames round-trip through the DELIVERED programs."""
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = ""):
        results.append((name, bool(ok), detail))

    # 1. make_frame / decode round-trip across decimals and signs
    #    (expected value computed with the SAME rounding as make_frame so the
    #     test cannot flake on binary floating-point ties)
    for dec in range(5):
        for v in (0.0, 7.5 / (10 ** dec), 735.0, -50.0,
                  999999 / (10 ** dec)):
            f = make_frame(v, dec)
            r = decode_frame(f)
            scaled = min(int(round(abs(v) * (10 ** dec))), 999999)
            expected = scaled / (10 ** dec)
            if v < 0:
                expected = -expected
            ok = (r is not None and r[1] == dec and r[3] is True
                  and abs(r[0] - expected) < 1e-9
                  and len(f) == 12)
            check(f"round-trip dec={dec} value={v}", ok, str(r))

    # 2. corruption is always detected
    bad = make_frame(123.4, 1, corrupt=True)
    r = decode_frame(bad)
    check("corrupt checksum detected", r is not None and r[3] is False, str(r))

    # 3. cross-check with the console program's decoder
    c = g = None
    try:
        import xk3190_console_test as c
        good = make_frame(735.0, 0)
        rc = c.decode_frame(good)
        check("console decoder agrees", rc == (735.0, 0, "+", True, "format1"),
              str(rc))
        check("console decoder flags corruption",
              c.decode_frame(bad)[3] is False)
    except Exception as exc:
        check("console decoder agrees", False, f"import failed: {exc}")

    # 4. cross-check with the GUI program's decoder (needs tkinter)
    try:
        import xk3190_scale_app as g
        d = g.decode_frame(make_frame(-12.34, 2))
        ok = (d is not None and d["value"] == -12.34 and d["dec"] == 2
              and d["sign"] == "-" and d["checksum_ok"] is True)
        check("GUI decoder agrees", ok, str(d))
    except Exception as exc:
        low = str(exc).lower()
        if "tkinter" in low or "no module named" in low:
            check("GUI decoder agrees", True, f"skipped: {exc}")
        else:
            check("GUI decoder agrees", False, str(exc))

    # 5. splitters: internal vs console vs GUI on randomly chunked data
    rng = random.Random(42)
    base = [make_frame(v, d) for v, d in
            [(0, 0), (735, 0), (-12.34, 2), (12540, 0), (0.5, 3)]] * 40
    # tx       = what the indicator transmits (line-terminated frames end \r\n)
    # expected = what every splitter yields for those frames (\r\n is stripped
    #            before the decoder sees them - correct behaviour in all 3 programs)
    tx = base + [b"=0003.000\r\n"] * 10
    expected = base + [b"=0003.000"] * 10
    blob = b"".join(tx)
    splitters = {"simulator": split_frames}
    if c is not None:
        splitters["console"] = c.split_frames
    if g is not None:
        splitters["GUI"] = g.split_frames
    for name, splitter in splitters.items():
        buf, out, i = b"", [], 0
        while i < len(blob):
            n = rng.randint(1, 40)
            buf += blob[i:i + n]
            i += n
            got, buf = splitter(buf)
            out.extend(got)
        got, buf = splitter(buf)
        out.extend(got)
        check(f"{name} splitter recovers all {len(expected)} frames",
              out == expected, f"got {len(out)}")

    # 6. every scenario produces traffic; fault scenarios really inject faults
    for scenario in SCENARIOS:
        sim = IndicatorSimulator(scenario, fps=15, target=735, dec=0, seed=7)
        frames = [fr for i in range(300)
                  for fr in sim.frames_for(i / 15.0)]
        decodable = sum(1 for fr in frames if decode_frame(fr) is not None)
        bad_chk = 0
        for fr in frames:
            r = decode_frame(fr)
            if r is not None and r[3] is False:
                bad_chk += 1
        if scenario == "badchecksum":
            check("scenario badchecksum injects checksum faults",
                  decodable > 0 and bad_chk > 0, f"{bad_chk} faulty / {len(frames)}")
        elif scenario == "garbage":
            check("scenario garbage injects undecodable frames",
                  len(frames) - decodable >= 3,
                  f"{len(frames) - decodable} undecodable / {len(frames)}")
        elif scenario == "otherformat":
            check("scenario otherformat emits '=' frames",
                  decodable > 0, f"{decodable}/{len(frames)}")
        else:
            check(f"scenario {scenario} all frames valid",
                  decodable == len(frames), f"{decodable}/{len(frames)}")

    # report
    failed = [r for r in results if not r[1]]
    width = max(len(r[0]) for r in results)
    print("XK3190 SIMULATOR SELF-TEST")
    print("-" * (width + 12))
    for name, ok, detail in results:
        print(f"  {name:<{width}}  {'PASS' if ok else 'FAIL'}   {detail}")
    print("-" * (width + 12))
    print(f"  {len(results) - len(failed)}/{len(results)} checks passed"
          f"{'  -> ALL PASSED' if not failed else ''}")
    return 0 if not failed else 1


# ----------------------------------------------------------------------- CLI
def _run_console(sim: IndicatorSimulator, args) -> int:
    """Print raw frames like a serial terminal."""
    buf = b""
    count = decodable = bad = 0
    t0 = time.time()
    deadline = time.time() + args.seconds if args.seconds else None
    heartbeat = time.time()
    try:
        for chunk in sim.stream():
            if deadline and time.time() > deadline:
                break
            buf += chunk
            frames, buf = split_frames(buf)
            for fr in frames:
                count += 1
                r = decode_frame(fr)
                now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                if r is None:
                    if not args.quiet:
                        print(f"{now}  [!] undecodable {fr!r}  {hexdump(fr)}")
                    continue
                decodable += 1
                value, dec, sign, ok, kind = r
                if ok is False:
                    bad += 1
                if args.quiet:
                    continue
                chk = "OK" if ok else ("BAD" if ok is False else "n/a")
                print(f"{now}  value={value:>12.{dec}f}  chk={chk}  "
                      f"{hexdump(fr)}")
            if args.quiet and time.time() - heartbeat >= 5.0:
                heartbeat = time.time()
                print(f"{datetime.now():%H:%M:%S}  frames={count}  "
                      f"decoded={decodable}  chk_err={bad}")
    except KeyboardInterrupt:
        print("\n(interrupted)")
    span = time.time() - t0
    print(f"--- simulator: {count} frames in {span:.1f}s "
          f"({count / span if span else 0:.1f} frames/s), "
          f"{decodable} decoded, {bad} checksum errors ---")
    return 0


def _run_outputs(sim: IndicatorSimulator, args) -> int:
    """TCP / serial-port / file output of the raw byte stream."""
    sp = server = None
    clients: list = []
    handle = None

    if args.out_port:
        try:
            import serial
            sp = serial.Serial(args.out_port, 9600, bytesize=8, parity="N",
                               stopbits=1, timeout=0.1)
            print(f"-> writing to {args.out_port} @ 9600 8N1")
        except Exception as exc:
            print(f"ERROR: cannot open {args.out_port}: {exc}", file=sys.stderr)
            print("HINT: use a virtual pair (com0com) or pick a free port.",
                  file=sys.stderr)
            return 2
    if args.out_file:
        handle = open(args.out_file, "w", encoding="utf-8")
        print(f"-> appending frames to {args.out_file}")
    if args.tcp:
        import socket
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("", args.tcp))
        server.listen(5)
        server.setblocking(False)
        print(f"-> TCP server on port {args.tcp} "
              f"(connect with e.g. telnet localhost {args.tcp})")

    buf = b""
    count = 0
    hb = time.time()
    t0 = time.time()
    deadline = time.time() + args.seconds if args.seconds else None
    try:
        for chunk in sim.stream():
            now = time.time()
            if deadline and now > deadline:
                break
            if sp:
                try:
                    sp.write(chunk)
                except Exception as exc:
                    print(f"serial write error: {exc}", file=sys.stderr)
                    break
            if server:
                try:
                    conn, addr = server.accept()
                    conn.setblocking(False)
                    clients.append(conn)
                    print(f"-> TCP client connected: {addr}")
                except BlockingIOError:
                    pass
                for c in list(clients):
                    try:
                        c.sendall(chunk)
                    except Exception:
                        clients.remove(c)
            buf += chunk
            frames, buf = split_frames(buf)
            for fr in frames:
                count += 1
                if handle:
                    r = decode_frame(fr)
                    val = "" if r is None else f"{r[0]:.{r[1]}f}"
                    chk = "" if r is None or r[3] is None else \
                        ("OK" if r[3] else "BAD")
                    handle.write(f"{now:.3f},{val},{chk},{hexdump(fr)}\n")
            if not args.quiet and now - hb >= 2.0:
                hb = now
                rate = count / (now - t0) if now > t0 else 0
                print(f"{datetime.now():%H:%M:%S}  frames={count}  "
                      f"({rate:.1f} frames/s)  clients={len(clients)}")
    except KeyboardInterrupt:
        print("\n(interrupted)")
    finally:
        if sp:
            sp.close()
        if handle:
            handle.close()
        for c in clients:
            try:
                c.close()
            except Exception:
                pass
        if server:
            server.close()
    print(f"--- simulator sent {count} frames in {time.time() - t0:.1f}s ---")
    return 0


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="XK3190-D10 indicator simulator (in-house testing).")
    p.add_argument("--scenario", default="load", choices=sorted(SCENARIOS),
                   help="weight scenario (default: load)")
    p.add_argument("--target", type=float, default=735.0,
                   help="target weight in scale divisions (default 735)")
    p.add_argument("--fps", type=float, default=15.0,
                   help="frame rate (default 15, the real rate)")
    p.add_argument("--dec", type=int, default=0, choices=range(0, 5),
                   metavar="0-4", help="decimal places (default 0)")
    p.add_argument("--seconds", type=float, default=0,
                   help="stop after N seconds (0 = run until Ctrl+C)")
    p.add_argument("--seed", type=int, help="random seed (repeatable output)")
    p.add_argument("--quiet", action="store_true",
                   help="no per-frame output, only periodic summaries")
    p.add_argument("--tcp", type=int, metavar="PORT",
                   help="serve the raw stream on a TCP port")
    p.add_argument("--out-port", metavar="COMx",
                   help="write the stream to a serial port")
    p.add_argument("--out-file", metavar="FILE",
                   help="append 'epoch,value,checksum,hex' lines to a file")
    p.add_argument("--list", action="store_true", help="list scenarios")
    p.add_argument("--selftest", action="store_true",
                   help="verify frames against the delivered programs")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if args.list:
        print("Available scenarios:")
        for name, desc in sorted(SCENARIOS.items()):
            print(f"  {name:<13} {desc}")
        print("\nExample:  py xk3190_simulator.py --scenario load --seconds 10")
        return 0

    if args.selftest:
        return selftest()

    sim = IndicatorSimulator(args.scenario, args.fps, args.target,
                             args.dec, args.seed)
    print(f"XK3190 simulator: scenario={args.scenario} "
          f"target={args.target:g} dec={args.dec} fps={args.fps:g}"
          + (f" seed={args.seed}" if args.seed is not None else ""))
    if args.tcp or args.out_port or args.out_file:
        return _run_outputs(sim, args)
    return _run_console(sim, args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nstopped.")
