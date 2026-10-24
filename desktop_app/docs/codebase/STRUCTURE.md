# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `AugmentScale/` | Main WPF host application project: lifecycle, window, services, models, schema, resources, and the embedded WebUI | `AugmentScale/AugmentScale.csproj`, `AugmentScale/App.xaml.cs` |
| `AugmentScale/Services/` | Core backend services: serial scale reader, thin `DatabaseService` facade, bridge IPC, DPAPI config, audit logging, file logging | `AugmentScale/Services/` |
| `AugmentScale/Models/` | C# record models, DTOs (including `BootStateDto`), setup/secrets models, and command request/response contracts | `AugmentScale/Models/` |
| `AugmentScale/Data/` | Persistence infrastructure: `DatabaseContext`, `SchemaMigrator`, `Provisioner`, SQLite helpers, domain repositories, and domain services; `Data/Schema/` holds embedded SQL migrations (`V001_InitialSchema.sql`) | `AugmentScale/Data/` |
| `AugmentScale/Resources/` | Default bootstrap configuration template (`setup.json`) | `AugmentScale/Resources/setup.json` |
| `AugmentScale/WebUI/` | HTML, CSS, JavaScript (native ES modules), SVGs, partials, and font assets loaded in WebView2 | `AugmentScale/WebUI/index.html` |
| `AugmentScale.Protocol/` | Standalone class library for XK3190-D10 continuous framing, XOR checksum, encoding/decoding, and stability detection | `AugmentScale.Protocol/AugmentScale.Protocol.csproj`, `Xk3190FrameSplitter.cs`, `StabilityDetector.cs` |
| `AugmentScale.ScaleSimulator/` | Development-only WPF scale simulator with a loopback TCP frame server and simulation engine | `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`, `Networking/TcpFrameServer.cs`, `Simulation/SimulatorEngine.cs` |
| `AugmentScale.Tests/` | Automated xUnit test suite (protocol, simulator, TCP transport, and encrypted database) | `AugmentScale.Tests/AugmentScale.Tests.csproj`, `DatabaseTests.cs`, `ProtocolTests.cs` |
| `publish/` | Gitignored publish output (currently `publish/win-x64/`) | `.gitignore:12`, `publish/win-x64/` |
| `docs/codebase/` | Generated codebase onboarding documentation (this set of seven files) | This directory |
| `tools/` | Operational PowerShell helper to extract the SQLCipher database key from DPAPI | `tools/Get-DbKey.ps1` |
| `AugmentScale.slnx` | XML solution containing the app, protocol, simulator, and test projects | `AugmentScale.slnx` |
| `start-dev-sim.ps1` | Launcher that builds, starts the simulator, points `setup.json` at `TCP:127.0.0.1:<port>`, starts the app, then restores the port | `start-dev-sim.ps1:1-203` |
| `USER_MANUAL.md` | Operator, administrator, recovery, build, data-location, and troubleshooting manual | `USER_MANUAL.md` |
| `OPEN_RAW_DB.md` | Instructions for opening the SQLCipher database read-only, extracting the key, and validating data | `OPEN_RAW_DB.md` |

### 2) Entry Points

- **Main runtime entry:** `AugmentScale/App.xaml.cs` (`App.OnStartup`, `:17-87`) acquires the single-instance mutex, initializes `ConfigService`, constructs `DatabaseService`, `ScaleReaderService`, and `BridgeService`, shows `MainWindow`, then calls `DatabaseService.EnsureInitialized()` so the splash can paint while SQLCipher opens. `App.xaml` does not declare a `StartupUri`; the window is created explicitly.
- **UI boot entry:** `AugmentScale/MainWindow.xaml.cs` (`OnLoaded`, `:60-113`) verifies the WebView2 runtime, maps the virtual host `app.augmentscale.local` to the `WebUI` folder, attaches `BridgeService`, and navigates to `https://app.augmentscale.local/index.html`. The scale reader starts only after navigation succeeds (`:115-132`).
- **Web entry:** `AugmentScale/WebUI/index.html` loads `js/main.js` as a module (`:55`); `main.js` runs `bootstrap()` after `DOMContentLoaded` (`:25-76`). `loadProductionData()` calls `getBootState`, which returns operators, vehicles, pending tickets, up to 1,000 history tickets, next ticket number, and sync status (`WebUI/js/main.js:25-57`, `WebUI/js/state.js:485-509`, `Data/Services/BootStateService.cs`).
- **Secondary entry points:**
  - CLI PIN reset: `AugmentScale.exe --reset-pin <operator-id>` opens a WPF PIN-reset dialog, then exits (`App.xaml.cs:42-55`, `:108-195`).
  - Development simulator entry: `AugmentScale.ScaleSimulator/App.xaml.cs` and `MainWindow.xaml.cs` boot the simulator GUI.
  - Tests: the xUnit host discovers `AugmentScale.Tests/*.cs`.
