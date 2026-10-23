# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `AugmentScale/` | Main WPF host application project, services, models, embedded SQL migrations, and WebUI | `AugmentScale/AugmentScale.csproj` |
| `AugmentScale/Services/` | Core backend services (serial scale reader, SQLCipher DB, bridge IPC, DPAPI config, audit logging) | `AugmentScale/Services/` |
| `AugmentScale/Models/` | C# record models, DTOs, and command request/response contracts | `AugmentScale/Models/` |
| `AugmentScale/Data/Schema/` | Embedded SQL database migration scripts (`V001_InitialSchema.sql`) | `AugmentScale/Data/Schema/` |
| `AugmentScale/Resources/` | Default bootstrap configuration template (`setup.json`) | `AugmentScale/Resources/setup.json` |
| `AugmentScale/WebUI/` | HTML, CSS, JavaScript (ES modules), SVGs, and font assets loaded in WebView2 | `AugmentScale/WebUI/index.html` |
| `AugmentScale.Protocol/` | Class library for XK3190-D10 continuous framing, checksum XOR, and stability detection | `AugmentScale.Protocol/AugmentScale.Protocol.csproj` |
| `AugmentScale.ScaleSimulator/` | Standalone WPF simulator sending continuous XK3190 indicator frames over TCP | `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj` |
| `AugmentScale.Tests/` | Automated xUnit test suite (protocol, database transactions, simulator, and TCP transport) | `AugmentScale.Tests/AugmentScale.Tests.csproj` |
| `docs/codebase/` | Generated codebase architecture, stack, and convention documentation | `docs/codebase/` |
| `tools/` | Utility scripts (`Get-DbKey.ps1` for DPAPI key extraction) | `tools/Get-DbKey.ps1` |
| `AugmentScale.slnx` | Solution definition file in .NET 10 XML solution format | `AugmentScale.slnx` |
| `start-dev-sim.ps1` | Development orchestration script launching both simulator and workstation | `start-dev-sim.ps1` |
| `USER_MANUAL.md` | Comprehensive operator, administrator, recovery, and operational manual | `USER_MANUAL.md` |
| `OPEN_RAW_DB.md` | Operational guide for extracting the SQLCipher key and inspecting SQLite tables | `OPEN_RAW_DB.md` |

### 2) Entry Points

- **Main runtime entry:** `AugmentScale/App.xaml.cs` (`App.OnStartup`). Enforces single-instance execution via `Local\AugmentScale.SingleInstance` mutex, initializes `ConfigService`, starts `MainWindow.xaml.cs`, maps `app.augmentscale.local` virtual host to `WebUI/`, and boots `WebUI/js/main.js`.
- **Secondary entry points:**
  - CLI PIN Reset: `AugmentScale.exe --reset-pin <operator-id>` invoked directly from command line, handled in `AugmentScale/App.xaml.cs:42-55`.
  - Development Simulator Entry: `AugmentScale.ScaleSimulator/App.xaml.cs` boots WPF GUI `MainWindow.xaml.cs` to emulate live weighbridge hardware.
- **How entry is selected:** Standard Windows executable invocation; command line argument `--reset-pin` branches execution to GUI PIN reset dialog before normal window startup.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `AugmentScale.Protocol` | Frame byte splitting, checksum validation, frame decoding, stability variance detection, frame encoding | UI elements, database connections, serial port OS handles |
| `AugmentScale/Services` | Hardware serial I/O, SQLCipher transactions, DPAPI encryption, IPC routing, file logging | Direct DOM manipulation, UI presentation rendering |
| `AugmentScale/Models` | Immutable DTOs, domain models, command payloads, request/response envelopes | Business logic mutations, database queries, hardware calls |
| `AugmentScale/WebUI` | User interface presentation, client route rendering, form validation, print templates, keyboard shortcuts | Direct file system access, raw SQL execution, secret keys |
| `AugmentScale.ScaleSimulator` | Standalone UI and TCP server for generating test weight telemetry | Production database writes or live COM port contention |

### 4) Naming and Organization Rules

- File naming pattern:
  - C# source files: PascalCase matching class/struct/record name (`DatabaseService.cs`, `CommandEnvelope.cs`, `StabilityDetector.cs`).
  - WebUI JavaScript files: kebab-case (`html-loader.js`, `history-report.js`, `first-weigh.js`).
  - WebUI CSS and partial HTML files: kebab-case (`base.css`, `screen-dashboard.html`, `telemetry-bar.html`).
  - Database migrations: `V###_Description.sql` (`V001_InitialSchema.sql`).
- Directory organization pattern:
  - C# backend: Layered architecture (`Services/`, `Models/`, `Data/Schema/`, `Resources/`).
  - WebUI frontend: Feature/component based (`WebUI/js/screens/`, `WebUI/partials/`, `WebUI/css/`).
- Import aliasing or path conventions:
  - C# uses file-scoped namespaces (`namespace AugmentScale.Services;`) and implicit global usings.
  - JavaScript uses native ES module relative imports with explicit `.js` extensions (e.g. `import { state } from './state.js';`).

### 5) Evidence

- `AugmentScale/App.xaml.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/AugmentScale.csproj`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale.Protocol/AugmentScale.Protocol.csproj`
- `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`
- `AugmentScale.Tests/AugmentScale.Tests.csproj`
