# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | PascalCase for C# files; kebab-case for WebUI files; uppercase prefix for SQL migrations | `TicketRepository.cs`, `first-weigh.js`, `V001_InitialSchema.sql` | [TicketRepository.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Repositories/TicketRepository.cs), [first-weigh.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/screens/first-weigh.js) |
| Functions/methods | PascalCase in C#; camelCase in JavaScript | `CompleteTicket`, `EnsureInitialized` vs `sendCommand`, `applyExternalWeight` | [DatabaseService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/DatabaseService.cs), [bridge.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/bridge.js) |
| Types/interfaces | PascalCase with `I` prefix for C# interfaces; PascalCase for classes and DTOs | `ITicketRepository`, `WeightReading`, `ProfileDto` | [ITicketRepository.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Repositories/ITicketRepository.cs), [WeightReading.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/WeightReading.cs) |
| Constants/env vars | PascalCase or UPPER_SNAKE_CASE in C#; UPPER_SNAKE_CASE in JavaScript and env vars | `DefaultDataDirectory`, `STX`, `IS_PRODUCTION`, `AUGMENTSCALE_DATA_DIR` | [ConfigService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ConfigService.cs), [runtime.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/runtime.js) |

### 2) Formatting and Linting

- Formatter: Built-in .NET SDK formatting (`dotnet format`) and standard Visual Studio C# indentation; 2-space indentation in WebUI HTML/CSS/JS.
- Linter: C# compiler analyzers enabled with `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>`; WebUI JavaScript enforced via `// @ts-check` headers and `jsconfig.json`.
- Most relevant enforced rules:
  - C# nullable reference type annotations enforced across all project assemblies.
  - Zero-warning clean test analyzer checks (xUnit analyzers).
  - JSDoc types validated via `types.d.ts` in VSCode language server.
- Run commands:
  - `dotnet build AugmentScale.slnx`
  - `dotnet test AugmentScale.slnx`

### 3) Import and Module Conventions

- Import grouping/order:
  - C#: System namespaces first, followed by third-party packages (`Microsoft.*`, `SQLitePCL`), followed by internal project namespaces (`AugmentScale.*`).
  - WebUI JavaScript: Relative ES module imports with explicit file extensions (e.g., `import { state } from './state.js';`).
- Alias vs relative import policy: Relative imports used exclusively across WebUI modules; C# utilizes project references and root namespaces.
- Public exports/barrel policy: WebUI exports top-level facade `ScaleApp` on `window` via `bridge.js`; C# projects expose internal APIs to test suite via `<InternalsVisibleTo Include="AugmentScale.Tests" />`.

### 4) Error and Logging Conventions

- Error strategy by layer:
  - Protocol: Returns nullable types (`DecodedFrame?`) or flags corrupted checksums rather than throwing exceptions during continuous stream reading.
  - Repositories: Throws descriptive `InvalidOperationException` or `ArgumentException` on invalid domain operations (e.g., duplicate open plate, missing operator, range validation).
  - BridgeService: Catches exceptions at dispatch level and serializes failure command responses (`CommandResponse.Fail(requestId, ex.Message)`), displaying user-facing toast notifications.
- Logging style and required context fields: Centralized file logger `AppLog` logs timestamp, thread ID, log level (`INFO`, `WARN`, `ERROR`), message, and exception stack traces to `%LOCALAPPDATA%\AugmentScale\logs\app-YYYY-MM-DD.log`.
- Sensitive-data redaction rules: Raw operator PINs and master database encryption keys are never logged; PINs exist only ephemerally in memory and are hashed with PBKDF2 before storage.

### 5) Testing Conventions

- Test file naming/location rule: Co-located in `AugmentScale.Tests` assembly matching subsystem name (e.g., `DatabaseTests.cs`, `ProtocolTests.cs`, `PdfArchiveTests.cs`).
- Mocking strategy norm:
  - Database: Tested with live temporary SQLCipher databases using `TempDatabase` fixture (`new TempDatabase()`), cleaned up on disposal.
  - PDF Renderer: Tested using in-memory mock renderer implementing `IPdfArchiveRenderer`.
  - Scale hardware: Tested using protocol buffer feeds and simulated TCP streams.
- Coverage expectation: Comprehensive test coverage of core protocol decoding, checksum validation, rolling stability, database migrations, and ticket lifecycles (107 passing tests in suite).

### 6) Evidence

- [AugmentScale/AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj)
- [AugmentScale/WebUI/jsconfig.json](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/jsconfig.json)
- [AugmentScale/Services/AppLog.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/AppLog.cs)
- [AugmentScale.Tests/DatabaseTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/DatabaseTests.cs)
- [AugmentScale/WebUI/js/runtime.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/runtime.js)
