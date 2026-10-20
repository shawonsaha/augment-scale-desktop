# XK3190-D10 RS-232 Serial Reader — Testing & Analysis Report

| | |
|---|---|
| **Subject** | Reading an XK3190-D10 weighing indicator over an RS-232 (DB9) serial port, and building a reusable application for it |
| **Date of testing** | 2026-10-09, 18:29 – 18:57 (local time) |
| **Test machine** | Gigabyte H61M-DS2 board, Windows 10 Pro 10.0.19045 64-bit |
| **Python** | 3.14.8 (`C:\Users\windows10\AppData\Local\Programs\Python\Python314\python.exe`), pyserial 3.5, tkinter |
| **Deliverables** | `C:\Users\windows10\Documents\XK3190_Scale_Reader\` |
| **Overall result** | **PASS** — port identified, protocol fully decoded and checksum-verified, application tested live, your original weighing software restored |

---

## 1. Executive summary

1. The indicator is connected to the PC's built-in serial port **COM1**
   (`ACPI\PNP0501\1`, Gigabyte H61M-DS2 onboard UART). No USB-serial adapter is present.
2. First read attempts failed with *"Access to the port 'COM1' is denied"*. Root cause:
   your weighing program **`Scale Weight.exe`** (Meghna Digital Scales, VB6) had COM1 open
   **exclusively** — Windows serial ports cannot be shared.
3. The program's own source (`frminformation.frm`) confirmed the link settings:
   `MSComm1.Settings = "9600,N,8,1"`, `CommPort = 1`.
4. With the port freed, the indicator streams data at **9600 8N1 ≈ 15 frames/second**, continuously.
5. The stream is Yaohua **"continuous communication format 1"** — exactly **12 bytes per frame**.
   The XOR checksum was reverse-verified against two different real frames (**0** and **735**):
   the algorithm matches the indicator byte-for-byte.
6. Two applications were built, unit-tested, and then tested **live on real hardware**:
   `xk3190_scale_app.py` (GUI) and `xk3190_console_test.py` (CLI). Final live results:
   **147 frames / 10 s, 0 checksum errors, 0 undecodable frames → PASS**.
7. Two real bugs were found during testing and fixed (GUI did not auto-connect; frame splitter
   mishandled buffers starting mid-frame). Both fixes are covered by regression tests.
8. **Finding that may affect you:** your existing `Scale Weight.exe` parses a *different*
   output format than the one your indicator is configured to send (see §8).
9. Because this is the client PC with the machine attached, development also happens
   **in-house**: a byte-accurate **simulator** (`xk3190_simulator.py`) was added so the
   whole app can be exercised without hardware and without touching COM1 — see §11.

---

## 2. System environment

| Item | Value |
|---|---|
| Operating system | Microsoft Windows 10 Pro 10.0.19045 64-bit |
| Motherboard | Gigabyte H61M-DS2 (Intel H61), onboard Super-I/O UART |
| Serial port | **COM1** — PnP ID `ACPI\PNP0501\1`, friendly name *Communications Port (COM1)* |
| USB-serial adapters | **None detected** (no CH340/PL2303/FTDI/CP210x device present) |
| Indicator | XK3190-D10, RS-232 female DB9, continuous output mode |
| Link settings | **9600 baud, 8 data bits, no parity, 1 stop bit (8N1)** |
| Other serial programs | `Scale Weight.exe` — `G:\New folder\Meghna Digital Scales\Current\Scale Backup Normal\Scale Weight.exe` |
| Python | 3.14.8 + pyserial 3.5 + tkinter (all present and working) |

---

## 3. Diagnostic sequence (chronological)

### 3.1 Port enumeration
```
Get-CimInstance Win32_PnPEntity | Where Name -match '\(COM\d+\)'
  → Communications Port (COM1)   Status: OK   ACPI\PNP0501\1
Get-ItemProperty HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM
  → \Device\Serial0 : COM1
```
Only COM1 exists → the indicator must be on the motherboard DB9 (or a header wired to it).

### 3.2 First read attempt → failure
```
py read_xk3190.py -p COM1 -b 9600 --seconds 10
  → ERROR opening COM1: PermissionError(13, 'Access is denied')
