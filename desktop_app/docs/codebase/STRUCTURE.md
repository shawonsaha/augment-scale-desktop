# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

List only meaningful top-level directories and files.

| Path | Purpose | Evidence |
|------|---------|----------|
| `AugmentScale/` | Main WPF desktop application, WebView2 host, services, data repositories, embedded SQL migrations, and WebUI frontend | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj) |
| `AugmentScale.Protocol/` | Hardware protocol parsing library for Yaohua XK3190 indicator frames, checksums, and stability detection | [AugmentScale.Protocol.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Protocol/AugmentScale.Protocol.csproj) |
| `AugmentScale.ScaleSimulator/` | Standalone GUI WPF simulator for hardware testing and offline acceptance testing | [AugmentScale.ScaleSimulator.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.ScaleSimulator/AugmentScale.ScaleSimulator.csproj) |
| `AugmentScale.Tests/` | Automated xUnit test suite covering protocol framing, database repositories, PDF archiving, cloud sync, and simulator logic | [AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj) |
| `docs/` | User manual, disaster recovery procedures, audit reports, cloud integration plans, and codebase knowledge base | Directory listing |
| `publish/` | Pre-compiled binaries and zip distribution packages | [scan output](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/docs/codebase/.codebase-scan.txt) |
| `AugmentScale.slnx` | Solution definition referencing all projects in the solution | [AugmentScale.slnx](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.slnx) |
| `start-dev-sim.ps1` | Developer script to launch the standalone scale simulator with default or custom options | [start-dev-sim.ps1](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/start-dev-sim.ps1) |

### 2) Entry Points

- Main runtime entry: `AugmentScale.App.OnStartup` in [App.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/App.xaml.cs#L27). Acquires named single-instance mutex, initializes configuration, logs, services, displays `MainWindow`, and starts background workers.
- Secondary entry points:
  - Simulator GUI entry: `AugmentScale.ScaleSimulator.App.OnStartup` in [AugmentScale.ScaleSimulator/App.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.ScaleSimulator/App.xaml.cs).
  - WebUI frontend entry: `index.html` and [main.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/main.js#L1).
- How entry is selected: Executable launch args inspect `e.Args`. Default launch opens GUI shell.

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `AugmentScale.Protocol` | XK3190 byte decoding, checksum XOR validation, frame framing/splitting, and rolling stability detection | No database access, no WPF UI dependencies, no network calls |
| `AugmentScale/Data` | SQLite/SQLCipher connection management, schema migration scripts, repository abstractions, transactional outbox operations, and retention pruning | No UI widgets, no WebView2 references, no serial hardware port access |
| `AugmentScale/Services` | Orchestration services: ScaleReaderService (serial/TCP loop), BridgeService (IPC dispatch), CloudControlService (Supabase sync), PdfArchiveService (daily PDF generator), ConfigService (DPAPI credentials) | Direct SQL queries bypassing repositories, UI layout styling |
| `AugmentScale/WebUI` | HTML partials, CSS theme design tokens, modular ES2022 JavaScript handling user interactions, audio, modals, routing, and telemetry | Direct filesystem access, native Win32 calls, unencrypted credential storage |

### 4) Naming and Organization Rules

- File naming pattern:
  - C# source files: PascalCase (e.g., `TicketRepository.cs`, `ScaleReaderService.cs`).
  - WebUI source files: kebab-case (e.g., `first-weigh.js`, `history-report.js`, `screen-dashboard.html`).
  - SQL migration scripts: `V###_Description.sql` (e.g., `V001_InitialSchema.sql`, `V003_CloudSync.sql`).
- Directory organization pattern:
  - C# solution: Grouped by layer (`Data/Repositories`, `Data/Services`, `Services`, `Models/Commands`).
  - WebUI frontend: Grouped by functional asset type (`js/screens/`, `partials/`, `css/`, `avatars/`).
- Import aliasing or path conventions:
  - C#: File-scoped namespaces (`namespace AugmentScale.Services;`), standard using blocks at head of file.
  - WebUI JavaScript: Relative ES module imports with mandatory `.js` extensions (e.g., `import { state } from './state.js';`).

### 5) Evidence

- [AugmentScale/App.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/App.xaml.cs)
- [AugmentScale/MainWindow.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/MainWindow.xaml.cs)
- [AugmentScale/Services/BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs)
- [AugmentScale/Data/DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs)
- [AugmentScale/WebUI/index.html](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/index.html)
