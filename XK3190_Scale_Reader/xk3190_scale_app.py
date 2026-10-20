#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XK3190 Scale Reader - live RS-232 viewer for XK3190-D10 weighing indicators
============================================================================

Reads the weight stream produced by an XK3190-D10 (and compatible Yaohua)
weighing indicator connected to the PC over RS-232 (DB9).

Supported protocol: Yaohua "continuous communication format 1", 12 bytes/frame:

    byte  1      0x02 (STX)
    byte  2      sign: '+' or '-'
    bytes 3-8    weight digits (6 digits, high digit first)
    byte  9      decimal places, ASCII '0'..'4'
    bytes 10-11  XOR checksum of bytes 2..9, two hex ASCII characters
                 (nibble <= 9 -> 0x30 + n, else 0x37 + n)
    byte 12      0x03 (ETX)

Other Yaohua continuous formats (frames starting with '=') are also displayed
without checksum validation.

Usage:
    py xk3190_scale_app.py                    start the GUI (normal use)
    py xk3190_scale_app.py --port COM1 --baud 9600
    py xk3190_scale_app.py --auto-close 10    self-test: run 10 s, print
                                              a summary to the console, exit
    py xk3190_scale_app.py --sim --auto-close 10
                                              same self-test fed by the built-in
                                              simulator (NO hardware needed;
                                              works even while another program
                                              is using COM1)
    py xk3190_scale_app.py --sim --scenario load
                                              GUI driven by the simulator
    py xk3190_simulator.py --list             show the scenarios

