#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XK3190 console test - quick command-line check of the scale's serial stream
============================================================================

Opens the serial port, frames the XK3190-D10 continuous stream, validates the
checksum of every frame and shows the live weight. Use this first to prove the
cable/baud/port before using the GUI app (xk3190_scale_app.py).

Protocol decoded: Yaohua "continuous communication format 1", 12 bytes/frame
    02 | +|- | 6 weight digits | decimal 0-4 | 2 XOR-checksum chars | 03

Usage:
    py xk3190_console_test.py                       # COM1 @ 9600, Ctrl+C to stop
    py xk3190_console_test.py --seconds 10          # run 10 seconds then stop
    py xk3190_console_test.py --raw                 # print every raw frame
    py xk3190_console_test.py --scan                # try common baud rates
    py xk3190_console_test.py --csv weights.csv     # also log to CSV
    py xk3190_console_test.py --sim --scenario load --seconds 10
                                                    # simulator, no hardware
    py xk3190_simulator.py --list                   # available scenarios

Exit codes: 0 = OK, 2 = port could not be opened (busy/missing), 3 = no data,
            4 = data received but checksum errors detected.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from datetime import datetime

try:
    import serial
except ImportError:
    sys.stderr.write(
        "pyserial is missing. Install it with:  py -m pip install pyserial\n")
    raise SystemExit(1)

STX, ETX = b"\x02", b"\x03"
SCAN_BAUDS = [9600, 1200, 2400, 4800, 19200, 38400, 115200]


def hexdump(data: bytes) -> str:
    return " ".join(f"{b:02X}" for b in data)


def stamp(t: float) -> str:
    return datetime.fromtimestamp(t).strftime("%H:%M:%S.%f")[:-3]


def xor_checksum(payload: bytes) -> bytes:
    x = 0
    for b in payload:
        x ^= b
    return bytes([(0x30 if n <= 9 else 0x37) + n for n in (x >> 4, x & 0x0F)])


def decode_frame(frame: bytes):
    """Return (value, dec, sign, checksum_ok, kind) or None if undecodable."""
    # Yaohua continuous format 1: 12 bytes with checksum
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
    # Other Yaohua continuous formats (frames starting with '=' or '@')
    if frame[:1] in (b"=", b"@"):
        try:
            text = frame.decode("ascii")
        except UnicodeDecodeError:
            return None
        match = re.search(r"\d+(?:\.\d+)?", text)
        if match:
            token = match.group()
            negative = text.rstrip().endswith("-") or "-" in text[:2]
            value = float(("-" if negative else "") + token)
            dec = len(token.split(".")[1]) if "." in token else 0
            return value, dec, "-" if negative else "+", None, "other-format"
    return None


def split_frames(buf: bytes):
    """Return (list_of_complete_frames, remaining_buffer).

    Robust against buffers that start mid-frame: partial prefixes and stray
    ETX bytes left over from a previously truncated frame are discarded.
    """
    frames: list[bytes] = []
    while True:
        i_start = buf.find(STX)
        i_newline = max(buf.find(b"\r"), buf.find(b"\n"))
        # newline-delimited frame (formats without STX) before the next STX
        if i_newline >= 0 and (i_start < 0 or i_newline < i_start):
            chunk = buf[:i_newline + 1].strip(b"\r\n\x00")
            if chunk:
                frames.append(chunk)
            buf = buf[i_newline + 1:]
            continue
        if i_start < 0:
            if len(buf) > 1024:                 # framing garbage guard
                buf = buf[-64:]
            return frames, buf
        if i_start > 0:                         # drop partial-frame prefix
            buf = buf[i_start:]
            continue
        i_end = buf.find(ETX, 1)
        if i_end < 0:                           # frame not complete yet
            if len(buf) > 1024:
                buf = buf[-64:]
            return frames, buf
        frames.append(buf[:i_end + 1])
        buf = buf[i_end + 1:]


