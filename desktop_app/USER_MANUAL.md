# Augment Scale - User Manual

Complete operator, administrator, build, test, and recovery guide for the Augment Scale desktop application.

**Version:** 1.0.0  
**Platform:** Windows 10/11 x64  
**Runtime:** .NET 10 Desktop Runtime + Microsoft Edge WebView2 Runtime

---

## 1. What the application does

Augment Scale is a local weighbridge workstation application. It replaces the browser prototype with a native Windows host that:

- reads live weight from a Yaohua XK3190-D10 indicator over a serial (RS-232/USB-serial) connection;
- stores trucks, tickets, print history, and audit events in an encrypted SQLCipher database;
- prints first-weigh slips and completed weight certificates through the Windows print system;
- tracks reprints, voids, pending-ticket deletions, and operator identity in an audit trail;
- works with the standalone scale simulator for training and acceptance testing without a physical scale.

All data is stored locally. Phase 1 does **not** upload tickets to a cloud service. An outbox table is populated for future synchronization, but no background cloud push exists yet.

### Ticket rules

- **Inbound (IN):** the first weighing is the gross weight; the second weighing is the tare weight.
- **Outbound (OUT):** the first weighing is the tare weight; the second weighing is the gross weight.
- Net weight is calculated as `gross - tare`.
- A truck may have only one open (pending) ticket at a time.
- A missing, zero, or negative net weight is treated as an anomaly. The operator must enter an override reason before a certificate can be previewed.
- Only completed tickets can be voided. Only pending tickets can be deleted.
- A voided or deleted ticket remains in history; records are never physically removed.

---

## 2. Requirements

### Production workstation

- Windows 10 or Windows 11, 64-bit.
- .NET 10 Desktop Runtime (unless a self-contained build is used).
- Microsoft Edge WebView2 Runtime, Evergreen version.
- A serial port (built-in COM port or USB-to-RS-232 adapter).
- A Yaohua XK3190-D10 compatible indicator configured for continuous output at 9600 baud, 8 data bits, no parity, 1 stop bit.
- A printer installed in Windows if printed slips/certificates are required.

The application was validated with WebView2 Runtime 155.0.4283.62 on Windows.

### Build workstation

- .NET 10 SDK (validated with 10.0.402).
- Internet access for the first NuGet restore, or a populated NuGet cache.
- PowerShell 5.1 or later.

Verify the SDK:

```powershell
dotnet --info
```

If `dotnet` is not recognized, install the .NET 10 SDK and reopen the terminal.

---

## 3. Repository layout

```
prototype-to-production/
  Implimentation_Plan.md          Implementation plan and acceptance criteria
  Database_Design.md              Database schema and field reference
  desktop_app/
    AugmentScale.slnx             Solution file (SDK 10 format)
    AugmentScale/
      AugmentScale.csproj         WPF application project
      App.xaml(.cs)               Startup, single-instance guard, crash logging
      MainWindow.xaml(.cs)        WebView2 host
      Services/                   Config, database, scale, bridge, printing, logging
      Models/                     DTOs and IPC command contracts
      Data/Schema/                Embedded SQL migration scripts
      Resources/setup.json        Default bootstrap configuration
      WebUI/                      HTML/CSS/JS user interface and partials
    AugmentScale.Protocol/        Shared XK3190 framing, checksum, stability, encoder
    AugmentScale.ScaleSimulator/  Standalone GUI scale simulator (development only)
    AugmentScale.Tests/           xUnit protocol, transport and database tests
    start-dev-sim.ps1             Isolated test data + simulator + app launcher
    USER_MANUAL.md                This document
```

---

## 4. Build from scratch

All commands below are run from the `desktop_app` directory.

```powershell
cd desktop_app
dotnet restore AugmentScale.slnx
dotnet build AugmentScale.slnx -c Debug
```

Expected result: `Build succeeded` with `0 Warning(s)` and `0 Error(s)`.

### Run the test suite