[System.IO.Ports.SerialPort] open → Access to the port 'COM1' is denied
```
On Windows serial ports, *Access denied* (Win32 error 5) on `CreateFile("\\\\.\\COM1")`
almost always means **another process already holds the port** (the serial driver does not
share), *not* a permissions problem.

### 3.3 Identifying the holder
* Restart Manager query (needs elevation → returned rc=5, unavailable) — process list used instead:
* `Get-Process` showed **`Scale Weight` (PID 424)**, started 18:10:45, window title *Scale Weight*.
* Program path: `G:\New folder\Meghna Digital Scales\Current\Scale Backup Normal\Scale Weight.exe`.

### 3.4 Confirming settings from the program's own source
VB6 sources are present next to the executable. Grep results from `frminformation.frm`:
```vb
frminformation.MSComm1.Settings = "9600,N,8,1"     ' 9600 baud, no parity, 8 data, 1 stop
frminformation.MSComm1.CommPort = 1                ' COM1
frminformation.MSComm1.PortOpen = True             ' opened in Form_Load
Loop Until frminformation.MSComm1.InBufferCount >= 2
```
⇒ Port COM1, 9600 8N1 — matching the XK3190-D10's default.

### 3.5 Freeing the port
* `CloseMainWindow()` (graceful) → **no effect** — the VB6 app ignores `WM_CLOSE`.
* `Alt+F4` via `SendKeys` → **no effect**, no confirmation dialog either (its `QueryUnload`
  blocks unloading; only the in-app menu exits).
* With your approval the process was terminated (`Stop-Process -Force`), the port read, and the
  program relaunched afterwards. *(Repeat of this procedure is documented in
  `HOW_TO_RUN_AND_TEST.md` §7.)*

### 3.6 Result
```
--- opened COM1 @ 9600 8N1 ---
02 2B 30 30 30 30 30 30 30 31 42 03   →  +00000001-style frame, checksum verified
```
Data confirmed. Protocol analysis followed.

---

## 4. Protocol analysis

### 4.1 Link layer
| Parameter | Value |
|---|---|
| Port | COM1 |
| Baud | 9600 |
| Data bits / parity / stop | 8 / None / 1 |
| Direction | Indicator → PC (continuous, unrequested) |
| Rate observed | ~15 frames/s (≈ every 66 ms; each 12-byte frame = 120 bits ≈ 12.5 ms line time) |

### 4.2 Frame layout — Yaohua "continuous communication format 1" (12 bytes)

| Byte | Content | Example (weight 735) |
|---|---|---|
| 1 | `02` STX | `02` |
| 2 | sign `+` or `-` | `2B` (`+`) |
| 3–8 | weight digits, 6, high digit first | `30 30 30 37 33 35` = `000735` |
| 9 | decimal places, ASCII `'0'`…`'4'` | `30` → 0 decimals |
| 10–11 | XOR checksum, 2 hex ASCII chars | `31 41` = `1A` |
| 12 | `03` ETX | `03` |

**Value = digits ÷ 10^(byte 9)**, with the sign from byte 2.

**Checksum algorithm (reverse-verified):**
1. XOR bytes 2…9 inclusive (8 bytes).
2. Take the high nibble and low nibble of the result.
3. Nibble ≤ 9 → ASCII `0x30 + n`; nibble ≥ 10 → ASCII `0x37 + n`
   (so `0x0A → 'A'`, `0x0B → 'B'` …).

### 4.3 Verification against two different real frames

| Frame (hex) | Weight | XOR of bytes 2–9 | Computed | In frame | Verdict |
|---|---|---|---|---|---|
| `02 2B 30 30 30 30 30 30 30 31 42 03` | `000000`, dec 0 → **0** | `0x1B` | `1B` | `1B` | ✅ match |
| `02 2B 30 30 30 37 33 35 30 31 41 03` | `000735`, dec 0 → **735** | `0x1A` | `1A` | `1A` | ✅ match |

Worked example (frame 2): payload = `2B 30 30 30 37 33 35 30`.
Four `0x30` cancel pairwise → `2B ^ 37 ^ 33 ^ 35` = `1C ^ 33 ^ 35` = `2F ^ 35` = **`1A`**
→ high nibble `1` → `'1'`; low nibble `A` (10 > 9) → `0x37 + 10 = 0x41 = 'A'` → **`1A`** ✔

**Conclusion:** the decoder's checksum implementation agrees with the indicator exactly; a
checksum mismatch therefore reliably indicates line noise or a wrong baud rate.

### 4.4 Other formats
Frames beginning with `=` (Yaohua formats 2/3/4) and newline-delimited payloads are also
parsed by both scripts (weight extracted, checksum reported as `n/a`). Frames that match
neither pattern are counted as *undecodable* and logged with their hex dump — in the final
live tests this count was **0**.

---

## 5. Test matrix

| # | Test | Method | Expected | Result |
|---|---|---|---|---|
| T1 | Decoder unit tests (GUI + CLI modules) | synthetic + 1 real frame | correct values, checksum OK/BAD | **PASS** (all assertions) |
| T2 | Frame-splitter unit tests (5 scenarios × 2 modules) | synthetic buffers | no loss, no stall, no garbage | **PASS** |
| T3 | Port busy → console error path | run CLI while Scale Weight holds COM1 | friendly message, exit code 2 | **PASS** |
| T4 | Port busy → GUI error path | GUI `--auto-close` while port held | window opens, error shown, clean exit | **PASS** |
| T5 | Live console read + CSV | 10 s on COM1 | frames flow, checksums OK | **PASS** — 151 frames / 10.3 s = 14.7 fps, 0 errors, 151 CSV rows |
| T6 | Live GUI read (1st) | `--auto-close 10` | frames flow | **PASS with defect** — 145 frames, 1 undecodable → bug B2 found |
| T7 | Live GUI read (after fix) | `--auto-close 10` | 0 undecodable | **PASS** — 147 frames, 15.5 fps, 0 chk errors, 0 undecodable |
| T8 | Raw capture evidence | `--seconds 6 --raw` | clean hex dump | **PASS** — 92 frames / 6.2 s, 0/0 |
| T9 | Syntax/compile | `py -m py_compile` both scripts | no errors | **PASS** |

### 5.1 T1 — decoder unit tests (excerpt of actual output)
```
real frame      : (0.0, 0, '+', True, 'format1')  | 02 2B 30 30 30 30 30 30 30 31 42 03
fabricated 123.4: (123.4, 1, '+', True, 'format1')
tampered frame  : (123.4, 1, '+', False, 'format1')      ← corruption detected
negative frame  : (-50.0, 2, '-', True, 'format1')
other format    : (3.0, 3, '+', None, 'other-format')    ← '=0003.000'
ALL DECODER TESTS PASSED (GUI + console share identical logic)
```

### 5.2 T5 — live console capture (weight 735 on the scale)
```
18:52:49  weight = 735   checksum OK
--- 151 frames in 10.3s (14.7 frames/s), 151 decoded, 0 checksum errors,
    0 undecodable, last weight = 735.0 ---
