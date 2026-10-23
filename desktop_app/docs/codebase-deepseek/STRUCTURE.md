# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `AugmentScale/` | Main WPF + WebView2 application: lifecycle, window, services, models, schema, resources, and the entire WebUI | `AugmentScale/AugmentScale.csproj`, `AugmentScale/App.xaml.cs` |
| `AugmentScale.Protocol/` | Standalone XK3190 frame encoder/decoder/splitter and the rolling stability detector | `AugmentScale.Protocol/AugmentScale.Protocol.csproj`, `Xk3190FrameSplitter.cs`, `StabilityDetector.cs` |
| `AugmentScale.ScaleSimulator/` | Development-only WPF scale simulator with a loopback TCP frame server and simulation engine | `AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj`, `Networking/TcpFrameServer.cs`, `Simulation/SimulatorEngine.cs` |
| `AugmentScale.Tests/` | xUnit protocol, simulator, transport, and encrypted-database tests | `AugmentScale.Tests/AugmentScale.Tests.csproj`, `DatabaseTests.cs`, `ProtocolTests.cs` |
| `tools/` | Operational PowerShell helper to extract the SQLCipher database key from DPAPI | `tools/Get-DbKey.ps1` |
| `publish/` | Gitignored publish output (currently `publish/win-x64/`) | `.gitignore:12`, `publish/win-x64/` |
| `docs/codebase/` | Generated onboarding documentation (this set of seven files) | This directory |
| `start-dev-sim.ps1` | Launcher that builds, starts the simulator, points `setup.json` at `TCP:127.0.0.1:<port>`, starts the app, then restores the port | `start-dev-sim.ps1:1-203` |
| `USER_MANUAL.md` | Operator/installer manual, build commands, data locations, troubleshooting, and test guidance | `USER_MANUAL.md` |
| `OPEN_RAW_DB.md` | Instructions for opening the SQLCipher database read-only, extracting the key, and validating data | `OPEN_RAW_DB.md` |
| `AugmentScale.slnx` | XML solution containing the app, protocol, simulator, and test projects | `AugmentScale.slnx` |

### 2) Entry Points

- Main runtime entry: `AugmentScale/App.xaml.cs` (`App.OnStartup`, `:17-87`) creates the single-instance mutex, config, database, scale reader, bridge, and `MainWindow`. `App.xaml` does not declare a `StartupUri`; the window is created explicitly.
- UI boot entry: `AugmentScale/MainWindow.xaml.cs` (`OnLoaded`, `:60-113`) verifies WebView2, maps the virtual host, attaches the bridge, and navigates to `https://app.augmentscale.local/index.html`. The scale reader starts only after navigation succeeds (`:115-132`).
- Web entry: `AugmentScale/WebUI/index.html` loads `js/main.js` as a module (`:55`); `main.js` runs `bootstrap()` after `DOMContentLoaded` (`:25-76`).
- Secondary entry points:
  - CLI mode: `AugmentScale.exe --reset-pin <operator-id>` (`App.xaml.cs:42-55`).
  - Simulator: `AugmentScale.ScaleSimulator/App.xaml.cs` and `MainWindow.xaml.cs`.
  - Tests: xUnit host discovers `AugmentScale.Tests/*.cs`.
- How entry is selected: normal WPF startup; the only alternate branch is the `--reset-pin` argument check before services are constructed. No environment- or config-driven startup modes exist other than `AUGMENTSCALE_DATA_DIR`.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| App shell (`App.xaml.cs`, `MainWindow.xaml.cs`) | Process lifecycle, single-instance guard, WebView2 initialization, window/fullscreen handling, loading overlay | SQL, serial I/O, business rules |
| Services (`AugmentScale/Services/`) | Configuration/secrets, encrypted persistence, scale transport, WebView2 command routing, audit/outbox writes, file logging | UI markup or DOM-specific logic |
| Models and commands (`AugmentScale/Models/`) | DTOs, setup/secrets models, command envelopes, request records | Persistence SQL or WebView2 calls |
| Protocol (`AugmentScale.Protocol/`) | XK3190 byte framing/checksums/encoding and stability math | Database, UI, or hardware port ownership |
| WebUI (`AugmentScale/WebUI/`) | Screens, state, validation, operator interaction, print layout | Direct database/serial access; all durable writes go through the bridge |
| Simulator (`AugmentScale.ScaleSimulator/`) | Development TCP server and generated frames | Production business logic |
| Tests (`AugmentScale.Tests/`) | Deterministic protocol, simulator, and temporary-database coverage | Production-only startup wiring |

### 4) Naming and Organization Rules

- File naming pattern:
  - C#: PascalCase type names (`DatabaseService.cs`, `WeightReading.cs`), project folders in PascalCase.
  - JavaScript: kebab-case (`first-weigh.js`, `pin-auth.js`, `history-report.js`).
  - HTML partials: kebab-case with a `screen-` prefix for screens (`partials/screen-history.html`); modals grouped in `partials/modals.html`.
  - CSS: kebab-case, one file per screen/concern (`history-report.css`, `tokens.css`).
- Directory organization pattern:
  - C# is layer-based: `Services`, `Models`, `Models/Commands`, `Data/Schema`.
  - WebUI is screen/feature-based: `js/screens/*.js`, `partials/screen-*.html`, with shared modules at `js/*.js`.
- Import aliasing or path conventions:
  - C# uses file-scoped namespaces and relative `using` directives; no aliases.
  - JavaScript uses relative imports with explicit `.js` extensions; no path aliases and no barrel files. `main.js` imports side-effect modules such as `./bridge.js` (`:23`).
  - HTML partials are not included by the server; `js/html-loader.js` fetches all 11 partials in parallel and injects them into `#app` in a fixed order (`html-loader.js:11-43`).
- Hidden/config directories: none found. `.github/`, `.vscode/`, and `.husky/` are absent; there is no `.editorconfig`, CI config, or pre-commit configuration.

### 5) Evidence

- `AugmentScale/App.xaml.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/WebUI/index.html`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale/WebUI/js/html-loader.js`
- `AugmentScale/Services/`
- `AugmentScale/Models/`
- `AugmentScale.Protocol/`
- `AugmentScale.ScaleSimulator/`
- `AugmentScale.Tests/`
- `AugmentScale.slnx`
