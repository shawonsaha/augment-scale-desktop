# XK3190 Scale Reader — How to Run & Manually Test the Scale

Everything lives in **`C:\Users\windows10\Documents\XK3190_Scale_Reader\`**.

| File | What it does |
|---|---|
| `run_app.bat` | **Start the GUI app** (double-click) |
| `run_console_test.bat` | **Quick console test** (double-click) |
| `run_simulator.bat` | **Simulator self-test** (double-click) — proves the whole chain with **no scale needed** |
| `xk3190_scale_app.py` | The GUI application |
| `xk3190_console_test.py` | The console test tool |
| `xk3190_simulator.py` | XK3190-D10 **simulator** — emulates the indicator's serial stream (see §10) |
| `requirements.txt` | Python dependency (`pyserial>=3.5`) |
| `TESTING_AND_ANALYSIS_REPORT.md` | Full test & analysis report |
| `CONVERSATION_HISTORY.md` | Full session transcript (every request, command and result) |
| `live_test_capture.csv`, `sample_capture_raw.txt` | Evidence from the live tests |

---

## 1. Requirements

* Windows PC with the scale's serial cable plugged in (indicator DB9 female → PC **COM1**).
* Python 3.x with `pyserial` (already installed on this PC: Python 3.14.8, pyserial 3.5).
* If you ever need to reinstall the dependency:

```
py -m pip install -r C:\Users\windows10\Documents\XK3190_Scale_Reader\requirements.txt
```

Check it works:

```
py -c "import serial; print(serial.__version__)"
```

---

## 2. ⚠️ Golden rule: only ONE program can use COM1 at a time

Windows serial ports are **exclusive**. If `Scale Weight.exe` (or Putty, or anything else) has
COM1 open, our app gets:

```
ERROR: cannot open COM1: ... Access is denied
HINT: the port is already open by another program (usually the weighing software,
      e.g. Scale Weight.exe). Close that program, then run this test again.
```

**What to do:** close the other program, then press *Connect* (GUI) or run the test again.

> Why it matters: while **our** app is connected, `Scale Weight.exe` will not be able to read
> the scale either. Always disconnect (GUI *Disconnect* button, or Ctrl+C / close the console)
> before handing the port back to your weighing software.

---

## 3. Run the GUI application (normal use)

**Easiest:** double-click **`run_app.bat`**.

**Or from a terminal:**

```
cd C:\Users\windows10\Documents\XK3190_Scale_Reader
py xk3190_scale_app.py
```

Optional arguments:

```
py xk3190_scale_app.py --port COM1 --baud 9600
py xk3190_scale_app.py --auto-close 10      # self-test: close after 10 s, print summary
```

### What you'll see

```
┌ XK3190 Scale Reader ────────────────────────────────────────────┐
│ Port [COM1 ▼] Refresh  Baud [9600 ▼]  [Disconnect] [Start CSV log] │
│ Connected: COM1 @ 9600 8N1                                        │
│                                                                    │
│                    735                                             │
│   +   decimals=0   checksum=1A OK   02 2B 30 30 30 37 33 35 …     │
│                                                                    │
│ Frames 147 | Frames/s 15.5 | Checksum errors 0 | Undecodable 0     │
│ Raw frames (newest last):                                          │
│ [18:52:49.825] 735  chk=1A OK  02 2B 30 30 30 37 33 35 30 31 41 03 │
└────────────────────────────────────────────────────────────────────┘
```

| Control | Meaning |
|---|---|
| **Port** | COM port — press *Refresh* to re-scan. COM1 is correct for this PC |
| **Baud** | 9600 for the XK3190-D10 (also the indicator's default) |
| **Connect / Disconnect** | Opens/closes the port (it connects automatically at startup) |
| **Big number** | Live weight, decoded with the correct decimal position |
| **Line under it** | sign, decimal places, checksum result, raw hex of the current frame |
| **Frames/s** | Live stream rate — expect ≈ 15 |
| **Checksum errors** | Must stay **0**. Anything > 0 = electrical noise / wrong baud |
| **Raw frame log** | Every frame; lines print in red for bad checksums/undecodable data |
| **Start CSV log** | Writes `logs\scale_log_YYYYMMDD_HHMMSS.csv` (timestamp, weight, checksum, raw hex) |

Closing the window disconnects cleanly and closes any open CSV file.

---

## 4. Run the console test (quick verification)

**Easiest:** double-click **`run_console_test.bat`** (press `Ctrl+C` to stop).

**Or with options:**

```
cd C:\Users\windows10\Documents\XK3190_Scale_Reader

py xk3190_console_test.py                    # COM1 @ 9600, runs until Ctrl+C
py xk3190_console_test.py --seconds 10       # stop automatically after 10 s
py xk3190_console_test.py --raw              # print every raw frame (hex + value)
py xk3190_console_test.py --csv my.csv       # log weights to a CSV file
py xk3190_console_test.py --scan             # try common baud rates until data appears
py xk3190_console_test.py -p COM1 -b 9600 --seconds 30 --csv weights.csv
```

Interactive output (one self-updating status line, plus a line each time the weight changes):

```
--- COM1 @ 9600 8N1   Ctrl+C to stop ---

