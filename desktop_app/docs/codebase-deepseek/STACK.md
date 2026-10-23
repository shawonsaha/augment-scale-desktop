# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | C# for the WPF host, services, protocol, and tests; JavaScript (native ES modules), HTML, and CSS for the operator UI | `AugmentScale/AugmentScale.csproj`, `AugmentScale/WebUI/js/main.js`, `AugmentScale.Tests/DatabaseTests.cs` |
| Runtime + version | .NET 10. Desktop/test/simulator projects target `net10.0-windows`; the protocol library targets `net10.0` | `AugmentScale/AugmentScale.csproj:4`, `AugmentScale.Tests/AugmentScale.Tests.csproj:3`, `AugmentScale.Protocol/AugmentScale.Protocol.csproj` |
| Package manager | NuGet through the `dotnet` CLI. Versions are pinned in each `.csproj`; no `packages.lock.json` or NuGet lock mode was found `[TODO]` if reproducible transitive restore is required | `AugmentScale/AugmentScale.csproj:23-28`, `AugmentScale.Tests/AugmentScale.Tests.csproj:11-15` |
| Module/build system | MSBuild driven by the XML solution file `AugmentScale.slnx`. The WebUI has no bundler, transpiler, or package manager; `index.html` loads `js/main.js` as a native module | `AugmentScale.slnx`, `AugmentScale/WebUI/index.html:55` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| Microsoft.Web.WebView2 | 1.0.4258.31 | Embeds the Chromium-based UI in the WPF window and provides the postMessage RPC channel | `AugmentScale/AugmentScale.csproj:24`, `AugmentScale/MainWindow.xaml.cs:75-98` |
| Microsoft.Data.Sqlite.Core | 10.0.2 | ADO.NET access to the local SQLite/SQLCipher database | `AugmentScale/AugmentScale.csproj:25`, `AugmentScale/Services/DatabaseService.cs:126-140` |
| SQLitePCLRaw.bundle_e_sqlcipher | 2.1.11 | Supplies the SQLCipher provider used through `Password` on the connection string | `AugmentScale/AugmentScale.csproj:26`, `AugmentScale/Services/DatabaseService.cs:74-78`, `DatabaseService.cs:133` |
| System.IO.Ports | 10.0.13 | RS-232 transport for the XK3190-D10 indicator; also used indirectly by the simulator's TCP transport | `AugmentScale/AugmentScale.csproj:27`, `AugmentScale/Services/ScaleReaderService.cs:100-123` |
| WPF (`UseWPF`) | .NET 10 in-box | Window, loading overlay, fullscreen key handling, and `--reset-pin` dialog | `AugmentScale/AugmentScale.csproj:5`, `AugmentScale/MainWindow.xaml`, `AugmentScale/App.xaml.cs:108-195` |
| `System.Text.Json` | .NET 10 in-box | WebView2 command/response serialization, setup/secrets files, and outbox payloads | `AugmentScale/Services/BridgeService.cs:14-18`, `AugmentScale/Services/ConfigService.cs:23-28` |
| Windows DPAPI (`ProtectedData`) | Windows in-box | Protects `secrets.dat`, which holds the database key and PIN hashes | `AugmentScale/Services/ConfigService.cs:17`, `ConfigService.cs:185-266` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| .NET 10 SDK / `dotnet` CLI | Restore, build, test, run, publish | `USER_MANUAL.md:96-142` |
| xUnit 2.9.3 | Test framework | `AugmentScale.Tests/AugmentScale.Tests.csproj:13` |
| Microsoft.NET.Test.Sdk 17.14.1 | Test host | `AugmentScale.Tests/AugmentScale.Tests.csproj:12` |
| xunit.runner.visualstudio 3.1.4 | Visual Studio / `dotnet test` runner | `AugmentScale.Tests/AugmentScale.Tests.csproj:14` |
| PowerShell 5.1 scripts | Simulator launcher and database-key extraction | `start-dev-sim.ps1`, `tools/Get-DbKey.ps1` |
| Microsoft Edge WebView2 Evergreen Runtime | Required runtime dependency on each workstation; not vendored by the app | `USER_MANUAL.md:148`, `AugmentScale/MainWindow.xaml.cs:64-107` |
| EditorConfig / formatter / linter | None configured | No `.editorconfig`, ESLint, Prettier, or Roslyn analyzer config found in the repository `[TODO]` |
| CI/CD, containers | None configured | No `.github/`, GitLab/Jenkins config, Dockerfile, or compose file found |

### 4) Key Commands

Run from `desktop_app/`:

```powershell
dotnet restore AugmentScale.slnx
dotnet build AugmentScale.slnx -c Debug
dotnet test AugmentScale.slnx -c Debug
dotnet run --project AugmentScale\AugmentScale.csproj
.\start-dev-sim.ps1
```

Framework-dependent production publish (requires the .NET 10 Desktop Runtime on the target):

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained false -o ".\publish\win-x64"
```

Self-contained publish:

```powershell
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained true -o ".\publish\win-x64-selfcontained"
```

There is no lint command. A test run on 2026-10-24 produced `Passed: 77, Failed: 0, Total: 77` in 54 seconds. Evidence: `USER_MANUAL.md:90-119` and the test command above.

### 5) Environment and Config

- Config sources:
  - `AugmentScale/Resources/setup.json` is copied to the data directory as `setup.json` on first run (`ConfigService.cs:163-183`).
  - `secrets.dat` is a DPAPI-protected JSON file containing `databaseKey` and PBKDF2 PIN hashes (`ConfigService.cs:185-266`, `Models/SetupConfig.cs`).
  - `augment-scale.db` is the SQLCipher database (`ConfigService.cs:57`).
  - `logs/app-YYYYMMDD.log` is the rolling application log (`AppLog.cs:22-35`).
  - `WebView2/` is the browser user-data directory (`ConfigService.cs:58`).
- Default data directory: `%LOCALAPPDATA%\AugmentScale` (`ConfigService.cs:51-53`).
- Environment variables: `AUGMENTSCALE_DATA_DIR` overrides the entire data directory (`ConfigService.cs:35-38`). No other application environment variables are read.
- CLI arguments: `--reset-pin <operator-id>` opens a WPF PIN-reset dialog and exits (`App.xaml.cs:42-55`, `:108-195`).
- `setup.json` keys: `organization`, `site`, `weighbridge`, `scaleConnection` (`portName`, baud/parity/stop bits, `protocolFormat`, stability window/tolerance), and `operators` bootstrap records (`Models/SetupConfig.cs`, `Resources/setup.json`).
- Deployment/runtime constraints:
  - Windows x64 only (`PlatformTarget`/`RuntimeIdentifier` set to `x64`/`win-x64`).
  - Single instance per Windows session enforced by mutex `Local\AugmentScale.SingleInstance` (`App.xaml.cs:21-31`).
  - Framework-dependent publish requires the .NET 10 Desktop Runtime; self-contained publish removes that requirement (`USER_MANUAL.md:125-142`).
  - WebView2 Evergreen Runtime must be installed (`USER_MANUAL.md:148`).
  - No Docker, Kubernetes, or service-host deployment path exists.

### 6) Evidence

- `AugmentScale/AugmentScale.csproj`
- `AugmentScale.Protocol/AugmentScale.Protocol.csproj`
- `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`
- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.slnx`
- `AugmentScale/Resources/setup.json`
- `USER_MANUAL.md`
- `start-dev-sim.ps1`
- `tools/Get-DbKey.ps1`
