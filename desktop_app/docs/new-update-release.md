### What Was Built & Integrated

#### 1. Official Entry Point & Velopack Initialization ([`Program.cs`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Program.cs))
- Configured as the application entry point (`<StartupObject>`).
- Calls `VelopackApp.Build().Run()` before any UI or database initializes, enabling seamless update hooks, desktop/start menu shortcuts, and zero-UAC per-user installations.

#### 2. Background Auto-Update Engine ([`UpdateService.cs`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/UpdateService.cs))
- **Non-blocking background checks:** Runs an initial check 30 seconds after startup and periodically (hourly) in the background.
- **Delta updates:** Clients only download the binary diff (e.g. **59 KB** instead of a full ~13 MB build), saving bandwidth at remote weighbridge locations.
- **Safe staged updates:** When an update is downloaded, it stages it via `WaitExitThenApplyUpdates()` so it applies automatically when the operator closes the app at the end of their shift.
- **Weighbridge safety lock:** If an immediate restart is requested via `ApplyUpdatesAndRestart()`, it verifies that no active truck (> 50 kg) is on the scale platform.

#### 3. Cloud & Workstation Control Integration ([`CloudControlService.cs`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs))
- **Live Version Reporting:** Every heartbeat now sends the real installed `app_version` to Supabase `workstation_controls`.
- **Remote Push Trigger:** When an admin bumps `min_app_version` in Supabase, the workstation automatically triggers an immediate update check.

#### 4. Web UI Bridge Commands ([`BridgeService.cs`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs))
- `getUpdateStatus`: Retrieves current version, target version, progress, and status.
- `checkForUpdate`: Triggers a manual check.
- `applyUpdateAndRestart`: Restarts the app and applies the staged update.
- Pushes `window.ScaleApp.onUpdateStatus(...)` events to the WebView2 interface.

#### 5. Automated Build & Release Packaging ([`publish.ps1`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/publish.ps1))
Added `-Pack`, `-AppVersion`, and `-CleanReleases` parameters to build one-click setup installers and delta packages.

---

### How to Publish Updates

#### To Create a New Release:
When you have made code changes and are ready to release version `1.0.1`:

```powershell
.\publish.ps1 -NoZip -Pack -AppVersion 1.0.1
```

This automatically generates in the `releases/` directory:
1. `AugmentScale-win-Setup.exe` — The one-click standalone installer for new client PCs.
2. `AugmentScale-1.0.1-delta.nupkg` — A lightweight delta package (~59 KB) for existing clients.
3. `releases.win.json` — The metadata manifest.

#### To Host Updates:
1. Create a public bucket in your **Supabase Storage** named `releases`.
2. Upload the files from your local `releases/` folder to the `releases` bucket.
3. Client workstations will automatically detect the new release, download the 59 KB delta package in the background, and apply it upon closing or restarting!

*(All 119 unit tests passing)*

### How to Upload Releases to Your Private Bucket

Run the automated helper script with your `service_role` secret (from [Supabase API Settings](https://supabase.com/dashboard/project/fydikuezxmbjnkjyskwi/settings/api)):

```powershell
.\upload-releases.ps1 -ServiceRoleKey 'YOUR_SERVICE_ROLE_KEY'
```

*Or drag and drop the files from your local `releases/` folder directly into your private `releases` bucket in the Supabase Dashboard.*

The release package build is complete and all 121 unit tests have passed. 

The updated installer [`AugmentScale-win-Setup.exe`](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/releases/AugmentScale-win-Setup.exe) and packages in `releases/` are ready. Once you upload them to your private `releases` bucket, clients will fetch and apply future updates securely through the authenticated endpoint.