def open_or_exit(port: str, baud: int) -> serial.Serial:
    try:
        return serial.Serial(port, baud, bytesize=8, parity="N",
                             stopbits=1, timeout=0.2)
    except Exception as exc:
        msg = str(exc).lower()
        print(f"\nERROR: cannot open {port}: {exc}", file=sys.stderr)
        if "denied" in msg or "access" in msg or "permission" in msg:
            print("HINT: the port is already open by another program "
                  "(usually the weighing software, e.g. Scale Weight.exe).\n"
                  "      Close that program, then run this test again.",
                  file=sys.stderr)
        elif "cannot find" in msg or "no such" in msg or "not found" in msg:
            print("HINT: that port does not exist. Run with --scan, or pick "
                  "an existing COM port.", file=sys.stderr)
        raise SystemExit(2)


def run_once(port: str, baud: int, seconds: float, raw: bool,
             csv_path: str | None, quiet: bool = False,
             sim: dict | None = None):
    """Read one session. Returns a stats dict.

    sim: when given (--sim), the stream comes from the XK3190 simulator
    instead of the serial port - everything from split_frames() onwards is
    the exact same code path used with real hardware.
    """
    source = None
    if sim:
        from xk3190_simulator import IndicatorSimulator
        source = IndicatorSimulator(scenario=sim["scenario"], fps=sim["fps"],
                                    target=sim["target"],
                                    dec=sim.get("dec", 0),
                                    seed=sim.get("seed")).stream()
        sp = None
        label = (f"SIMULATOR  scenario={sim['scenario']}  "
                 f"target={sim['target']:g}  fps={sim['fps']:g}")
    else:
        sp = open_or_exit(port, baud)
        label = f"{port} @ {baud} 8N1"
    st = {"frames": 0, "decoded": 0, "chk_errors": 0, "undecodable": 0,
          "last_value": None, "recent": [], "t0": time.time()}

    file_obj = writer = None
    if csv_path:
        file_obj = open(csv_path, "w", newline="", encoding="utf-8")
        writer = csv.writer(file_obj)
        writer.writerow(["epoch", "local_time", "weight", "decimals", "sign",
                         "checksum", "kind", "raw_hex"])

    if not quiet:
        print(f"--- {label}{'  (raw mode)' if raw else ''}   "
              f"Ctrl+C to stop ---")

    deadline = time.time() + seconds if seconds else None
    buf = b""
    try:
        while True:
            if deadline and time.time() > deadline:
                break
            if source is None:
                data = sp.read(256)
            else:
                data = next(source, None)
                if data is None:                # simulator stream ended
                    break
            if not data:
                continue
            buf += data
            frames, buf = split_frames(buf)
            for frame in frames:
                frame = frame.strip(b"\r\n\x00")
                if not frame:
                    continue
                st["frames"] += 1
                now = time.time()
                st["recent"] = [t for t in st["recent"] if now - t <= 2.0]
                st["recent"].append(now)
                result = decode_frame(frame)

                if result is None:
                    st["undecodable"] += 1
                    if st["undecodable"] <= 10 and not quiet:
                        print(f"\n[!] non-decodable frame: {frame!r}  "
                              f"{hexdump(frame)}")
                    continue

                value, dec, sign, ok, kind = result
                st["decoded"] += 1
                if ok is False:
                    st["chk_errors"] += 1
                text = f"{value:.{dec}f}"
                changed = value != st["last_value"]
                st["last_value"] = value

                if writer:
                    writer.writerow([
                        f"{now:.3f}", stamp(now).replace(",", "."),
                        text, dec, sign,
                        {True: "OK", False: "BAD", None: ""}[ok],
                        kind, hexdump(frame)])

                if not quiet:
                    if raw:
                        print(f"{stamp(now)}  {text:>12}  "
                              f"chk={'OK' if ok else ('BAD' if ok is False else 'n/a')}"
                              f"  {hexdump(frame)}")
                    else:
                        if changed or ok is False:
                            print(f"\n{datetime.fromtimestamp(now):%H:%M:%S}  "
                                  f"weight = {text}   checksum "
                                  f"{'OK' if ok else ('BAD' if ok is False else 'n/a')}")
                        if sys.stdout.isatty():
                            # interactive console: single self-updating line
                            fps = len(st["recent"]) / 2.0
                            sys.stdout.write(
                                f"\r{datetime.fromtimestamp(now):%H:%M:%S}  "
                                f"weight={text:>12}  frames={st['frames']}  "
                                f"fps={fps:5.1f}  chk_err={st['chk_errors']}   ")
                            sys.stdout.flush()
                        elif now - st.get("heartbeat", 0) >= 5.0:
                            # redirected output: plain periodic status line
                            st["heartbeat"] = now
                            print(f"{datetime.fromtimestamp(now):%H:%M:%S}  "
                                  f"weight={text}  frames={st['frames']}  "
                                  f"chk_err={st['chk_errors']}")
    except KeyboardInterrupt:
        if not quiet:
            print("\n(interrupted)")
    finally:
        if sp is not None:
            sp.close()
        if file_obj:
            file_obj.close()

    span = time.time() - st["t0"]
    st["fps"] = st["frames"] / span if span else 0.0
    if not quiet:
        print(f"\n--- {st['frames']} frames in {span:.1f}s "
              f"({st['fps']:.1f} frames/s), {st['decoded']} decoded, "
              f"{st['chk_errors']} checksum errors, "
              f"{st['undecodable']} undecodable, "
              f"last weight = {st['last_value']} ---")
    return st


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Console test for the XK3190-D10 serial stream.")
    p.add_argument("-p", "--port", default="COM1",
                   help="serial port (default COM1)")
    p.add_argument("-b", "--baud", type=int, default=9600,
                   help="baud rate (default 9600)")
    p.add_argument("--seconds", type=float, default=0,
                   help="stop after N seconds (0 = run until Ctrl+C)")
    p.add_argument("--raw", action="store_true", help="print every raw frame")
    p.add_argument("--csv", metavar="FILE", help="write a CSV log of weights")
    p.add_argument("--scan", action="store_true",
                   help="try common baud rates until data appears")
    p.add_argument("--sim", action="store_true",
                   help="read from the built-in XK3190 simulator (no hardware)")
    p.add_argument("--scenario", default="load",
                   help="simulator scenario "
                        "(list them: py xk3190_simulator.py --list)")
    p.add_argument("--target", type=float, default=735.0,
                   help="simulator target weight (default 735)")
    p.add_argument("--fps", type=float, default=15.0,
                   help="simulator frame rate (default 15, the real rate)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    sim = None
    if args.sim:
        from xk3190_simulator import SCENARIOS
        if args.scenario not in SCENARIOS:
            print(f"ERROR: unknown scenario {args.scenario!r}. Choose from: "
                  f"{', '.join(sorted(SCENARIOS))}", file=sys.stderr)
            return 2
        sim = {"scenario": args.scenario, "target": args.target,
               "fps": args.fps}
        if args.scan:
            print("NOTE: --scan applies to real serial ports; ignored with "
                  "--sim.")
            args.scan = False

    if args.scan:
        for baud in SCAN_BAUDS:
            print(f"\n>> trying {args.port} @ {baud} ...")
            try:
                st = run_once(args.port, baud, 4.0, args.raw, None, quiet=True)
            except SystemExit as exc:
                return int(exc.code) if isinstance(exc.code, int) else 2
            if st["frames"]:
                print(f">> data found at {baud} baud - continuing on it.")
                st = run_once(args.port, baud, args.seconds, args.raw, args.csv)
                if st["frames"]:
                    return 4 if st["chk_errors"] else 0
                return 3
            print(f"   no data at {baud}.")
        print("\nNo data at any common baud rate.")
        print("Check: indicator continuous-output setting, cable wiring "
              "(pins 2/3/5), and that the indicator is actually sending.")
        return 3

    st = run_once(args.port, args.baud, args.seconds, args.raw, args.csv,
                  sim=sim)
    if not st["frames"]:
        if sim:
            print("NO DATA from the simulator (unexpected - please report).")
        else:
            print("NO DATA received on the port.")
            print("Hints: enable continuous output on the indicator, check the "
                  "cable (pins 2/3/5), or run with --scan to try other baud "
                  "rates.")
        return 3
    if st["chk_errors"]:
        print(f"WARNING: {st['chk_errors']} frames failed checksum validation.")
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