18:52:49  weight = 735   checksum OK
18:52:49  weight=        735  frames=1  fps=  0.5  chk_err=0
18:52:53  weight=        735  frames=60  fps= 14.5  chk_err=0
--- 151 frames in 10.3s (14.7 frames/s), 151 decoded, 0 checksum errors,
    0 undecodable, last weight = 735.0 ---
```

### Exit codes (useful for scripting/automation)

| Code | Meaning |
|---|---|
| 0 | OK — data received, no checksum errors |
| 2 | Port could not be opened (busy or missing) — see hint on screen |
| 3 | Port opened but **no data** arrived |
| 4 | Data received but checksum errors detected |

---

## 5. Manual test procedure — verifying the scale end-to-end

Do this the first time you use the app (and after any cable/baud change).

> **No scale on your desk?** Rehearse this entire procedure first with the built-in
> simulator (§10) — it drives the app with real indicator frames and needs **no
> hardware and no COM1**.

**Before you start**
1. Note the weight currently shown on the XK3190-D10 display.
2. Close `Scale Weight.exe` (or any program using COM1) — see §2.
3. Put a known load nearby (a test weight, or anything with a known weight).

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `run_console_test.bat` (or double-click `run_app.bat`) | Port opens: `Connected: COM1 @ 9600 8N1` / `--- COM1 @ 9600 8N1 ---` |
| 2 | Watch for ~10 seconds with the scale **empty/stable** | Frames arrive at **≈15/s**, `checksum OK` on every frame, **no** `chk_err` |
| 3 | Compare the app's weight with the indicator's display | **Identical** value (e.g. display `0` → app `0`; display `735` → app `735`) |
| 4 | Place the known load on the scale | Within ~0.2 s the app shows the new weight; value matches the indicator exactly (including decimals, e.g. `12.35`) |
| 5 | Remove the load | App returns to `0` |
| 6 | Press **[tare]** on the indicator | App follows the indicator (net becomes 0, gross shown per indicator mode) |
| 7 | While a load sits slightly off-centre / bump the platform | Value updates continuously (~15 updates/s); when the indicator shows a stable reading the app's value stops changing |
| 8 | *(GUI)* Click **Start CSV log**, wait ~10 s, click **Stop CSV log** | File created in `XK3190_Scale_Reader\logs\` with one row per frame: timestamp, weight, checksum `OK`, raw hex |
| 9 | Open the CSV and check the `checksum` column | Every row `OK`; `raw_hex` always starts with `02` and ends with `03` |
| 10 | *(Optional)* Run `py xk3190_console_test.py --raw --seconds 5` | Every line shows the same 12-byte frame pattern with `chk=OK` |
| 11 | Close the app / press `Ctrl+C` | Port is released |
| 12 | Restart `Scale Weight.exe` | Your weighing software can open COM1 again (see §7) |

**Pass criteria:** steps 1–10 all match the indicator display, `checksum errors = 0`,
`undecodable = 0`, frame rate ≈ 15/s.

### Quick values check by hand
Take any raw line, e.g. `02 2B 30 30 30 37 33 35 30 31 41 03`:

* byte 2 `2B` = `+`
* bytes 3–8 `30 30 30 37 33 35` = `000735`
* byte 9 `30` = 0 decimals → **weight = 735**
* bytes 10–11 `31 41` = `1A` = XOR checksum (verified OK by the app)

---

## 6. Where the data is logged

| Output | Location |
|---|---|
| GUI CSV logs | `C:\Users\windows10\Documents\XK3190_Scale_Reader\logs\scale_log_*.csv` |
| Console CSV | whatever path you pass to `--csv` (relative to the folder you run from) |
| CSV columns | `epoch, local_time, weight, decimals, sign, checksum, kind, raw_hex` |

---

## 7. Handing COM1 back to `Scale Weight.exe`

1. Close our app (window ✕, or `Ctrl+C` in the console).
2. Start your weighing program:
   ```
   Start-Process -FilePath 'G:\New folder\Meghna Digital Scales\Current\Scale Backup Normal\Scale Weight.exe' `
                 -WorkingDirectory 'G:\New folder\Meghna Digital Scales\Current\Scale Backup Normal'
   ```
   (Using `-WorkingDirectory` = the exe's folder is safest for this VB6 program.)
3. If it ever fails to start, it usually means it was force-terminated mid-write: run it once
   from its own folder; Access/Jet rebuilds `SCALE.ldb` automatically.

> Note: the app ignores window ✕ / Alt+F4 — exit through its own menu, or terminate the
> process (`Stop-Process -Name 'Scale Weight'`) when the scale is idle.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Access is denied` / exit code 2 | Another program holds COM1 | Close `Scale Weight.exe` (or the other reader), press *Connect* again |
| "Connected, but no data…" / exit code 3 | Indicator not transmitting, wrong baud, or bad wiring | 1) Check the indicator is in continuous output mode (communication menu). 2) Try `py xk3190_console_test.py --scan`. 3) Check cable pins 2/3/5 |
| `Checksum errors` > 0 / exit code 4 | Line noise, wrong baud, loose DB9 connector | Reseat/tighten the connector, keep cable away from power lines, confirm 9600 baud |
| App shows a value, indicator shows another | Decimal/units mismatch or wrong format configured | Compare byte 9 (decimals); see report §8 about the format mismatch |
| Port missing from the list | Cable unplugged / UART disabled in BIOS | Plug in, press *Refresh*; enable the onboard serial port in BIOS if needed |
| Weight jumps or sticks | Scale not stable / indicator in manual mode | Let the indicator stabilise; check it isn't in a menu or calibration mode |
| GUI opens but stays blank | Python/tkinter issue | Run from terminal: `py xk3190_scale_app.py` and read the error |
| `py` not recognised | Python not on PATH | Use full path: `C:\Users\windows10\AppData\Local\Programs\Python\Python314\python.exe script.py` |
| Weight is `0` but something is on the scale | Scale needs zeroing | Press **[Zero]** on the indicator (within zero range) |

---

## 9. FAQ

**Can `Scale Weight.exe` and this app read the scale at the same time?**
No — Windows serial ports are exclusive. One at a time.

**The scale shows `12.35` but the app shows `1235`.**
Byte 9 (decimal position) is being ignored — that is the parsing bug described in
`TESTING_AND_ANALYSIS_REPORT.md` §8. The new app handles it correctly; the old program does not.

**How do I change the baud rate?**
Select it in the GUI (*Baud* box) or pass `-b 19200` to the console tool — but the indicator
must be configured for the same rate (communication menu on the XK3190-D10).

**How fast is the data?**
≈15 frames/s (the indicator's A/D conversion rate); each frame is 12 bytes.

**What is the checksum for?**
It proves each frame arrived intact: XOR of bytes 2–9, sent as two hex ASCII characters.
If it ever reports `BAD`, don't trust that reading.

---

## 10. In-house testing with the simulator (no scale, no COM1 needed)

`xk3190_simulator.py` emulates an XK3190-D10 indicator: it generates **byte-accurate
12-byte frames with real XOR checksums** at the real rate (~15 frames/s), so the app can be
developed and tested **while the real scale stays attached to the client PC**. The
simulator does not touch COM1 at all — you can run everything even while
`Scale Weight.exe` is using the port.

### Quick start

| Command | What it does |
|---|---|
| `run_simulator.bat` | **Self-test** — 41 checks proving generated frames pass the *real* decoders and frame splitters of both delivered programs (`41/41 ... ALL PASSED`) |
| `run_app.bat --sim` | GUI driven by the simulator (watch the weight move) |
| `run_app.bat --sim --auto-close 8` | GUI self-test without hardware → prints `result: PASS` |
| `run_console_test.bat --sim --scenario load --seconds 10` | Console test against the simulator (exit code 0) |
| `py xk3190_simulator.py --list` | Show all scenarios |
| `py xk3190_simulator.py --scenario load --seconds 10` | Just watch the raw stream, like a serial terminal |

### Scenarios

| Scenario | Simulates |
|---|---|
| `zero` | empty scale, constant 0 |
| `steady` | parked load (`--target`, default 735) |
| `ramp` | weight grows 0 → target over 10 s |
| `load` *(default)* | realistic weighbridge cycle: enter → overshoot → settle → hold → exit → empty (20 s loop) |
| `jitter` | unstable reading, target ±5 % noise |
| `tare` | gross → tare pressed → load removed (**negative net**) → zero |
| `badchecksum` | clean weight, but every 4th frame has a **corrupt checksum** |
| `garbage` | junk/truncated frames injected (**framing robustness**) |
| `otherformat` | Yaohua `=125.40` + CRLF style lines (no checksum) |

Change the target weight / speed / decimals with `--target 12540 --fps 20 --dec 2`.

### Fault drills (prove the error handling actually works)

```
py xk3190_console_test.py --sim --scenario badchecksum --seconds 6
    → WARNING: 22 frames failed checksum validation.     exit code 4

py xk3190_scale_app.py --sim --scenario badchecksum --auto-close 6
    → result: FAIL (22 checksum errors detected)         [expected: it DETECTED the faults]

py xk3190_console_test.py --sim --scenario garbage --seconds 6
    → undecodable counter > 0, checksum errors 0, exit code 0

py xk3190_scale_app.py --sim --scenario load --auto-close 8
    → 115 frames, 0 checksum errors, 0 undecodable → result: PASS
```

A clean scenario must always end **PASS / exit 0**; the fault scenarios must always be
**detected** (exit 4 / FAIL-with-count). If either changes, a regression was introduced.

### Other output modes

```
py xk3190_simulator.py --tcp 9000                  # raw byte stream on TCP (any client)
py xk3190_simulator.py --out-file capture.txt       # hex log of every frame
py xk3190_simulator.py --out-port COM5 --scenario load   # e.g. a com0com virtual pair
py xk3190_simulator.py --scenario load --seed 42    # repeatable output
```

`--selftest` is also wired into `run_simulator.bat` (no arguments) so a double-click
always verifies the whole delivery first.
