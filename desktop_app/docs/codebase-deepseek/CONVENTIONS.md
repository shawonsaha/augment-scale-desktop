# Code Conventions

## Core Sections (Required)

### 1) Naming Rules

| Category | Convention | Examples | Evidence |
|----------|------------|----------|----------|
| C# types | PascalCase; `sealed` for services/DTO helpers; `record` for immutable messages | `DatabaseService`, `ScaleReaderService`, `TicketDto`, `CreateTicketRequest` | `AugmentScale/Services/`, `AugmentScale/Models/` |
| C# members | PascalCase for methods/properties/events; `_camelCase` for private fields | `EnsureInitialized`, `ReadingReceived`, `_organizationId` | `DatabaseService.cs:28-64`, `ScaleReaderService.cs:21-33` |
| C# constants | PascalCase | `FirstTicketNumber`, `ProfileAdminSessionLifetime`, `Iterations` | `DatabaseService.cs:36-38`, `BridgeService.cs:20`, `ConfigService.cs:15` |
| JavaScript variables/functions | camelCase; `SCREAMING_SNAKE_CASE` for exported constants; module-local uppercase for limits | `loadProductionData`, `renderRows`, `MAX_ATTEMPTS`, `PIN_LENGTH` | `WebUI/js/state.js`, `WebUI/js/pin-auth.js:10-11` |
| JavaScript modules/files | kebab-case file, named exports, no default exports | `pin-auth.js`, `first-weigh.js`, `history-report.js` | `WebUI/js/screens/` |
| HTML | kebab-case IDs/classes; screen partials prefixed `screen-` | `screen-history`, `profile-pin-modal`, `sync-status-pill` | `WebUI/partials/`, `WebUI/index.html` |
| CSS | kebab-case classes; screen-scoped files; CSS custom properties in `tokens.css` | `.weigh-layout`, `.sync-popover`, `--color-bg` | `WebUI/css/` |
| Test methods | `MethodOrFeature_Scenario_ExpectedResult` | `CreateTicket_NewPlate_AutoRegistersVehicle`, `Feed_PartialFrame_IsBufferedUntilCompleted` | `AugmentScale.Tests/DatabaseTests.cs`, `ProtocolTests.cs` |
| Database | snake_case tables/columns; plural table names | `weigh_tickets`, `plate_normalized`, `created_at` | `Data/Schema/V001_InitialSchema.sql` |
| JSON payloads | camelCase on the WebView2 boundary | `ticketNumber`, `pendingQueue`, `isConnected` | `BridgeService.cs:88-110`, `WebUI/js/runtime.js` |

### 2) Formatting and Linting

- Formatter: none. No `.editorconfig`, CSharpier, or Prettier configuration exists.
- Linter: none. No Roslyn analyzer package, ESLint, Stylelint, or HTMLHint configuration exists. The project has no TypeScript and no `tsconfig.json`; browser code is plain ES modules.
- Most relevant enforced rules: C# has `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>`; all projects target x64/Windows. Nothing else is machine-enforced.
- Run commands: no formatter/linter command. `dotnet build AugmentScale.slnx -c Debug` is the only static gate; it currently produces no errors.
- Observed formatting:
  - C#: 4-space indentation, file-scoped namespaces, one type per file, XML doc comments on service classes and non-obvious methods (`DatabaseService.cs:11-17`, `AuditService.cs:8-10`).
  - JavaScript: 2-space indentation, single quotes, semicolons, trailing commas in multiline literals, JSDoc-style block comments at the top of larger modules (`state.js:1-8`, `sync.js:1-6`).
  - CSS: 2-space indentation and section comments.
- Comment convention: explain intent or constraints, not syntax. The codebase uses explicit `shortcut:` markers for temporary tradeoffs (`pin-auth.js:5`, `ScaleReaderService.cs:136`).

### 3) Import and Module Conventions

- C#:
  - `using` directives at the top, `System.*` first, then project namespaces (`DatabaseTests.cs:1-4`).
  - File-scoped namespace declarations (`namespace AugmentScale.Services;`).
  - Constructor injection of collaborators; optional dependencies are nullable with defaults (`DatabaseService.cs:94`, `BridgeService.cs:28-48`).
  - `InternalsVisibleTo("AugmentScale.Tests")` is used for test seams, marked as temporary (`AugmentScale.csproj:31-32`, `ScaleReaderService.cs:136`).
