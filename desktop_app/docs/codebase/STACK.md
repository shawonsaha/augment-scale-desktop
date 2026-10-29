# Technology Stack

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | C# 13 / .NET 10.0 (Host), JavaScript ES2022 / HTML5 / CSS3 (WebUI) | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L4) |
| Runtime + version | .NET 10.0 Desktop Runtime (`net10.0-windows` & `net10.0`), Microsoft Edge WebView2 Evergreen Runtime | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L4), [MainWindow.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/MainWindow.xaml.cs#L88) |
| Package manager | NuGet | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L20-L25) |
| Module/build system | .NET 10 SDK / MSBuild / Solution format (`AugmentScale.slnx`) | [AugmentScale.slnx](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.slnx#L1-L6) |

### 2) Production Frameworks and Dependencies

List only high-impact production dependencies (frameworks, data, transport, auth).

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| `Microsoft.Web.WebView2` | 1.0.4258.31 | Chromium browser hosting for desktop WebUI and PDF export rendering | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L21) |
| `Microsoft.Data.Sqlite.Core` | 10.0.2 | SQLite ADO.NET data access provider | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L22) |
| `SQLitePCLRaw.bundle_e_sqlcipher` | 2.1.11 | SQLCipher 256-bit AES encryption bundle for SQLite | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L23) |
| `System.IO.Ports` | 10.0.13 | Serial port (RS-232 / USB COM) communication with scale indicators | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L24) |
| Windows Presentation Foundation (WPF) | .NET 10.0 | Native Windows application windowing host, single-instance mutex, and system print integration | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L5) |
| `System.Net.Http` | Built-in .NET 10 | HTTP client for Supabase Cloud REST synchronization and heartbeat | [CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L4) |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| `Microsoft.NET.Test.Sdk` | 17.14.1 | Visual Studio / CLI test engine integration | [AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj#L12) |
| `xunit` | 2.9.3 | Test framework for unit, protocol, database, and archive test suites | [AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj#L13) |
| `xunit.runner.visualstudio` | 3.1.4 | Test discovery and test runner for `dotnet test` | [AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj#L14) |
| TypeScript Language Server (`types.d.ts`, `jsconfig.json`) | Type validation and IntelliSense for WebUI JavaScript modules | [jsconfig.json](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/jsconfig.json#L1-L15) |

### 4) Key Commands

```bash
# Restore project dependencies
dotnet restore AugmentScale.slnx

# Build solution in Debug configuration
dotnet build AugmentScale.slnx -c Debug

# Build solution in Release configuration
dotnet build AugmentScale.slnx -c Release

# Run entire automated test suite (107 tests)
dotnet test AugmentScale.slnx

# Publish win-x64 framework-dependent release package
dotnet publish AugmentScale/AugmentScale.csproj -c Release -r win-x64 --self-contained false

# Launch developer scale simulator environment
powershell -ExecutionPolicy Bypass -File .\start-dev-sim.ps1
```

### 5) Environment and Config

- Config sources:
  - `AugmentScale/Resources/setup.json` (embedded bootstrap defaults)
  - `%LOCALAPPDATA%\AugmentScale\setup.json` (deployed workstation config)
  - `%LOCALAPPDATA%\AugmentScale\secrets.dat` (Windows DPAPI-encrypted secrets)
- Required env vars:
  - None required for production operation.
  - Optional development/test override: `AUGMENTSCALE_DATA_DIR` overrides the default `%LOCALAPPDATA%\AugmentScale` directory.
- Deployment/runtime constraints:
  - OS: Windows 10 or Windows 11 (64-bit architecture `win-x64`).
  - Runtimes: .NET 10 Desktop Runtime + Evergreen WebView2 Runtime.
  - Process exclusivity: Single-instance guard enforced by named mutex (`Local\AugmentScale.SingleInstance`).
  - Serial port: Dedicated access to configured COM port or TCP simulator port.

### 6) Evidence

- [AugmentScale/AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj)
- [AugmentScale.Protocol/AugmentScale.Protocol.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Protocol/AugmentScale.Protocol.csproj)
- [AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj)
- [AugmentScale.Tests/AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj)
- [AugmentScale.slnx](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.slnx)
- [AugmentScale/Services/ConfigService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ConfigService.cs)
- [AugmentScale/Resources/setup.json](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Resources/setup.json)