console exit code: 0
CSV: 152 lines (header + 151 rows)
```

### 5.3 T7 — live GUI self-test after the fix
```
SELF-TEST SUMMARY
  frames           : 147
  frames/s         : 15.5
  checksum errors  : 0
  undecodable      : 0
  last weight      : 735 -> 0   (load removed between tests)
  status           : Connected: COM1 @ 9600 8N1
  result           : PASS
```

### 5.4 Error-path behaviour (T3)
```
ERROR: cannot open COM1: ... Access is denied
HINT: the port is already open by another program (usually the weighing software,
      e.g. Scale Weight.exe). Close that program, then run this test again.
console exit code: 2
```

---

## 6. Bugs found during testing (and fixed)

| ID | Severity | Symptom | Cause | Fix | Regression test |
|---|---|---|---|---|---|
| B1 | High | GUI self-test reported `frames: 0 / FAIL` — window did nothing | GUI only connected when *Connect* was pressed; nobody presses it in self-test mode, and a user would see a dead window | Auto-connect on startup using the selected port/baud | T7 |
| B2 | High | 1 *undecodable* frame; potential read stall | Old splitter: a buffer starting mid-frame, or containing a stray `ETX` left from a truncated frame, never satisfied `i_end > i_start`, so framing could stall until the 1 KB garbage guard fired | New `split_frames()`: drops partial prefixes and stray `ETX`, keeps an incomplete tail buffered, still supports newline-delimited formats | T2 + T7 (0 undecodable) |
| B3 | Medium | Raw-mode line printed a literal `[:-3]` | Incorrect f-string slicing in first draft | Rewritten before first run using `strftime(...)[:-3]` | T8 output clean |
| B4 | Medium | `\r` status lines polluted redirected/piped output | Self-updating status line written unconditionally | Status line only when `sys.stdout.isatty()`; plain 5-second heartbeat lines otherwise | T5/T8 outputs clean |
| B5 | Low | Raw mode summary showed `last weight = None` | `last_value` only updated in non-raw branch | Set for every decoded frame | T8 |

Decoder/framing logic was **not** changed after T7 — final results are from the shipped code.

---

## 7. Evidence files produced during testing

| File (in `Documents\XK3190_Scale_Reader\`) | Content |
|---|---|
| `live_test_capture.csv` | 151 weight samples, 18:52:49–18:52:59, weight **735**, all `checksum=OK`, full raw hex per row |
| `sample_capture_raw.txt` | 92 raw frames, 18:57:06–18:57:12, weight **0**, `chk=OK`, plus summary line |

Sample CSV rows:
```
epoch,local_time,weight,decimals,sign,checksum,kind,raw_hex
1791550369.825,18:52:49.825,735,0,+,OK,format1,02 2B 30 30 30 37 33 35 30 31 41 03
1791550370.037,18:52:50.036,735,0,+,OK,format1,02 2B 30 30 30 37 33 35 30 31 41 03
```

---

## 8. Analysis of your existing `Scale Weight.exe` (important finding)

The indicator sends **continuous format 1** (`STX + 000735 0 1A ETX` — no `kg`, decimal in a
separate byte). The VB6 program parses in `frminformation.frm`:

```vb
' Handler A (MSComm1_OnComm3):
x = InStr(1, Instring, "kg", 1)          ' looks for "kg"
If x >= 7 Then txtscale.Text = Val(Mid(Instring, x - 6, 5)) ...

