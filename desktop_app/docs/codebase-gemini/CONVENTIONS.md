# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | C# PascalCase, WebUI kebab-case, SQL migration prefix | `DatabaseService.cs`, `html-loader.js`, `V001_InitialSchema.sql` | `AugmentScale/Services/`, `AugmentScale/WebUI/js/` |
| Functions/methods | C# PascalCase, JavaScript camelCase | `EnsureInitialized()`, `initDashboard()` | `DatabaseService.cs:107`, `main.js:8` |
| Types/interfaces | C# PascalCase (records, classes, structs) | `TicketDto`, `CommandEnvelope` | `AugmentScale/Models/TicketDto.cs` |
| Variables/fields | C# private fields `_camelCase`, local vars `camelCase`, JS `camelCase` | `_database`, `isStable`, `pendingTickets` | `BridgeService.cs:22`, `state.js:5` |
| Constants | C# PascalCase or UPPER_SNAKE_CASE, JS UPPER_SNAKE_CASE | `FirstTicketNumber`, `IS_PRODUCTION` | `DatabaseService.cs:36`, `runtime.js:9` |
| Database identifiers | snake_case for tables and columns | `weigh_tickets`, `net_weight_kg` | `V001_InitialSchema.sql:170-206` |

### 2) Formatting and Linting

- Formatter: Standard Visual Studio / .NET SDK C# formatter and Prettier-compatible JavaScript rules (no explicit `.editorconfig` or `.prettierrc` committed).
- Linter: Built-in Roslyn analyzers via MSBuild (`<Nullable>enable</Nullable>`, `<ImplicitUsings>enable</ImplicitUsings>`).
- Enforced rules: Nullability annotations enabled (`Nullable=enable`), TreatWarningsAsErrors not explicitly enforced, ImplicitUsings enabled.
- Run commands:
  ```bash
  dotnet build AugmentScale.slnx -c Debug
  ```

### 3) Import and Module Conventions

- Import grouping/order:
  - C#: System namespaces first, followed by third-party packages (`Microsoft.Web.WebView2`, `Microsoft.Data.Sqlite`), then internal project namespaces (`AugmentScale.Models`, `AugmentScale.Services`).
  - JS: External runtime/utility imports first (`./html-loader.js`, `./runtime.js`), followed by screens and components (`./screens/login.js`), and CSS/bridge side-effects.
- Alias vs relative import policy:
  - C# uses direct project references without path aliasing.
  - JavaScript uses relative imports with mandatory `.js` file extensions (e.g., `import { state } from './state.js';`).
- Public exports/barrel policy:
  - No index/barrel files in C# or JS; modules directly import specific files.

### 4) Error and Logging Conventions

- Error strategy by layer:
  - C# Backend: Specific typed exceptions (`InvalidOperationException`, `TimeoutException`) caught at Bridge boundary and serialized into `{ success: false, error: message }` responses (`BridgeService.cs:104-109`).
  - WebUI Frontend: `sendCommand` rejects with `Error(message)`; UI presents error messages using toast alerts (`toast.js`) and inline form feedback.
  - Global WPF handlers: `App.xaml.cs` handles `DispatcherUnhandledException`, `AppDomain.CurrentDomain.UnhandledException`, and `TaskScheduler.UnobservedTaskException`, showing dialogs and writing to log files.
- Logging style and required context fields: Centralized file logging via `AppLog.cs` writing timestamped level and message (`[yyyy-MM-dd HH:mm:ss.fff] [LEVEL] message`) to `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log`.
- Sensitive-data redaction rules: Passwords and PINs are excluded from logs; DPAPI encrypts credentials in `secrets.dat`; plaintext PINs are purged from memory after hashing.

### 5) Testing Conventions

- Test file naming/location rule: Placed in `AugmentScale.Tests/`, named `*Tests.cs` (e.g., `DatabaseTests.cs`, `ProtocolTests.cs`).
- Mocking strategy norm: In-memory/temporary file structures using `TempDatabase` (IDisposable wrapper creating isolated GUID directory in `%TEMP%\AugmentScaleTests`). Loopback sockets (`TcpListener`) used for network/hardware simulation.
- Coverage expectation: `[TODO]` (no automated coverage threshold configured in `.csproj`). All 77 existing tests must pass with zero failures.

### 6) Evidence

- `AugmentScale/App.xaml.cs:33-40`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/BridgeService.cs:104-109`
- `AugmentScale/WebUI/js/runtime.js:28-38`
- `AugmentScale.Tests/DatabaseTests.cs:8-36`
