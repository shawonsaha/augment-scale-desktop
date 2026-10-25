# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | C# PascalCase type names; WebUI JavaScript/HTML/CSS kebab-case; SQL migrations use a `V###_Description` prefix | `DatabaseService.cs`, `PdfArchiveService.cs`, `archive-report.js`, `screen-dashboard.html`, `V002_ArchiveRuns.sql` | `AugmentScale/Services/`, `AugmentScale/WebUI/`, `AugmentScale/Data/Schema/` |
| Functions/methods | C# PascalCase; JavaScript camelCase | `EnsureInitialized()`, `initDashboard()`, `loadProductionData`, `renderRows` | `Data/DatabaseContext.cs` (`EnsureInitialized`), `main.js:8`, `WebUI/js/state.js` |
| Types/interfaces | C# PascalCase; `sealed` for services/DTO helpers; `record` for immutable messages | `DatabaseService`, `TicketDto`, `CommandEnvelope`, `CreateTicketRequest` | `AugmentScale/Services/`, `AugmentScale/Models/` |
| Variables/fields | C# private fields `_camelCase`, local variables `camelCase`; JavaScript `camelCase` | `_database`, `_organizationId`, `isStable`, `pendingTickets` | `BridgeService.cs:22`, `Data/DatabaseContext.cs`, `state.js:5` |
| Constants/env vars | C# PascalCase; JavaScript `UPPER_SNAKE_CASE` or module-local uppercase | `FirstTicketNumber`, `ProfileAdminSessionLifetime`, `Iterations`, `IS_PRODUCTION`, `MAX_ATTEMPTS`, `PIN_LENGTH` | `Data/Repositories/TicketRepository.cs`, `BridgeService.cs:20`, `ConfigService.cs:15`, `runtime.js:9`, `pin-auth.js:10-11` |
| HTML | kebab-case IDs/classes; screen partials prefixed `screen-` | `screen-history`, `profile-pin-modal`, `sync-status-pill` | `WebUI/partials/`, `WebUI/index.html` |
| CSS | kebab-case classes; screen-scoped files; shared custom properties in `tokens.css` | `.weigh-layout`, `.sync-popover`, `--color-bg` | `WebUI/css/` |
| Test methods | `MethodOrFeature_Scenario_ExpectedResult` / `Method_Scenario_ExpectedBehavior` | `CreateTicket_NewPlate_AutoRegistersVehicle`, `Feed_PartialFrame_IsBufferedUntilCompleted`, `TicketLifecycle_CreateCompleteReprintVoid` | `AugmentScale.Tests/DatabaseTests.cs`, `ProtocolTests.cs` |
| Database identifiers | snake_case tables and columns; plural table names | `weigh_tickets`, `plate_normalized`, `net_weight_kg`, `created_at` | `Data/Schema/V001_InitialSchema.sql:170-206` |
| JSON payloads | camelCase on the WebView2 boundary | `ticketNumber`, `pendingQueue`, `isConnected` | `BridgeService.cs:88-110`, `WebUI/js/runtime.js` |

### 2) Formatting and Linting

- Formatter: none configured. No `.editorconfig`, CSharpier, or Prettier configuration exists. Observed style follows conventional .NET formatting and Prettier-compatible JavaScript (not machine-enforced).
- Linter: no standalone linter or analyzer package. No ESLint, Stylelint, HTMLHint, TypeScript, or `tsconfig.json` exists. The build uses built-in Roslyn analyzers via MSBuild.
- Most relevant enforced rules: `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>` in the C# projects. `TreatWarningsAsErrors` is not explicitly enforced. All projects target Windows x64.
- Run commands: there is no formatter or linter command. `dotnet build AugmentScale.slnx -c Debug` is the only static gate.
- Observed formatting:
  - C#: 4-space indentation, file-scoped namespaces, one type per file, XML doc comments on service classes and non-obvious methods (`Services/DatabaseService.cs`, `AuditService.cs:8-10`).
  - JavaScript: 2-space indentation, single quotes, semicolons, trailing commas in multiline literals, JSDoc-style block comments at the top of larger modules (`state.js:1-8`, `sync.js:1-6`).
  - CSS: 2-space indentation and section comments.
- Comment convention: explain intent or constraints, not syntax. The codebase uses explicit `shortcut:` markers for temporary tradeoffs (`AugmentScale.csproj:31`, `ScaleReaderService.cs:136`, `pin-auth.js:5`).

### 3) Import and Module Conventions

- C#:
  - `using` directives at the top; `System.*` namespaces first, then third-party packages (`Microsoft.Web.WebView2`, `Microsoft.Data.Sqlite`), then internal project namespaces (`AugmentScale.Models`, `AugmentScale.Services`).
  - File-scoped namespace declarations (`namespace AugmentScale.Services;`).
  - Constructor injection of collaborators; optional dependencies are nullable with defaults (`Services/DatabaseService.cs` constructor, `BridgeService.cs:28-48`).
  - Persistence follows the domain split under `AugmentScale/Data/`: public interfaces, `internal sealed` implementations, one `DatabaseContext` per `DatabaseService`, and manual composition in the facade. New SQL belongs in the owning repository/service, not the facade.
  - No index/barrel files; types are imported directly.
  - `InternalsVisibleTo("AugmentScale.Tests")` is used for test seams and is marked as temporary (`AugmentScale.csproj:31-32`, `ScaleReaderService.cs:136`).