```powershell
dotnet test AugmentScale.slnx -c Debug
```

Expected result: all tests pass. Tests use an isolated temporary data directory and do not touch production data.

### Run from source

```powershell
dotnet run --project AugmentScale\AugmentScale.csproj
```

Or launch the built executable:

```powershell
.\AugmentScale\bin\Debug\net10.0-windows\win-x64\AugmentScale.exe
```

### Release build

```powershell
dotnet build AugmentScale.slnx -c Release
```

### Framework-dependent publish

This is the validated production package. The target computer must have the .NET 10 Desktop Runtime installed.

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained false -o ".\publish\win-x64"
```

### Self-contained publish

Use this when the target computer must not have .NET installed. The output is larger.

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained true -o ".\publish\win-x64-selfcontained"
```

### Deploy

1. Copy the entire publish folder to the workstation, for example `C:\Program Files\Augment Scale\`.
2. Confirm `AugmentScale.exe`, `WebUI\`, `Resources\`, and the runtime dependency files are present.
3. Confirm the WebView2 Runtime is installed.
4. Start `AugmentScale.exe`.
5. Create a desktop shortcut if required.

Do not copy only `AugmentScale.exe`; the application loads the `WebUI` and `Resources` folders from its own directory.

### Clean rebuild

If the build behaves unexpectedly:

```powershell
dotnet clean AugmentScale.slnx
Remove-Item -Recurse -Force AugmentScale\bin, AugmentScale\obj, AugmentScale.Tests\bin, AugmentScale.Tests\obj
dotnet restore AugmentScale.slnx
dotnet build AugmentScale.slnx -c Debug
```

---

## 5. Data locations and secrets

### Default paths

| Item | Path |
|---|---|
| Configuration | `%LOCALAPPDATA%\AugmentScale\setup.json` |
| Protected secrets | `%LOCALAPPDATA%\AugmentScale\secrets.dat` |
| Encrypted database | `%LOCALAPPDATA%\AugmentScale\augment-scale.db` |
| Logs | `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log` |
| WebView2 cache | `%LOCALAPPDATA%\AugmentScale\WebView2\` |

### How secrets are protected

- `secrets.dat` is encrypted with Windows DPAPI in **CurrentUser** scope with application entropy `AugmentScale.Secrets.v1`.
- It contains the random 256-bit SQLCipher database key and the operator PIN hashes.
- PINs are hashed with PBKDF2-HMAC-SHA256, 100,000 iterations, a random 16-byte salt, and a 32-byte derived key. Plaintext PINs are never stored after first-run provisioning.
- The database is encrypted with SQLCipher using the key from `secrets.dat`.
- Bootstrap PINs in `setup.json` are hashed on first run and then removed from the file.

### Critical backup rules

Back up these two files together while the application is closed:

```text
%LOCALAPPDATA%\AugmentScale\augment-scale.db
%LOCALAPPDATA%\AugmentScale\secrets.dat
```

- `secrets.dat` can only be decrypted by the same Windows user on the same Windows installation/machine. Copying it to another user or computer will not work.
- If `secrets.dat` is lost, the database cannot be decrypted.
- If `secrets.dat` is replaced by a new file, the application generates a new database key and the existing database becomes unreadable.
- Store backups on access-controlled media. The database contains business and personal data (driver names and phone numbers).
- Do not copy `setup.json` over `secrets.dat`.
- Do not edit `secrets.dat`. It is a binary DPAPI blob.

### Isolated test data directory

For testing without touching live data, set `AUGMENTSCALE_DATA_DIR` before launching:

```powershell
$env:AUGMENTSCALE_DATA_DIR = Join-Path $env:TEMP 'augment-scale-test'
New-Item -ItemType Directory -Path $env:AUGMENTSCALE_DATA_DIR -Force | Out-Null
Copy-Item ".\AugmentScale\Resources\setup.json" "$env:AUGMENTSCALE_DATA_DIR\setup.json"
& ".\AugmentScale\bin\Debug\net10.0-windows\win-x64\AugmentScale.exe"
```

Delete that temporary directory to reset the test environment. Never point this variable at the live data directory during destructive testing.

---

## 6. First-time configuration

Configuration is read from `%LOCALAPPDATA%\AugmentScale\setup.json`. On first launch, the application copies the template from `Resources\setup.json` if no configuration exists.

### Recommended deployment sequence

1. Install the application and WebView2 Runtime.
2. Launch once to create `%LOCALAPPDATA%\AugmentScale\`, then close the application.
3. Edit `%LOCALAPPDATA%\AugmentScale\setup.json`.
4. Set the organization, site, weighbridge capacity, serial port, and all operator PINs.
5. Delete the first-run `secrets.dat` and database **only if this is a brand-new install with no business data**. This forces the edited bootstrap PINs to be hashed on next launch.
6. Start the application and verify every operator can sign in.
7. Record the PINs in the site's access-controlled register.

### Important PIN warning

Bootstrap PINs are only used when a profile has no stored hash. After the first run, editing `pin` in `setup.json` has no effect, and the `pin` field is cleared. There is currently no PIN-reset screen. Set the correct PINs **before** the first production login. If a PIN must be changed later, it requires administrative tooling or a full data reset, which destroys ticket history.

### Operators

```json
"operators": [
  {
    "id": "mr",
    "code": "MR",
    "displayName": "MD. RAJU",
    "firstName": "Raju",
    "role": "Supervisor",
    "shift": "Shift A",
    "avatar": "avatars/frame-9.svg",
    "color": "#4C7875",
    "pin": "1234"
  }
]
```

The seeded demonstration PIN for every operator is `1234`. These are test credentials. Change them before live operation.

Operator fields:

- `id`: stable internal identifier; lowercase recommended.
- `code`: short code shown in the interface.
- `displayName`: full name used on tickets and audit records.
- `role`: display/audit label. Phase 1 does not enforce role-based permissions in the backend.
- `shift`: display label.
- `avatar`: image path under `WebUI/avatars/`.
- `pin`: exactly 4 digits. Used only for initial provisioning. The login screen is a four-digit PIN interface; longer PINs cannot be entered.

### Serial scale configuration

```json
"scaleConnection": {
  "portName": "COM1",
  "baudRate": 9600,
  "dataBits": 8,
  "parity": "None",
  "stopBits": 1,
  "protocolFormat": "yaohua_format_1",
  "stabilityWindowMs": 500,
  "stabilityToleranceKg": 10
}
```

- `portName`: `COM1`, `COM3`, etc., or `TCP:127.0.0.1:9876` for the standalone GUI simulator.
- Use Windows Device Manager to confirm the USB-serial adapter's port number.
- The indicator must be configured to match the baud rate, data bits, parity, and stop bits.
- Changes require an application restart.
- `stabilityWindowMs`: how long readings must remain within tolerance before capture is allowed.
- `stabilityToleranceKg`: maximum variation treated as stable.

### Organization and site block

```json
"organization": {
  "name": "Meghna Ship Recycling",
  "address": "Sitakunda, Chattogram, Bangladesh",
  "phone": "+880 1810 000000",
  "email": "weighbridge@example.com"
},
"site": {
  "name": "Main Yard",
  "timezone": "Asia/Dhaka",
  "address": "Sitakunda, Chattogram"
},
"weighbridge": {
  "name": "Weighbridge 1",
  "maxCapacityKg": 60000,
  "minDivisionKg": 5
}
```

The organization name appears in the certificate header. Site identity is stored with tickets.

### Validate configuration

- The file must be valid JSON. A trailing comma or missing brace prevents startup.
- Keep a copy of the working file before editing.
- If startup fails, read the latest log:
  `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log`.

---

## 7. Starting and signing in

1. Double-click `AugmentScale.exe`.
2. Wait for the login screen. The first launch may take several seconds while WebView2 initializes.
3. Select an operator profile.
4. Type the four-digit PIN. It submits automatically on the fourth digit.
5. After five failed attempts, that profile is locked for 60 seconds. The countdown persists across page reloads in the same WebView profile.
6. Lock the workstation at any time with `Ctrl+L` or the header lock button.

Only one copy can run per Windows session. A second launch displays "Augment Scale is already running on this workstation."

---

## 8. Daily operation

### 8.1 Dashboard

The dashboard shows:

- live weight and scale connection status;
- pending tickets with truck, driver, first weight, and elapsed time;
- search for pending tickets;
- counts for today's completed, pending, and total tickets;
- actions for Inbound and Outbound first weigh.

If the scale is disconnected, the HUD shows `------` and `DISCONNECTED`. Capture is blocked until a stable reading is available.

### 8.2 First weigh

1. From the dashboard, choose **Inbound** (loaded truck, gross) or **Outbound** (empty truck, tare).
2. Enter the truck registration number. Suggestions from registered trucks appear as you type.
3. Optionally enter driver, phone, client, material, challan/gate-pass number, and remarks.
4. If the truck is not registered, use **Register Truck** (`Ctrl+S`) to save it. Registration also works later from the Trucks screen.
5. Confirm the live weight is stable and the platform is clear except for the truck.
6. Click **Capture Weight** (or press `Space`).
7. Check the captured weight and the pre-print preview. The preview shows the server-allocated ticket number.
8. Click **Confirm & Print**.
9. The Windows print dialog opens. Select the printer and confirm.
10. The ticket becomes pending and appears on the dashboard.

Notes:

- Capture is blocked if the truck already has an open ticket. Complete or delete that ticket first.
- If the weight is zero or unstable, capture remains unavailable.
- The first-weigh modal is a preview only; no ticket is written until **Confirm & Print** is clicked.
- The printed slip uses the number returned by the database, not the temporary preview numbering.

### 8.3 Second weigh and certificate

1. On the dashboard, click the pending ticket row or its **Complete** button.
2. Verify the truck and first-weigh details.
3. Confirm the truck is fully on the platform and the reading is stable.
4. Click **Capture** (or press `Space`).
5. Review gross, tare, and calculated net.
6. Click **Preview Certificate**.
7. If the net is valid, click **Confirm & Print** and complete the Windows print dialog.
8. The ticket leaves the pending list and appears in History as completed.

Anomaly handling:

- If net is zero or negative, the preview is blocked and an override is required.
- Click the override action, enter a specific reason, and confirm.
- The reason, operator, and timestamp are stored with the ticket and shown in history.
- Do not use override to hide a genuine weighing error. Correct the truck position or scale reading and recapture when possible.

### 8.4 Reprints

1. Open **History**.
2. Find and open the completed or voided ticket.
3. Click **Reprint** (or `Alt+R`).
4. Select or enter a reason.
5. Confirm. The print dialog opens and a copy number is recorded.
6. The certificate is marked as a reprint and includes the reprint stamp.

Deleted pending tickets cannot be reprinted.

### 8.5 Voiding a completed ticket

1. Open the completed ticket in **History**.
2. Click **Void** (or `Alt+V`).
3. Enter a clear reason and confirm.
4. The ticket remains visible as voided. The action is recorded in the audit trail and outbox.

Only completed tickets can be voided. A void does not delete history.

### 8.6 Deleting a pending ticket

1. On the dashboard, locate the pending ticket.
2. Click the delete (X) control.
3. Enter a reason and confirm.
4. The ticket is soft-deleted and remains in History as deleted.

Only pending tickets can be deleted. This is intended for entry mistakes made before the second weigh.

### 8.7 History

History supports date ranges, status filters, stage filters, operator/material/client filters, search, and paging. Open a row to see:

- first and second weigh details;
- gross, tare, and net;
- operators and timestamps;
- override details;
- print and reprint log;
- void or delete reason.

### 8.8 Trucks

The Trucks screen supports:

- search and paging;
- add a truck (`Alt+N`);
- edit truck details;
- archive a truck;
- show archived trucks and restore them.

A truck with an open ticket cannot be archived. Complete or delete the pending ticket first.

### 8.9 Sync status

The sync indicator shows local outbox activity for Phase 2 readiness. In Phase 1, there is no cloud endpoint, so a successful local save does not mean data reached a server. Treat the local encrypted database as the system of record and maintain backups.

---

## 9. Printing

The application renders the slip or certificate in the WebView and calls the Windows print system.

- Install the receipt/certificate printer in Windows before operation.
- Set the correct default paper size and margins in the printer driver.
- Use the browser print dialog to select printer, paper, orientation, and copies.
- The first weigh slip and the completed certificate use different layouts.
- Each print is recorded with operator, document type, copy number, and timestamp.
- A reprint always requires a reason.

If the print dialog does not open:

1. Check that at least one Windows printer is installed and online.
2. Print a Windows test page.
3. Restart the application.
4. Check the application log for errors.
5. Confirm that no browser print-preview window is hidden behind the main window.

The application does not silently spool certificates without operator confirmation.

---

## 10. Simulator mode and acceptance testing

Simulator mode is intended for training, UI acceptance, and integration testing. It must not be used to issue real weight certificates.

### Standalone GUI simulator

`AugmentScale.ScaleSimulator` is a standalone desktop app that emulates an XK3190-D10 indicator: byte-accurate frames, real XOR checksums, 15 frames/s by default, and live controls. It drives the real application over loopback TCP, so weights can be changed without restarting anything.

Quick start from `desktop_app`:

```powershell
.\start-dev-sim.ps1
```

The script builds the solution, creates an isolated test data directory at `%TEMP%\augment-scale-dev`, sets `portName` to `TCP:127.0.0.1:9876` and the simulator port to `9876`, starts the simulator, then starts the application with `AUGMENTSCALE_DATA_DIR` pointing at that directory. Closing the application stops the simulator. Delete the test directory to reset tickets and PINs. Use `-Port 9877` (or similar) if `9876` is already in use.

To run the pieces manually:

```powershell
dotnet run --project AugmentScale.ScaleSimulator
dotnet run --project AugmentScale\AugmentScale.csproj
```

Configure the application to use the simulator by setting this in the active `setup.json`:

```json
"scaleConnection": {
  "portName": "TCP:127.0.0.1:9876"
}
```

`TCP:9876` is shorthand for `TCP:127.0.0.1:9876`. The application binds no listener itself; it only connects to the configured host. The simulator listens on loopback only.

Simulator controls:

- target weight in kg, with `Apply`, `Zero`, presets, and `+/-` nudges;
- `Motion` adds instability; the application still derives stability from its own rolling window, exactly as with hardware;
- `Disconnect app client` drops the TCP client so the reader reconnect path can be tested;
- scenario mode: steady, ramp, 20-second load cycle, jitter, tare cycle (negative net), bad checksum every 4th frame, garbage/truncated frames, and Yaohua `=12345` lines;
- frame rate 1-30 fps, frame count, last checksum, last frame hex, and a rolling frame log.

The weighbridge uses division `d = 5 kg`, so the simulator rounds every weight to 5 kg and does not simulate fractional kilograms.

Normal two-weigh transaction:

1. Set the target to the first weight (for example `12000`) and perform a first weigh.
2. Change the target to the second weight (for example `5000`) while the application stays running.
3. Open the pending ticket, complete the second weigh, and verify net = 12,000 - 5,000 = 7,000 kg.

Anomaly and fault drills:

- set the same target for both weighings to force net zero and the override-reason flow;
- choose `Tare cycle` to feed negative weights;
- choose `Bad checksum` and confirm the application rejects the corrupt frames and does not crash;
- choose `Garbage` and confirm framing recovers and valid frames continue;
- click `Disconnect app client` and confirm the HUD shows disconnected, then reconnect.

### Automated tests

```powershell
dotnet test AugmentScale.slnx -c Debug
```

Coverage includes:

- XK3190 frame decoding, encoding, checksum rejection, split frames, partial frames, and other supported prefixes;
- TCP simulator transport parsing and end-to-end frame decoding;
- simulator engine quantization, scenario timing, and corrupt/garbage injection;
- stability detection;
- PIN hashing and authentication;
- database initialization and seed data;
- first weigh, completion, reprint, void, and pending deletion;
- ticket numbering and reuse after deletion;
- open-ticket guards for vehicle archiving;
- anomalous-net override persistence.

Tests create temporary directories and do not require a scale, printer, or external network. The transport test uses loopback TCP only.

### Manual acceptance checklist

- [ ] Application starts and shows the login screen.
- [ ] Bad PIN is rejected; five failures lock the profile for 60 seconds.
- [ ] Valid PIN opens the dashboard.
- [ ] Disconnected scale shows `------` / `DISCONNECTED` and blocks capture.
- [ ] Simulator connects and shows stable live weight.
- [ ] First weigh requires direction and truck number.
- [ ] Existing open ticket blocks a second first weigh for the same truck.
- [ ] First-weigh preview does not write a ticket until confirmed.
- [ ] Confirmed first weigh appears in pending tickets with the correct number.
- [ ] Second weigh calculates gross, tare, and net correctly.
- [ ] Zero/negative net requires a reason before preview.
- [ ] Certificate confirm writes the ticket and clears it from pending.
- [ ] Reprint records a copy number and prints a reprint stamp.
- [ ] Void requires a reason, preserves history, and records an audit event.
- [ ] Delete requires a reason and only works on pending tickets.
- [ ] Archived truck cannot have an open ticket.
- [ ] Restart preserves operators, trucks, pending tickets, history, and settings.
- [ ] Logs contain startup and scale-health entries.

---

## 11. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `I` | Inbound first weigh (dashboard) / select Inbound (first-weigh screen) |
| `O` | Outbound first weigh (dashboard) / select Outbound (first-weigh screen) |
| `M` | Focus material field on the first-weigh screen |
| `Space` | Capture or recapture weight on weigh screens |
| `Ctrl+S` | Register or update truck from first weigh |
| `Enter` | Preview when available; confirm print when the preview is ready |
| `Shift+Enter` | Open anomaly override on the second-weigh screen |
| `Esc` | Go back, close dialog, or cancel preview |
| `Ctrl+L` | Lock workstation |
| `Alt+R` | Reprint selected history ticket |
| `Alt+V` | Void selected completed ticket |
| `Alt+N` | New truck on Trucks screen |
| `F11` | Toggle full screen |
| `Ctrl+Shift+D` | Open developer tools (support use only) |
| `?` | Show shortcut help where available |

Shortcuts are disabled while a modal dialog or text input has focus.

---

## 12. Troubleshooting

### The application does not start

1. Read `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log`.
2. If the message says WebView2 Runtime is required, install the Evergreen WebView2 Runtime.
3. If the message says .NET Desktop Runtime is missing, install .NET 10 Desktop Runtime or deploy the self-contained build.
4. If startup fails with a JSON error, validate `setup.json`.
5. If startup fails with "file is not a database" or a SQLCipher error, stop and restore the matching `secrets.dat` and `augment-scale.db` backup. Do not delete either file before making a copy for recovery analysis.

### Second launch shows "already running"

An instance is already open, possibly on another desktop session. Close the existing window. If it is not visible, sign out and back in or restart Windows. Do not terminate the process while a weigh is being saved.

### Scale shows disconnected

1. Confirm `portName` matches Device Manager.
2. Close any other program using the COM port.
3. Check the cable/adapter and indicator power.
4. Confirm indicator output settings: 9600, 8, N, 1 and continuous output.
5. Restart the application after changing `setup.json`.
6. Check the log for `port_error` entries.

### TCP simulator will not connect

1. Confirm the simulator window says `Listening on 127.0.0.1:<port>` and the application says `Simulator <host>:<port> connected`.
2. The port in `setup.json` (`TCP:127.0.0.1:9876`) must match the simulator's port. Only one program can listen on a port; use `-Port` with the launcher or change the simulator port.
3. If the simulator reports an invalid or busy port, correct it and click `Restart server`.
4. The application retries automatically every few seconds, so restarting the simulator does not require restarting the application.
5. The simulator listens on loopback only; it cannot serve another computer.

### Weight is displayed but capture is blocked

- Wait for the reading to stabilize.
- Confirm the truck is fully on the platform and the platform is clear.
- Check whether the truck already has an open ticket.
- Ensure the reading is not zero.
- If the indicator is in motion, wait for it to settle.

### No print dialog

- Verify a Windows printer is installed and set as default.
- Print a Windows test page.
- Check that a hidden print-preview window is not behind the application.
- Restart the application.
- Use History > Reprint to retry after resolving the printer issue.

### PIN rejected

- PINs are case-insensitive digits only; only digits are accepted.
- After five failures, wait 60 seconds.
- If the PIN is forgotten, there is no in-app reset in Phase 1. Restoring requires administrative intervention; resetting the data directory destroys tickets and is not an acceptable production solution.
- Confirm Caps Lock/Num Lock state; only the numeric row and keypad digits are accepted.

### Database or secrets were copied from another computer

DPAPI decryption fails, and the application creates a new key. The original database then cannot be opened. Restore the original pair on the original Windows account, or use the original workstation to export data before migration. Plan migrations before go-live.

### WebView2 cache problems after an update

Close the application and rename:

```text
%LOCALAPPDATA%\AugmentScale\WebView2
```

to a backup name. The application recreates it on next launch. This does not affect tickets, configuration, or secrets. Do not delete the database or `secrets.dat`.

### Full reset for a test machine only

1. Close the application.
2. Back up the entire `%LOCALAPPDATA%\AugmentScale` folder if any data matters.
3. Delete the folder.
4. Start the application and reconfigure `setup.json`.

This destroys all local tickets and PINs. Never do this on a production workstation without a verified backup and management approval.

---

## 13. Security and operational notes

- The workstation Windows account is part of the security boundary because DPAPI protects the database key. Use a dedicated, password-protected Windows account and restrict local administrator access.
- The application denies WebView2 permission requests and disables the context menu and normal developer shortcuts. `Ctrl+Shift+D` is retained for support.
- PIN lockout is enforced in the UI and stored in the WebView profile. It is not a defense against someone with file-system access to the Windows account.
- Role labels are displayed for accountability but are not enforced as permissions in Phase 1.
- Audit events are stored locally in the encrypted database.
- The sync outbox is not a backup. Maintain separate encrypted backups of the database and matching secrets file.
- Treat driver names and phone numbers as personal data. Restrict access to backups and logs.
- Do not install untrusted browser extensions or debug the production WebView with remote tools enabled.

---

## 14. Phase 1 limitations

- No cloud synchronization or remote dashboard. The outbox is prepared for Phase 2.
- No PIN-change or user-administration screen.
- No role-based authorization in the backend.
- No automatic database backup scheduler.
- No hardware certification against every indicator variant; validation used the XK3190 protocol implementation in this repository.
- Reprints and voids are not blocked by operator role.
- The application is Windows-only.

---

## 15. Support information to collect

When reporting a problem, provide:

- application version (currently 1.0.0);
- Windows version;
- .NET runtime version (`dotnet --info`);
- WebView2 Runtime version;
- relevant lines from `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log`;
- serial port name and indicator model;
- exact steps that reproduced the problem;
- ticket number, if the issue concerns a specific transaction.

Do not send `secrets.dat` or unencrypted database exports through email or chat.