- JavaScript:
  - Native ES modules only; explicit relative paths and `.js` extensions (`main.js:1-23`, `login.js:12-20`).
  - Named exports; no barrels and no path aliases.
  - Side-effect modules are imported once in `main.js` (`./bridge.js`, `./telemetry.js`).
  - Screen modules expose an `init` function and listen for the `screenchange` event; navigation is centralized in `router.js`.
- HTML/CSS:
  - All partials are fetched and injected by `html-loader.js` in a fixed order; new partials must be added to `PARTIALS` (`html-loader.js:11-28`).
  - Screen-specific CSS is linked from `index.html`; shared tokens come first.
  - Asset cache busting uses manual `?v=` query strings, currently `prod2`–`prod5` for CSS and `prod11` for scripts (`index.html:14-50`).

### 4) Error and Logging Conventions

- C# error handling:
  - Expected business failures return result tuples such as `(bool Ok, string? Error)` instead of exceptions (`DatabaseService.cs:790`, `:870`).
  - Invalid state/data throws `InvalidOperationException` or `ArgumentException`; `BridgeService` catches all exceptions, logs them, and returns `CommandResponse.Fail(ex.Message)` (`BridgeService.cs:96-108`).
  - Startup and unhandled exceptions are written through `AppLog.Error` and shown in a WPF MessageBox (`App.xaml.cs:76-84`, `:197-231`).
- Logging framework: none. `AppLog` is a minimal static rolling file logger (`AppLog.cs:7-53`). It writes `INFO`/`ERROR` and deletes files older than 30 days.
- Audit logging: business mutations call `AuditService.InsertMutation` inside the same SQLite transaction, then insert an `outbox_events` row. Audit rows store before/after JSON and optional reason (`AuditService.cs:8-10`, `:18-75`; `DatabaseService.cs:912-916`).
- JavaScript error handling:
  - `sendCommand` rejects on `success: false` or a 30-second timeout (`runtime.js:47-69`).
  - Screen handlers catch bridge errors and render a field-level error or toast; they do not use a global error boundary (`login.js:327-430`, `profiles.js:292-385`).
- Redaction/security: PINs are never logged and are cleared from the input immediately after submission (`login.js:377-379`). Raw exception messages are returned to the UI, so internal details can surface in toasts or form errors.

### 5) Testing Conventions

- Test framework: xUnit with the default `Assert` API; no FluentAssertions, Moq, or AutoFixture.
- Test layout: four files under `AugmentScale.Tests/`; `TempDatabase` is a reusable `IDisposable` helper declared at the top of `DatabaseTests.cs:8-36`. It creates a unique temp data directory, initializes `ConfigService` and `DatabaseService`, and deletes the directory afterward.
- Test naming: `Method_Scenario_ExpectedBehavior`, e.g. `TicketLifecycle_CreateCompleteReprintVoid`, `HistoryReport_RejectsWrongPinWithoutAuditAndHashesSuccessfulSnapshot`.
- Structure: implicit Arrange/Act/Assert separated by blank lines; expected failures use `Assert.Throws<T>` or result-tuple assertions.
- Mocking/isolation: no mocking framework. Tests use real SQLCipher files, real TCP loopback, and deterministic protocol fixtures. The only injected seam is the `keepRunning` predicate in `ScaleReaderService.ProcessStream` for timeout tests (`ScaleReaderService.cs:136-141`).
- Commands: `dotnet test AugmentScale.slnx -c Debug`. No coverage command or threshold is configured; coverage expectation is none enforced `[TODO]` decide whether to add a threshold.

### 6) Evidence

- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale/WebUI/js/html-loader.js`
- `AugmentScale/WebUI/js/pin-auth.js`
- `AugmentScale/WebUI/js/screens/login.js`
- `AugmentScale/WebUI/js/screens/profiles.js`
- `AugmentScale.Tests/DatabaseTests.cs`
- `AugmentScale.Tests/ProtocolTests.cs`