- **How entry is selected:** Normal WPF executable invocation. The only alternate branch is the `--reset-pin` argument check before services are constructed. No environment- or config-driven startup modes exist other than the `AUGMENTSCALE_DATA_DIR` data-directory override.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| App shell (`App.xaml.cs`, `MainWindow.xaml.cs`) | Process lifecycle, single-instance guard, WebView2 initialization, window/fullscreen handling, loading overlay, fatal-error display | SQL, serial I/O, business rules |
| Configuration/secrets (`AugmentScale/Services/ConfigService.cs`) | Data-directory selection, `setup.json`, DPAPI-protected `secrets.dat`, PBKDF2 PIN hashes, paths resolution | Ticket, vehicle, or UI business rules |
| Persistence (`AugmentScale/Services/DatabaseService.cs`, `AugmentScale/Data/`, `AuditService.cs`) | Schema migration, provisioning, profiles, vehicles, ticket lifecycle, history/report queries, outbox/audit writes, scale health | UI state, DOM rendering, serial byte parsing |
| Models and commands (`AugmentScale/Models/`) | Immutable DTOs, domain models, setup/secrets models, command payloads, request/response envelopes | Persistence SQL, database queries, WebView2 calls, business-logic mutations |
| Protocol (`AugmentScale.Protocol/`) | Frame byte splitting, XOR checksum validation, frame decoding/encoding, stability variance math | UI elements, database connections, serial port OS handles |
| Scale transport (`AugmentScale/Services/ScaleReaderService.cs`) | COM port lifecycle, TCP socket client, reconnect loop, raw byte stream pump, status messages | Ticket persistence, business validations, UI layout |
| Bridge (`AugmentScale/Services/BridgeService.cs`) | Command validation/routing, WebView2 message deserialization, JSON serialization, UI thread marshaling, request/response correlation, push telemetry throttling, supervisor session token | Direct SQL queries (delegates to `DatabaseService`), business rules beyond authorization gating |
| WebUI (`AugmentScale/WebUI/`) | Screen rendering, client state, route navigation, validation, autocomplete, audio feedback, print layout, keyboard shortcuts, local display of locks | Direct file system access, raw SQL execution, native OS APIs, secret keys, authoritative PIN verification in production |
| Simulator (`AugmentScale.ScaleSimulator/`) | Standalone UI, loopback TCP server, synthetic scale frames/scenarios | Production database writes, real hardware access, production business logic |
| Tests (`AugmentScale.Tests/`) | Deterministic protocol, simulator, transport, and temporary-database coverage | Production-only startup wiring |

### 4) Naming and Organization Rules

- File naming pattern:
  - C# source files: PascalCase matching the class/struct/record name (`DatabaseService.cs`, `CommandEnvelope.cs`, `StabilityDetector.cs`); project folders are PascalCase.
  - WebUI JavaScript files: kebab-case (`html-loader.js`, `history-report.js`, `first-weigh.js`, `pin-auth.js`).
  - WebUI CSS and partial HTML files: kebab-case (`base.css`, `screen-dashboard.html`, `telemetry-bar.html`, `tokens.css`).
  - HTML screen partials: `screen-` prefix (`partials/screen-history.html`); modals are grouped in `partials/modals.html`.
  - Database migrations: `V###_Description.sql` (`V001_InitialSchema.sql`).
- Directory organization pattern:
  - C# backend: layer-based (`Services/`, `Models/`, `Models/Commands/`, `Data/`, `Data/Repositories/`, `Data/Services/`, `Data/Schema/`, `Resources/`).
  - WebUI frontend: screen/feature-based (`WebUI/js/screens/*.js`, `WebUI/partials/screen-*.html`, shared modules in `WebUI/js/*.js`, CSS in `WebUI/css/`).
- Import aliasing or path conventions:
  - C# uses file-scoped namespaces (`namespace AugmentScale.Services;`) and implicit global usings; no path aliases.
  - JavaScript uses native ES module relative imports with explicit `.js` extensions (e.g. `import { state } from './state.js';`); no path aliases and no barrel files.
  - `main.js` imports side-effect modules such as `./bridge.js` and `./telemetry.js` once (`main.js:23`).
  - HTML partials are not included by a server; `js/html-loader.js` fetches all 11 partials in parallel and injects them into `#app` in a fixed order (`html-loader.js:11-43`). New partials must be added to `PARTIALS`.
- Hidden/config directories: none found. `.github/`, `.vscode/`, and `.husky/` are absent; there is no `.editorconfig`, CI config, or pre-commit configuration.

### 5) Evidence

- `AugmentScale/App.xaml.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/AugmentScale.csproj`
- `AugmentScale/WebUI/index.html`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale/WebUI/js/html-loader.js`
- `AugmentScale/Services/`
- `AugmentScale/Data/`
- `AugmentScale/Models/`
- `AugmentScale.Protocol/`
- `AugmentScale.ScaleSimulator/`
- `AugmentScale.Tests/`
- `AugmentScale.slnx`
