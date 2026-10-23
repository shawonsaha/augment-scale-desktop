# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | C# 13, JavaScript (ES2020+), XAML, SQL | `AugmentScale/AugmentScale.csproj`, `AugmentScale/WebUI/js/main.js` |
| Runtime + version | .NET 10.0 (`net10.0-windows` / `net10.0`), WebView2 Evergreen | `AugmentScale/AugmentScale.csproj:4`, `USER_MANUAL.md:7` |
| Package manager | NuGet (`AugmentScale.slnx` SDK 10 format) | `AugmentScale.slnx`, `AugmentScale/AugmentScale.csproj:23-28` |
| Module/build system | Microsoft.NET.Sdk / MSBuild (.NET 10 SDK) | `AugmentScale/AugmentScale.csproj:1`, `USER_MANUAL.md:50` |

### 2) Production Frameworks and Dependencies

List only high-impact production dependencies (frameworks, data, transport, auth).

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| `Microsoft.Web.WebView2` | 1.0.4258.31 | Embedded Chromium web host for local HTML5/CSS/JS user interface | `AugmentScale/AugmentScale.csproj:24` |
| `Microsoft.Data.Sqlite.Core` | 10.0.2 | SQLite ADO.NET database provider | `AugmentScale/AugmentScale.csproj:25` |
| `SQLitePCLRaw.bundle_e_sqlcipher` | 2.1.11 | SQLCipher 4 native provider for AES-256 database encryption at rest | `AugmentScale/AugmentScale.csproj:26` |
| `System.IO.Ports` | 10.0.13 | Serial communications for Yaohua XK3190-D10 RS-232 indicator | `AugmentScale/AugmentScale.csproj:27` |
| WPF (`UseWPF=true`) | Built-in .NET 10 | Native Windows application window shell, single-instance mutex, and system dialogs | `AugmentScale/AugmentScale.csproj:5` |
| Windows DPAPI | Built-in Windows | Machine/User-scoped encryption for database passphrase and operator PIN hashes | `AugmentScale/Services/ConfigService.cs:17` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| `xunit` | 2.9.3 | Unit and integration test framework | `AugmentScale.Tests/AugmentScale.Tests.csproj:13` |
| `xunit.runner.visualstudio` | 3.1.4 | Test runner execution integration | `AugmentScale.Tests/AugmentScale.Tests.csproj:14` |
| `Microsoft.NET.Test.Sdk` | 17.14.1 | .NET test execution SDK | `AugmentScale.Tests/AugmentScale.Tests.csproj:12` |
| `AugmentScale.ScaleSimulator` | Internal project | Standalone WPF GUI simulating XK3190-D10 continuous stream over TCP | `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj` |
| PowerShell 5.1+ | Automation | Development launcher (`start-dev-sim.ps1`) and DPAPI key extraction (`tools/Get-DbKey.ps1`) | `start-dev-sim.ps1`, `tools/Get-DbKey.ps1` |

### 4) Key Commands

```bash
# Restore project dependencies
dotnet restore AugmentScale.slnx

# Compile Debug build
dotnet build AugmentScale.slnx -c Debug

# Execute automated tests (77 tests)
dotnet test AugmentScale.slnx -c Debug

# Launch application from source
dotnet run --project AugmentScale\AugmentScale.csproj

# Launch simulator for development with isolated database
powershell .\start-dev-sim.ps1

# Publish production framework-dependent package
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained false -o ".\publish\win-x64"

# Publish self-contained package
dotnet publish AugmentScale\AugmentScale.csproj -c Release -r win-x64 --self-contained true -o ".\publish\win-x64-selfcontained"
```

### 5) Environment and Config

- Config sources: `%LOCALAPPDATA%\AugmentScale\setup.json` (seeded on first launch from `AugmentScale/Resources/setup.json`), `%LOCALAPPDATA%\AugmentScale\secrets.dat` (binary Windows DPAPI protected store).
- Required env vars: None required for normal execution. Optional override: `AUGMENTSCALE_DATA_DIR` sets an isolated custom working directory for database, secrets, and logs.
- Deployment/runtime constraints: Windows 10/11 64-bit (`win-x64`), .NET 10 Desktop Runtime, Microsoft Edge WebView2 Evergreen Runtime, hardware COM port or USB-to-RS-232 adapter.

### 6) Evidence

- `AugmentScale/AugmentScale.csproj`
- `AugmentScale.Protocol/AugmentScale.Protocol.csproj`
- `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`
- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.slnx`
- `AugmentScale/Services/ConfigService.cs`
- `USER_MANUAL.md`
