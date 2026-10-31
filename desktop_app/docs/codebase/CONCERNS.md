# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | Weak default PINs across all seeded operators | [SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L14-L18) | All 5 default operator profiles (including Supervisor) use "1234", allowing unauthorized ticket manipulation or voiding until manually changed | Enforce mandatory PIN change on first login per operator |
| Medium | Outbox queue stall on permanent sync failure | [CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L844), [V006_OutboxDeadLetterStatus.sql](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Schema/V006_OutboxDeadLetterStatus.sql) | Mitigated / Resolved: Outbox sync transitions events failing >= 10 attempts to `dead_letter` status, recording error details in `server_response` and unblocking subsequent queue items | Transition repeatedly failing items to a `dead_letter` status after 10 failed attempts (Resolved) |
| Low | Incomplete CLI `--reset-pin` command | [App.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/App.xaml.cs) | Resolved: Incomplete `--reset-pin` CLI flag and dead UI stub removed; operator PIN changes are managed exclusively via supervisor UI | Flag and stub removed (Resolved) |
| Low | Hardcoded fallback Supabase credentials | [SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L24-L25) | Fallback URL and anon key are embedded in source and compiled binary metadata | Default to empty strings and require customer deployment `setup.json` |

### 2) Technical Debt

List the most important debt items only.

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| `InternalsVisibleTo` test seam for ScaleReaderService | Exposes internals for timeout testing | [AugmentScale.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/AugmentScale.csproj#L29) | Couples test project to internal implementation details | Refactor serial port reader around an `ISerialPort` interface abstraction |
| Manual string parsing in history queries | Legacy dynamic filter building | [HistoryReportService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Services/HistoryReportService.cs) | Potential syntax bugs or filter degradation | Standardize query generation helper utilities |
| Dual status push polling vs reactive push | UI updates use hybrid timer push and events | [BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs) | Minor unnecessary CPU cycles during idle states | Fully unify on reactive event dispatching |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Insecure Default Operator PINs | A07:2021 Identification and Authentication Failures | [SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L14) | PINs are PBKDF2 hashed and deleted from `setup.json` after first boot | Initial installation operators all default to "1234" |
| SQL Injection in Dynamic Outbox Queries | A03:2021 Injection | [CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L38-L58), [DatabaseMaintenance.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseMaintenance.cs#L22-L26) | Enforced explicit static allowlists (`AllowedQueryTables`, `AllowedPruneTables`) prior to query execution | Resolved (disallowed table names throw `ArgumentException`) |
| Public Anon Key in Compiled Binary | A02:2021 Cryptographic Failures | [SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L24) | Supabase Row Level Security (RLS) protects tables | Anon key is readable via binary decompilation |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Sequential Outbox Synchronization | [CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L786) | Outbox processes rows sequentially one-by-one | High transaction volume during network recovery may cause sync latency | Implement batch payload upserts to Supabase |
| Scale Reader Polling Loop | [ScaleReaderService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ScaleReaderService.cs#L95) | Thread sleep polling on disconnected port | Minor thread context switching | Leverage async stream or event-driven port listeners |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `AugmentScale/WebUI/index.html` | Root layout hosting all screen containers, templates, and script tags | 19 commits in last 90 days | Keep markup strictly modular via HTML loader partials |
| `AugmentScale/WebUI/js/state.js` | Central in-memory state object for screens, tickets, and telemetry | 17 commits in last 90 days | Use explicit mutation functions instead of raw state modifications |
| `AugmentScale.Tests/DatabaseTests.cs` | Comprehensive test harness for all database features | 14 commits in last 90 days | Factor test suites into focused category test classes |
| `AugmentScale/Services/BridgeService.cs` | Central command router between frontend and backend | 12 commits in last 90 days | Use command handler mapping dictionaries instead of large switch blocks |
| `AugmentScale/Services/DatabaseService.cs` | Facade coordinating all repositories and domain services | 12 commits in last 90 days | Maintain strict delegation without adding ad-hoc SQL logic |

### 6) `[ASK USER]` Questions

1. [ASK USER] Should default Supabase URL and anon credentials in `SetupConfig.cs` be cleared to empty strings so production builds enforce site-specific configuration via `setup.json`?
2. [ASK USER] Should a first-time login PIN change workflow be enforced so new installations do not operate on the default `1234` PIN?
3. [RESOLVED] Should the `--reset-pin` CLI flag in `App.xaml.cs` be completed with an interactive WPF dialog or console prompt, or removed in favor of documented manual configuration recovery? -> Resolved: Removed CLI flag; operator PIN management is handled directly via supervisor UI.
4. [RESOLVED] Should outbox events that fail repeatedly (e.g. after 10 attempts) be moved to a `dead_letter` status to prevent permanently stalling subsequent queue synchronization? -> Resolved: Implemented via V006 schema migration and `MaxOutboxAttempts` (= 10), transitioning failed items to `dead_letter` status with error logging to prevent queue stalls.

### 7) Evidence

- [docs/codebase/.codebase-scan.txt](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/docs/codebase/.codebase-scan.txt)
- [AugmentScale/Models/SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs)
- [AugmentScale/Services/CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs)
- [AugmentScale/App.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/App.xaml.cs)
- [AugmentScale/Data/DatabaseMaintenance.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseMaintenance.cs)