NOTE: a serial port can only be opened by ONE program at a time. If your
weighing software (e.g. "Scale Weight.exe") is using COM1, close it first -
or use --sim to develop/test without touching COM1 at all.
"""

from __future__ import annotations

import argparse
import csv
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime

# ---------------------------------------------------------------- dependencies
try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "pyserial is not installed.\n"
        "Install it with:   py -m pip install pyserial\n")
    raise SystemExit(1)

import tkinter as tk
from tkinter import ttk

# ------------------------------------------------------------------ constants
STX = b"\x02"
ETX = b"\x03"
BAUD_RATES = ["1200", "2400", "4800", "9600", "19200", "38400", "115200"]
DEFAULT_BAUD = "9600"
NO_DATA_HINT = ("No data yet - check that the indicator is in continuous "
                "output mode, the cable is on the right pins (2/3/5) and the "
                "baud rate matches the indicator (usually 9600).")
BUSY_HINT = ("If access is denied, another program (usually the weighing "
             "software, e.g. Scale Weight.exe) is holding the port. "
             "Close it, then press Connect again.")


def hexdump(data: bytes) -> str:
    return " ".join(f"{b:02X}" for b in data)


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


def xor_checksum(payload: bytes) -> bytes:
    """Two ASCII hex characters for the XOR of payload bytes (Yaohua style)."""
    x = 0
    for b in payload:
        x ^= b
    return bytes([(0x30 if n <= 9 else 0x37) + n for n in (x >> 4, x & 0x0F)])


def decode_frame(frame: bytes):
    """Decode one frame.

    Returns a dict: kind, value, dec, sign, checksum_ok (True/False/None),
    chk (text) - or None when the frame cannot be decoded.
    """
    # --- Yaohua continuous format 1 (12 bytes, checksummed) -----------------
    if (len(frame) == 12 and frame[0:1] == STX and frame[11:12] == ETX
            and frame[1] in (0x2B, 0x2D)):
        digits, dec_byte = frame[2:8], frame[8]
        if all(0x30 <= d <= 0x39 for d in digits) and 0x30 <= dec_byte <= 0x34:
            dec = dec_byte - 0x30
            ok = frame[9:11] == xor_checksum(frame[1:9])
            value = int(digits) / (10 ** dec)
            if frame[1] == 0x2D:
                value = -value
            return {
                "kind": "format1",
                "value": value,
                "dec": dec,
                "sign": "+" if frame[1] == 0x2B else "-",
                "checksum_ok": ok,
                "chk": frame[9:11].decode("ascii", "replace"),
            }

    # --- other Yaohua continuous formats (start '=' or '@') ----------------
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
            return {
                "kind": "other-format",
                "value": value,
                "dec": dec,
                "sign": "-" if negative else "+",
                "checksum_ok": None,
                "chk": "n/a",
            }
    return None


def format_value(value: float, dec: int) -> str:
    return f"{value:.{dec}f}"


# --------------------------------------------------------------- reader thread
class SerialReader(threading.Thread):
    """Background thread: opens the port, frames the stream, posts messages."""

    def __init__(self, port: str, baud: int, out: "queue.Queue"):
        super().__init__(daemon=True, name="serial-reader")
        self.port = port
        self.baud = baud
        self.out = out
        self.stop_event = threading.Event()

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        try:
            sp = serial.Serial(self.port, self.baud, bytesize=8, parity="N",
                               stopbits=1, timeout=0.2)
        except Exception as exc:  # SerialException, PermissionError, ...
            self.out.put(("error", str(exc)))
            return

        self.out.put(("open", f"{self.port} @ {self.baud} 8N1"))
        buf = b""
        try:
            while not self.stop_event.is_set():
                data = sp.read(256)
                if not data:
                    continue
                buf += data
                frames, buf = split_frames(buf)
                for frame in frames:
                    self.out.put(("frame", (time.time(), frame)))
        except Exception as exc:
            if not self.stop_event.is_set():
                self.out.put(("error", str(exc)))
        finally:
            try:
                sp.close()
            except Exception:
                pass
            self.out.put(("closed", None))


# --------------------------------------------------------------------- the GUI
class ScaleApp:
    POLL_MS = 50
    STATS_MS = 500
    NO_DATA_AFTER_S = 4.0

    def __init__(self, root: tk.Tk, log_dir: str, port: str | None,
                 baud: str | None, auto_close: float | None = None,
                 sim: dict | None = None):
        self.root = root
        self.log_dir = log_dir
        self.reader: SerialReader | None = None
        self.messages: queue.Queue = queue.Queue()
        self.frames = 0
        self.checksum_errors = 0
        self.undecodable = 0
        self.last_value = None
        self.last_dec = 0
        self.last_frame_hex = ""
        self.frame_times: list[float] = []
        self.fps = 0.0
        self.opened_at: float | None = None
        self.warned_no_data = False
        self.csv_file = None
        self.csv_writer = None
        self.csv_path: str | None = None
        self.auto_close = auto_close
        self.sim = sim                  # simulator config (see --sim), or None

        self._build_ui(port or "COM1", baud or DEFAULT_BAUD)
        self.refresh_ports(select=port)
        root.protocol("WM_DELETE_WINDOW", self.shutdown)
        root.after(self.POLL_MS, self.poll)
        root.after(self.STATS_MS, self.update_stats)
        self.connect()                       # start reading immediately
        if auto_close:
            root.after(int(auto_close * 1000), self.self_test_quit)

    # ------------------------------------------------------------- UI building
    def _build_ui(self, port: str, baud: str) -> None:
        root = self.root
        root.title("XK3190 Scale Reader - COM weight viewer")
        root.geometry("760x640")
        root.minsize(640, 520)

        style = ttk.Style(root)
        try:
            style.theme_use("vista")
        except Exception:
            pass

        top = ttk.Frame(root, padding=10)
        top.pack(fill="x")

        ttk.Label(top, text="Port").grid(row=0, column=0, sticky="w")
        self.port_var = tk.StringVar(value=port)
        self.port_box = ttk.Combobox(top, textvariable=self.port_var,
                                     values=["COM1"], width=10, state="readonly")
        self.port_box.grid(row=0, column=1, padx=(4, 10))

        ttk.Button(top, text="Refresh", command=self.refresh_ports).grid(
            row=0, column=2, padx=(0, 10))

        ttk.Label(top, text="Baud").grid(row=0, column=3, sticky="w")
        self.baud_var = tk.StringVar(value=baud)
        self.baud_box = ttk.Combobox(top, textvariable=self.baud_var,
                                     values=BAUD_RATES, width=8, state="readonly")
        self.baud_box.grid(row=0, column=4, padx=(4, 10))

        self.connect_btn = ttk.Button(top, text="Connect", command=self.toggle)
        self.connect_btn.grid(row=0, column=5, padx=(0, 10))

        self.csv_btn = ttk.Button(top, text="Start CSV log",
                                  command=self.toggle_csv, state="disabled")
        self.csv_btn.grid(row=0, column=6)

        # status line
        self.status_var = tk.StringVar(value="Disconnected")
        self.status_lbl = ttk.Label(root, textvariable=self.status_var,
                                    foreground="#555555", padding=(10, 0))
        self.status_lbl.pack(fill="x")

        # weight display
        weight_frame = ttk.Frame(root, padding=(10, 6))
        weight_frame.pack(fill="x")
        self.weight_var = tk.StringVar(value="---.---")
        ttk.Label(weight_frame, textvariable=self.weight_var,
                  font=("Consolas", 54, "bold"), anchor="center").pack(fill="x")
        self.detail_var = tk.StringVar(value="waiting for connection")
        ttk.Label(weight_frame, textvariable=self.detail_var,
                  font=("Consolas", 11), anchor="center",
                  foreground="#333333").pack(fill="x")

        # statistics
        stats = ttk.Frame(root, padding=10)
        stats.pack(fill="x")
        self.stat_vars = {}
        for i, (key, label) in enumerate([
                ("frames", "Frames"), ("fps", "Frames/s"),
                ("chk_err", "Checksum errors"), ("bad", "Undecodable"),
                ("port", "Connection")]):
            cell = ttk.Frame(stats)
            cell.grid(row=0, column=i, padx=6, sticky="w")
            ttk.Label(cell, text=label, foreground="#666666",
                      font=("Segoe UI", 9)).pack(anchor="w")
            var = tk.StringVar(value="-")
            ttk.Label(cell, textvariable=var,
                      font=("Segoe UI", 12, "bold")).pack(anchor="w")
            self.stat_vars[key] = var

        # raw frame log
        log_frame = ttk.Frame(root, padding=(10, 0, 10, 10))
        log_frame.pack(fill="both", expand=True)
        ttk.Label(log_frame, text="Raw frames (newest last)",
                  foreground="#666666").pack(anchor="w")
        self.log = tk.Text(log_frame, height=12, wrap="none",
                           font=("Consolas", 10), state="disabled")
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log.pack(fill="both", expand=True, side="left")

        self.log.tag_configure("bad", foreground="#b00020")
        self.log.tag_configure("info", foreground="#1a5fb4")

    # ---------------------------------------------------------------- actions
    def refresh_ports(self, select: str | None = None) -> None:
        ports = [p.device for p in list_ports.comports()] or ["COM1"]
        self.port_box.configure(values=ports)
        current = select or self.port_var.get()
        if current not in ports:
            current = ports[0]
        self.port_var.set(current)

    def toggle(self) -> None:
        if self.reader and self.reader.is_alive():
            self.disconnect()
        else:
            self.connect()

    def connect(self) -> None:
        port = self.port_var.get()
        try:
            baud = int(self.baud_var.get())
        except ValueError:
            baud = 9600
        self.frames = self.checksum_errors = self.undecodable = 0
        self.last_value = None
        self.frame_times.clear()
        self.warned_no_data = False
        self.opened_at = time.time()
        if self.sim:
            # simulator: same queue message protocol as SerialReader, and it
            # uses THIS program's own split_frames() on the produced bytes
            from xk3190_simulator import SimReader
            self.reader = SimReader(self.messages, splitter=split_frames,
                                    scenario=self.sim["scenario"],
                                    fps=self.sim["fps"],
                                    target=self.sim["target"],
                                    dec=self.sim.get("dec", 0),
                                    seed=self.sim.get("seed"))
            self.status_var.set(
                f"Starting simulator: {self.sim['scenario']} ...")
        else:
            self.reader = SerialReader(port, baud, self.messages)
            self.status_var.set(f"Opening {port} at {baud} 8N1 ...")
        self.reader.start()
        self.connect_btn.configure(text="Disconnect")
        self.status_lbl.configure(foreground="#555555")
        if not self.csv_path:
            self.csv_btn.configure(state="normal")

    def disconnect(self) -> None:
        if self.reader:
            self.reader.stop()
            self.reader = None
        self.connect_btn.configure(text="Connect")
        self.status_var.set("Disconnected")
        self.status_lbl.configure(foreground="#555555")
        self.stat_vars["port"].set("-")
        self.csv_btn.configure(state="disabled")

    def toggle_csv(self) -> None:
        if self.csv_file:
            self.stop_csv()
        else:
            self.start_csv()

    def start_csv(self) -> None:
        os.makedirs(self.log_dir, exist_ok=True)
        path = os.path.join(
            self.log_dir,
            f"scale_log_{datetime.now():%Y%m%d_%H%M%S}.csv")
        self.csv_file = open(path, "w", newline="", encoding="utf-8")
        self.csv_writer = csv.writer(self.csv_file)
        self.csv_writer.writerow(
            ["timestamp", "local_time", "weight", "decimals", "sign",
             "checksum", "checksum_ok", "kind", "raw_hex"])
        self.csv_path = path
        self.csv_btn.configure(text="Stop CSV log")
        self.append_log(f"CSV logging -> {path}", tag="info")

    def stop_csv(self) -> None:
        if self.csv_file:
            try:
                self.csv_file.close()
            except Exception:
                pass
            self.append_log(f"CSV logging stopped ({self.csv_path})", tag="info")
        self.csv_file = None
        self.csv_writer = None
        self.csv_btn.configure(text="Start CSV log")

    # ------------------------------------------------------------ queue poller
    def poll(self) -> None:
        try:
            while True:
                kind, payload = self.messages.get_nowait()
                if kind == "open":
                    self.status_var.set(f"Connected: {payload}")
                    self.status_lbl.configure(foreground="#1a7f37")
                    self.stat_vars["port"].set(payload)
                    self.append_log(f"opened {payload}", tag="info")
                elif kind == "frame":
                    self.on_frame(*payload)
                elif kind == "error":
                    text = self._friendly_error(payload)
                    self.status_var.set(f"ERROR: {text}")
                    self.status_lbl.configure(foreground="#b00020")
                    self.append_log(f"ERROR: {payload}", tag="bad")
                    self.connect_btn.configure(text="Connect")
                    self.reader = None
                    self.csv_btn.configure(state="disabled")
                elif kind == "closed":
                    if self.reader is not None:
                        self.status_var.set("Port closed")
                        self.stat_vars["port"].set("closed")
                        self.connect_btn.configure(text="Connect")
                        self.reader = None
        except queue.Empty:
            pass
        self.root.after(self.POLL_MS, self.poll)

    @staticmethod
    def _friendly_error(message: str) -> str:
        low = message.lower()
        if "denied" in low or "access" in low or "permission" in low:
            return f"{message}  |  {BUSY_HINT}"
        if "cannot find" in low or "no such port" in low or "file not found" in low:
            return f"{message}  |  Check the cable and the selected port."
        return message

    def on_frame(self, when: float, frame: bytes) -> None:
        self.frames += 1
        self.frame_times.append(when)
        decoded = decode_frame(frame)
        raw = hexdump(frame)

        if decoded is None:
            self.undecodable += 1
            self.append_log(f"[{datetime.fromtimestamp(when):%H:%M:%S.%f}] "
                            f"?? {frame!r}  {raw}", tag="bad")
            return

        if decoded["checksum_ok"] is False:
            self.checksum_errors += 1

        changed = (self.last_value != decoded["value"]
                   or self.last_dec != decoded["dec"])
        self.last_value = decoded["value"]
        self.last_dec = decoded["dec"]
        self.last_frame_hex = raw
        self.weight_var.set(format_value(decoded["value"], decoded["dec"]))
        chk = decoded["chk"]
        if decoded["checksum_ok"] is True:
            chk += " OK"
        elif decoded["checksum_ok"] is False:
            chk += " BAD"
        self.detail_var.set(
            f"{decoded['sign']}   decimals={decoded['dec']}   checksum={chk}   "
            f"{raw}")

        if changed or decoded["checksum_ok"] is False or self.frames <= 3:
            self.append_log(
                f"[{datetime.fromtimestamp(when):%H:%M:%S.%f}] "
                f"{format_value(decoded['value'], decoded['dec'])}  chk={chk}"
                f"   {raw}",
                tag="bad" if decoded["checksum_ok"] is False else "")

        if self.csv_writer:
            self.csv_writer.writerow([
                f"{when:.3f}",
                datetime.fromtimestamp(when).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                decoded["value"], decoded["dec"], decoded["sign"],
                decoded["chk"],
                {True: "OK", False: "BAD", None: ""}[decoded["checksum_ok"]],
                decoded["kind"], raw])
            self.csv_file.flush()

    def append_log(self, line: str, tag: str = "") -> None:
        self.log.configure(state="normal")
        self.log.insert("end", line + "\n", tag)
        # keep the log bounded
        if int(self.log.index("end-1c").split(".")[0]) > 500:
            self.log.delete("1.0", "200.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    # ------------------------------------------------------------ statistics
    def update_stats(self) -> None:
        now = time.time()
        self.frame_times = [t for t in self.frame_times if now - t <= 2.0]
        self.fps = len(self.frame_times) / 2.0
        self.stat_vars["frames"].set(str(self.frames))
        self.stat_vars["fps"].set(f"{self.fps:.1f}")
        self.stat_vars["chk_err"].set(str(self.checksum_errors))
        self.stat_vars["bad"].set(str(self.undecodable))

        if (self.reader and self.reader.is_alive() and self.opened_at
                and self.frames == 0
                and now - self.opened_at > self.NO_DATA_AFTER_S
                and not self.warned_no_data):
            self.warned_no_data = True
            self.status_var.set(f"Connected, but {NO_DATA_HINT}")
            self.status_lbl.configure(foreground="#b45309")

        self.root.after(self.STATS_MS, self.update_stats)

    # ---------------------------------------------------------------- shutdown
    def self_test_quit(self) -> None:
        """--auto-close: print a machine-readable summary, then exit."""
        if self.frames == 0:
            result = "FAIL (no frames)"
        elif self.checksum_errors:
            result = f"FAIL ({self.checksum_errors} checksum errors detected)"
        else:
            result = "PASS"
        print("SELF-TEST SUMMARY")
        print(f"  frames           : {self.frames}")
        print(f"  frames/s         : {self.fps:.1f}")
        print(f"  checksum errors  : {self.checksum_errors}")
        print(f"  undecodable      : {self.undecodable}")
        print(f"  last weight      : {self.weight_var.get()}")
        print(f"  last frame       : {self.last_frame_hex}")
        print(f"  status           : {self.status_var.get()[:160]}")
        print(f"  result           : {result}")
        self.shutdown()

    def shutdown(self) -> None:
        if self.reader:
            self.reader.stop()
        self.stop_csv()
        self.root.destroy()


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Read an XK3190-D10 weighing indicator over RS-232 (GUI).")
    p.add_argument("--port", help="serial port, e.g. COM1 (default: auto)")
    p.add_argument("--baud", default=DEFAULT_BAUD,
                   help="baud rate (default 9600)")
    p.add_argument("--auto-close", type=float, metavar="SECONDS",
                   help="self-test mode: close the window after N seconds")
    p.add_argument("--sim", action="store_true",
                   help="feed the GUI from the built-in XK3190 simulator "
                        "instead of the serial port (no hardware needed)")
    p.add_argument("--scenario", default="load",
                   help="simulator scenario "
                        "(list them: py xk3190_simulator.py --list)")
    p.add_argument("--target", type=float, default=735.0,
                   help="simulator target weight (default 735)")
    p.add_argument("--fps", type=float, default=15.0,
                   help="simulator frame rate (default 15, the real rate)")
    p.add_argument("--dec", type=int, default=0, choices=range(0, 5),
                   metavar="0-4", help="simulator decimal places (default 0)")
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
               "fps": args.fps, "dec": args.dec}

    log_dir = os.path.join(os.path.expanduser("~"), "Documents",
                           "XK3190_Scale_Reader", "logs")
    root = tk.Tk()
    ScaleApp(root, log_dir, args.port, args.baud, args.auto_close, sim=sim)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
