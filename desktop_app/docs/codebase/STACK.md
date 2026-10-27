# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | C# 13 for the WPF host, services, protocol, and tests; JavaScript (ES2020+, native ES modules), HTML, CSS, XAML, and SQL for the operator UI | `AugmentScale/AugmentScale.csproj`, `AugmentScale/WebUI/js/main.js`, `AugmentScale.Tests/DatabaseTests.cs` |
| Runtime + version | .NET 10.0. App, test, and simulator projects target `net10.0-windows`; the protocol library targets `net10.0`. Microsoft Edge WebView2 Evergreen runtime | `AugmentScale/AugmentScale.csproj:4`, `AugmentScale.Tests/AugmentScale.Tests.csproj:3`, `AugmentScale.Protocol/AugmentScale.Protocol.csproj`, `USER_MANUAL.md:7` |
| Package manager | NuGet through the `dotnet` CLI. Versions are pinned in each `.csproj`; no `packages.lock.json` or NuGet lock mode is configured | `AugmentScale/AugmentScale.csproj:23-28`, `AugmentScale.Tests/AugmentScale.Tests.csproj:11-15` |
| Module/build system | Microsoft.NET.Sdk / MSBuild driven by the .NET 10 XML solution `AugmentScale.slnx`. The WebUI runtime has no bundler, transpiler, or package manager; `index.html` loads `js/main.js` as a native module. Compile-time type checking and intellisense are provided in the editor via `WebUI/jsconfig.json` (`checkJs: true`), `WebUI/js/types.d.ts`, and JSDoc (`@ts-check`) across bridge boundaries | `AugmentScale.slnx`, `AugmentScale/AugmentScale.csproj:1`, `AugmentScale/WebUI/index.html:55`, `AugmentScale/WebUI/jsconfig.json`, `USER_MANUAL.md:50` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| `Microsoft.Web.WebView2` | 1.0.4258.31 | Embedded Chromium web host for the local HTML/CSS/JS interface; provides the postMessage RPC channel and offscreen A4 PDF rendering for the automatic archive | `AugmentScale/AugmentScale.csproj:24`, `AugmentScale/MainWindow.xaml.cs:75-98`, `AugmentScale/Services/WebViewPdfArchiveRenderer.cs` |
| `Microsoft.Data.Sqlite.Core` | 10.0.2 | SQLite ADO.NET database provider | `AugmentScale/AugmentScale.csproj:25`, `AugmentScale/Data/DatabaseContext.cs` (`OpenConnection`) |
| `SQLitePCLRaw.bundle_e_sqlcipher` | 2.1.11 | SQLCipher 4 native provider for AES-256 database encryption at rest | `AugmentScale/AugmentScale.csproj:26`, `AugmentScale/Data/DatabaseContext.cs` (`SqliteInitialized`, `OpenConnection`) |
| `System.IO.Ports` | 10.0.13 | Serial communications for the Yaohua XK3190-D10 RS-232 indicator; also used indirectly by the simulator's TCP transport | `AugmentScale/AugmentScale.csproj:27`, `AugmentScale/Services/ScaleReaderService.cs:100-123` |
| WPF (`UseWPF=true`) | .NET 10 in-box | Native Windows window shell, single-instance mutex, system dialogs, fullscreen/F11 handling, and loading overlay | `AugmentScale/AugmentScale.csproj:5`, `AugmentScale/MainWindow.xaml`, `AugmentScale/App.xaml.cs:108-195` |
| `System.Text.Json` | .NET 10 in-box | WebView2 command/response serialization, setup/secrets files, and outbox payloads | `AugmentScale/Services/BridgeService.cs:14-18`, `AugmentScale/Services/ConfigService.cs:23-28` |
| Windows DPAPI (`ProtectedData`) | Windows in-box | Protects `secrets.dat`, which holds the database key and PBKDF2 PIN hashes | `AugmentScale/Services/ConfigService.cs:17`, `ConfigService.cs:185-266` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| .NET 10 SDK / `dotnet` CLI | Restore, build, test, run, and publish | `USER_MANUAL.md:96-142` |
| `xunit` | 2.9.3 unit and integration test framework | `AugmentScale.Tests/AugmentScale.Tests.csproj:13` |
| `Microsoft.NET.Test.Sdk` | 17.14.1 test host | `AugmentScale.Tests/AugmentScale.Tests.csproj:12` |
| `xunit.runner.visualstudio` | 3.1.4 Visual Studio / `dotnet test` runner | `AugmentScale.Tests/AugmentScale.Tests.csproj:14` |
| `AugmentScale.ScaleSimulator` | Internal WPF GUI simulating a continuous XK3190-D10 stream over TCP | `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj` |
| PowerShell 5.1+ | Development launcher (`start-dev-sim.ps1`) and DPAPI key extraction (`tools/Get-DbKey.ps1`) | `start-dev-sim.ps1`, `tools/Get-DbKey.ps1` |
| Microsoft Edge WebView2 Evergreen Runtime | Required runtime dependency on each workstation; not vendored by the app | `USER_MANUAL.md:148`, `AugmentScale/MainWindow.xaml.cs:64-107` |
| EditorConfig / formatter / linter | VS Code / Visual Studio TypeScript language service configured via `AugmentScale/WebUI/jsconfig.json` (`checkJs: true`) using `types.d.ts` and JSDoc (`@ts-check`) on bridge boundary modules; no `.editorconfig`, CSharpier, Prettier, ESLint, or Stylelint | `AugmentScale/WebUI/jsconfig.json`, `AugmentScale/WebUI/js/types.d.ts` |
| CI/CD, containers | None configured: no `.github/`, GitLab/Jenkins config, Dockerfile, or compose file | Repository scan `[TODO]` |