- JavaScript:
  - Native ES modules only; explicit relative paths and `.js` extensions (`main.js:1-23`, `login.js:12-20`).
  - Typical import order is runtime/utility modules first, then screens and components, with CSS and bridge side-effects imported once from `main.js`.
  - Named exports; no default exports, no barrels, and no path aliases.
  - Side-effect modules are imported once in `main.js` (`./bridge.js`, `./telemetry.js`).
  - Screen modules expose an `init` function and listen for the `screenchange` event; navigation is centralized in `router.js`.
- HTML/CSS:
  - All partials are fetched and injected by `html-loader.js` in a fixed order; new partials must be added to `PARTIALS` (`html-loader.js:11-28`).
  - Screen-specific CSS is linked from `index.html`; shared tokens come first.
  - Asset cache busting uses manual `?v=` query strings, currently `layout.css?v=prod6`, `main.js?v=prod15`, and `ASSET_VERSION='prod12'` for partial loading (`index.html`, `html-loader.js`). Bump the affected version when changing CSS, scripts, or partials.

### 4) Error and Logging Conventions

- C# error handling:
  - Expected business failures return result tuples such as `(bool Ok, string? Error)` instead of exceptions (`Data/Repositories/VehicleRepository.cs` (`ArchiveVehicle`, `DeleteVehicle`)).
  - Invalid state/data throws typed exceptions such as `InvalidOperationException`, `ArgumentException`, or `TimeoutException`.
  - `BridgeService` catches all exceptions, logs them, and returns `CommandResponse.Fail(ex.Message)` (`BridgeService.cs:96-108`). Raw exception messages therefore reach the UI and may include file paths or SQLite details.
  - Startup and unhandled exceptions are written through `AppLog.Error` and shown in a WPF `MessageBox` (`App.xaml.cs:76-84`, `:197-231`).
  - Global WPF handlers cover `DispatcherUnhandledException`, `AppDomain.CurrentDomain.UnhandledException`, and `TaskScheduler.UnobservedTaskException` (`App.xaml.cs:33-40`).
- Logging style: no logging framework. `AppLog` is a minimal static rolling file logger (`AppLog.cs:7-53`) that writes `[yyyy-MM-dd HH:mm:ss.fff] [LEVEL] message` to `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log` and deletes files older than 30 days. Levels used are `INFO` and `ERROR`.
- Audit logging: business mutations call `AuditService.InsertMutation` inside the same SQLite transaction, then insert an `outbox_events` row via `DatabaseContext.InsertOutbox`. Audit rows store before/after JSON and an optional reason (`AuditService.cs:8-10`, `:18-75`; `Data/DatabaseContext.cs`).
- JavaScript error handling:
  - `sendCommand` rejects on `success: false` or a 30-second timeout (`runtime.js:47-69`).
  - Screen handlers catch bridge errors and render a field-level error or toast; there is no global error boundary (`login.js:327-430`, `profiles.js:292-385`).
- Sensitive-data redaction:
  - Passwords and PINs are never logged and are cleared from the input immediately after submission (`login.js:377-379`).
  - DPAPI encrypts credentials in `secrets.dat`; plaintext PINs are purged from memory after hashing.
  - Raw exception messages are returned to the UI, so internal details can surface in toasts or form errors (documented as a security concern in `CONCERNS.md`).

### 5) Testing Conventions

- Test file naming/location: all tests live in `AugmentScale.Tests/` and are named `*Tests.cs` (`DatabaseTests.cs`, `PdfArchiveTests.cs`, `ProtocolTests.cs`, `SimulatorEngineTests.cs`, `SimulatorProtocolTests.cs`).
- Mocking strategy: no mocking framework. Tests use real SQLCipher files, real TCP loopback, deterministic protocol fixtures, and a reusable `TempDatabase` `IDisposable` helper. `TempDatabase` creates an isolated GUID directory in `%TEMP%\AugmentScaleTests` per test and deletes it on disposal (`DatabaseTests.cs:8-36`). Loopback sockets (`TcpListener`) simulate network/hardware; `TimeoutThenFrameStream` simulates serial read timeouts. `PdfArchiveTests` uses a fake `IPdfArchiveRenderer` and injected local clock.
- Test structure: implicit Arrange/Act/Assert separated by blank lines; expected failures use `Assert.Throws<T>` or result-tuple assertions.
- Coverage expectation: `[TODO]` — no automated coverage tool or threshold is configured. All 82 existing tests are expected to pass with zero failures.

### 6) Evidence

- `AugmentScale/App.xaml.cs:33-40`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/Services/BridgeService.cs:104-109`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Data/`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale/WebUI/js/html-loader.js`
- `AugmentScale/WebUI/js/runtime.js:28-38`
- `AugmentScale/WebUI/js/pin-auth.js`
- `AugmentScale/WebUI/js/screens/login.js`
- `AugmentScale/WebUI/js/screens/profiles.js`
- `AugmentScale.Tests/DatabaseTests.cs:8-36`
- `AugmentScale.Tests/ProtocolTests.cs`