' Handler B (MSComm1_OnComm2):
x = InStr(1, Instring, "+", 1)           ' finds the '+' at byte 2
txtscale.Text = Val(Mid(Instring, x, 7)) ' takes "+000735" → 735, ignores byte 9
```

| Issue | Effect |
|---|---|
| Handler A never matches — format 1 contains **no `kg`** (that belongs to format 4, `=0002.000kg;…`) | weight field never updated by that path |
| Handler B ignores **byte 9 (decimal position)** | for a weight like `123.4` (digits `001234`, dec `1`) it reads `+001234` → displays **1234** (10× error); with dec `0` it happens to be correct |

**Recommendations (pick one):**
1. Reconfigure the indicator to the output format the program expects (communication menu →
   transmission format), **or**
2. Fix the parser to honour byte 9, e.g. `txtscale.Text = Val(Mid$(s,3,6)) / 10 ^ Val(Mid$(s,9,1))`,
   **or**
3. Use the new `xk3190_scale_app.py`, which already decodes the current format correctly
   (verified against the physical indicator in T5–T8).

Other observations:
* The program holds COM1 **exclusively for as long as it runs its weighing form** — it cannot
  coexist with any other serial reader. This is a Windows limitation, not a bug.
* It ignores `WM_CLOSE`/Alt+F4; to close it you must use its own exit menu, or terminate the
  process (force-kill is safe when the scale is idle; Jet/Access rebuilds `SCALE.ldb`).

---

## 9. Conclusions

1. **The serial link works**: COM1 @ 9600 8N1 receives a continuous ~15 frames/s stream from
   the XK3190-D10, and every frame passes checksum validation.
2. **The protocol is fully understood** — format 1,12 bytes, XOR checksum reverse-verified on
   two distinct real frames (0 and 735).
3. **The delivered application is correct**: identical decoder in GUI and CLI, framing robust
   against mid-frame starts, live-tested twice with 0 checksum errors and 0 undecodable frames.
4. **Error handling is tested**: a held port produces a clear, actionable message instead of a
   crash (both GUI and CLI), and CLI exit codes are script-friendly (0/2/3/4).
5. **Your existing program may mis-parse the current indicator format** (§8) — worth checking
   against the indicator's own display.

## 10. Recommendations

* Run the manual test procedure in `HOW_TO_RUN_AND_TEST.md` §7 with a **known load** to
  confirm value/units/decimals match the indicator display (this test could not be performed
  automatically — no known weight was placed on the scale during testing; observed values were
  `0` and `735`).
* Decide which program owns COM1 at any time; never run two readers simultaneously.
* If you keep `Scale Weight.exe`, align its parsing with format 1 (§8) or change the
  indicator's transmission format.
* Keep `requirements.txt` with the scripts; `py -m pip install -r requirements.txt` restores
  the dependency on a new machine.

---

## 11. In-house simulator (hardware-free testing)

Requested as *"create me nice simulation file to test"* — the delivery machine also has the
real scale attached, so in-house development must not depend on (or disturb) COM1.

### 11.1 What was built

`xk3190_simulator.py` emulates the indicator's RS-232 stream:

* **Byte-accurate frames** — the same 12-byte format-1 layout with **real XOR checksums**
  computed exactly like the indicator (verified against the two captured live frames in §4.3).
* **Real timing** — paced at 15 frames/s with random chunk sizes, so the app's framing code
  is exercised against realistic partial reads (not whole frames at once).
* **9 scenarios** — `zero, steady, ramp, load, jitter, tare, badchecksum, garbage,
  otherformat`, including deliberate **checksum corruption**, **junk/truncated frames** and
  the alternate `=weight` line format.
* **Drop-in reader** — `SimReader` speaks the identical queue protocol as `SerialReader`
  and feeds the **caller's own `split_frames()`**, so the GUI's production framing path runs
  end-to-end.
* **Outputs** — console terminal view, TCP server (`--tcp`), serial port (`--out-port`,
  e.g. com0com), file (`--out-file`).

### 11.2 Integration

Both delivered programs gained a `--sim` switch (scenario/target/fps options) that replaces
the serial source and nothing else — **every byte then flows through the exact same
decoder/splitter/CSV code used with real hardware**.

### 11.3 Verification results

| Test | Command | Result |
|---|---|---|
| Simulator self-test | `py xk3190_simulator.py --selftest` | **41/41 checks passed → ALL PASSED** (round-trips through *both* programs' decoders, all 3 splitters recover 210/210 frames, all scenarios valid, faults really injected) |
| Console + sim (clean) | `--sim --scenario load --seconds 6` | 90 frames, 15.0 fps, 0 errors → **exit 0** |
| Console + sim (fault) | `--sim --scenario badchecksum --seconds 6` | 22 checksum errors → **exit 4** |
| Console + sim (junk) | `--sim --scenario garbage --seconds 6` | 20 undecodable frames counted, 0 checksum errors → **exit 0** |
| Console + sim (CSV) | `--sim --scenario ramp --seconds 4 --csv …` | 59 rows written, correct columns |
| GUI self-test + sim | `--sim --scenario load --auto-close 8` | 115 frames, 0 errors → **PASS** |
| GUI fault drill | `--sim --scenario badchecksum --auto-close 6` | 22 checksum errors detected → `FAIL (22 … detected)` *(expected: detection works)* |
| Unknown scenario | `--sim --scenario nope` | friendly error listing valid scenarios → **exit 2** |
| **Real hardware regression** | `py xk3190_console_test.py --seconds 2` / `py xk3190_scale_app.py --auto-close 6` | 30 frames / 85 frames, 0 errors, weight 0 → **exit 0 / PASS** (COM1 was free during the final run) |

### 11.4 Bug found and fixed while adding the simulator

* **B6 (console)** — `st["last_value"]` was assigned *before* the change comparison, so the
  non-raw `"weight = …"` change lines could never print (`changed` was always `False`).
  Introduced by the earlier B5 fix, caught by the first simulator run, fixed by computing
  `changed` before overwriting the previous value; verified in test 1 above.

---

## Appendix A — Deliverable file inventory

| File | Purpose |
|---|---|
| `xk3190_scale_app.py` | Main GUI application (live weight, checksum status, frame rate, raw frame log, CSV logging) |
| `xk3190_console_test.py` | Console test tool (quick verification, `--raw`, `--scan`, `--csv`, `--sim`, script-friendly exit codes) |
| `xk3190_simulator.py` | XK3190-D10 simulator (9 scenarios, real checksums, console/TCP/port/file outputs, `--selftest`) |
| `run_app.bat` | Double-click launcher for the GUI |
| `run_console_test.bat` | Double-click launcher for the console test |
| `run_simulator.bat` | Double-click launcher for the simulator self-test |
| `requirements.txt` | `pyserial>=3.5` |
| `HOW_TO_RUN_AND_TEST.md` | Step-by-step manual run & scale-testing instructions |
| `TESTING_AND_ANALYSIS_REPORT.md` | This report |
| `CONVERSATION_HISTORY.md` | Full session transcript (requests, commands, outputs, decisions) |
| `live_test_capture.csv` | Live test evidence (151 samples, weight 735) |
| `sample_capture_raw.txt` | Raw frame evidence (92 frames, weight 0) |

## Appendix B — Raw frames observed

```
weight   0: 02 2B 30 30 30 30 30 30 30 31 42 03    → + 000000 dec 0 chk 1B OK
weight 735: 02 2B 30 30 30 37 33 35 30 31 41 03    → + 000735 dec 0 chk 1A OK
```

## Appendix C — Protocol variants considered

| Format | Framing | Recognised by the app? |
|---|---|---|
| **1 (in use)** | `02` + sign + 6 digits + decimal + 2 checksum chars + `03`, 12 bytes | ✅ fully decoded + checksum verified |
| 2 / 3 | `=` + digits incl. decimal point (+ sign), 9 bytes | ✅ decoded (no checksum) |
| 4 | `=0002.000kg;0001.00;0002.00` (27 bytes) | ✅ weight extracted (no checksum) |
| Command mode | host polls with `02 41 …03`, indicator replies | not applicable (indicator is in continuous mode `tF=0`) |