### 4) Key Commands

Run from `desktop_app/`:

```powershell
# Restore project dependencies
dotnet restore AugmentScale.slnx

# Compile Debug build
dotnet build AugmentScale.slnx -c Debug

# Execute automated tests (91 tests)
dotnet test AugmentScale.slnx -c Debug

# Execute the same suite through the test project
dotnet test AugmentScale.Tests\AugmentScale.Tests.csproj -c Debug

# Run a specific test class
dotnet test AugmentScale.slnx -c Debug --filter "FullyQualifiedName~ProtocolTests"

# Run tests with detailed console logger
dotnet test AugmentScale.slnx -c Debug --logger "console;verbosity=detailed"

# Launch the application from source
dotnet run --project AugmentScale\AugmentScale.csproj

# Launch simulator and workstation with isolated database
powershell .\start-dev-sim.ps1
```

Framework-dependent production publish (requires the .NET 10 Desktop Runtime on the target):

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained false -o ".\publish\win-x64"
```

Self-contained publish:

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained true -o ".\publish\win-x64-selfcontained"
```

There is no standalone lint command. A full run produced `Passed: 91, Failed: 0, Total: 91` in about 50 seconds to 1 minute. Evidence: the test command above.

### 5) Environment and Config

- Config sources:
  - `AugmentScale/Resources/setup.json` is copied to the data directory as `setup.json` on first run (`ConfigService.cs:163-183`).
  - `%LOCALAPPDATA%\AugmentScale\setup.json` holds organization, site, weighbridge, scale connection, and bootstrap operator settings.
  - `%LOCALAPPDATA%\AugmentScale\secrets.dat` is a DPAPI-protected JSON file containing `databaseKey` and PBKDF2 PIN hashes (`ConfigService.cs:185-266`, `Models/SetupConfig.cs`).
  - `augment-scale.db` is the SQLCipher database (`ConfigService.cs:57`).
  - `archives/` holds baseline and daily archive PDFs and the `.staging/` work folder (`ConfigService.ArchiveDirectory`).
  - `logs/app-YYYYMMDD.log` is the rolling application log (`AppLog.cs:22-35`).
  - `WebView2/` is the browser user-data directory (`ConfigService.cs:58`).
- Default data directory: `%LOCALAPPDATA%\AugmentScale` (`ConfigService.cs:51-53`).
- Required env vars: none required for normal execution. Optional override: `AUGMENTSCALE_DATA_DIR` sets an isolated custom data directory for the database, secrets, logs, WebView2 profile, and `archives/` (`ConfigService.cs:35-38`). No other application environment variables are read.
- CLI arguments: `--reset-pin <operator-id>` opens a WPF PIN-reset dialog and then exits (`App.xaml.cs:42-55`, `:108-195`).
- `setup.json` keys: `organization`, `site`, `weighbridge`, `scaleConnection` (port name, baud/parity/stop bits, protocol format, stability window/tolerance), and `operators` bootstrap records (`Models/SetupConfig.cs`, `Resources/setup.json`).
- Deployment/runtime constraints:
  - Windows 10/11 64-bit (`x64` / `win-x64`) only.
  - Framework-dependent publish requires the .NET 10 Desktop Runtime; self-contained publish removes that requirement.
  - Microsoft Edge WebView2 Evergreen Runtime must be installed.
  - Hardware COM port or USB-to-RS-232 adapter for the scale indicator.
  - Single instance per Windows session enforced by mutex `Local\AugmentScale.SingleInstance` (`App.xaml.cs:21-31`).
  - No Docker, Kubernetes, or service-host deployment path exists.

### 6) Evidence

- `AugmentScale/AugmentScale.csproj`
- `AugmentScale.Protocol/AugmentScale.Protocol.csproj`
- `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`
- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.slnx`
- `AugmentScale/Resources/setup.json`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Data/DatabaseContext.cs`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/PdfArchiveService.cs`
- `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`
- `AugmentScale/Data/Schema/V002_ArchiveRuns.sql`
- `USER_MANUAL.md`
- `start-dev-sim.ps1`
- `tools/Get-DbKey.ps1`
