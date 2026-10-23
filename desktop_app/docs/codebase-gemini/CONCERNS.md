# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | DPAPI Secret Loss Irrecoverability | `ConfigService.cs:17-42`, `OPEN_RAW_DB.md:170-177` | If `secrets.dat` is deleted, corrupted, or accessed under a different Windows user profile, the encrypted database cannot be opened; all tickets and history are permanently lost. | Implement automated paired backup script copying `augment-scale.db` and `secrets.dat` together; evaluate off-machine key escrow. |
| High | Default Demo PIN Exposure | `Resources/setup.json:11`, `USER_MANUAL.md:276` | Every seeded operator defaults to PIN `1234`. If deployed without manual setup file edits, unauthorized operators or supervisors can sign in. | Require mandatory first-launch PIN change before allowing ticketing operations. |
| Med | God-Class Complexity in `DatabaseService.cs` | `AugmentScale/Services/DatabaseService.cs` (2,280 lines) | All business rules, raw SQL queries, schema migrations, report verification, and DTO mappings reside in a single monolithic class, creating high regression risk. | Split `DatabaseService` into targeted repositories (`TicketRepository`, `OperatorRepository`, `VehicleRepository`, `ReportService`). |
| Low | Test Suite Duration Bottleneck | `AugmentScale.Tests/DatabaseTests.cs:8-17` | PBKDF2 hashing (100,000 rounds) runs per seeded operator in every `TempDatabase` instantiation, pushing test suite execution to ~63 seconds for 77 tests. | Allow configurable PBKDF2 iteration count in test environments (e.g. 1,000 iterations for testing, 100,000 for production). |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Monolithic `DatabaseService` | Rapid prototype-to-production migration without introducing complex DI framework | `AugmentScale/Services/DatabaseService.cs` | Elevated chance of SQL syntax errors, difficult code review, and high churn collisions | Refactor into domain repositories behind clean interfaces |
| Dual-mode Browser/Desktop Code in WebUI | Prototype needed to run standalone in standard browsers as well as inside WebView2 | `AugmentScale/WebUI/js/runtime.js`, `state.js`, `bridge.js` | Dead code paths or accidental execution of mock/seed browser logic in production | Decouple production build assets or retire browser-only mock fallback |
| In-Memory UI State Replication | Avoids full database roundtrips for table rendering in prototype | `AugmentScale/WebUI/js/state.js` | Potential desynchronization between client arrays and SQLite database | Transition to paginated server-side queries via bridge commands |

### 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
|------|----------------|----------|--------------------|-----|
| Credential Exposure via Helper Tool | A01:2021-Broken Access Control | `tools/Get-DbKey.ps1` | DPAPI restricts extraction to the current Windows user | Any local script or process running under the same user account can extract the raw SQLCipher passphrase |
| Lack of PIN Rate Limiting | A07:2021-Identification and Authentication Failures | `BridgeService.cs:122-126`, `ConfigService.cs:93-98` | 4-digit PINs required for login; supervisor PIN required for admin actions | No account lockout or exponential backoff after multiple failed PIN attempts in backend |
| Missing Input Length Constraints on Freeform Notes | A03:2021-Injection | `DatabaseService.cs:810-850`, `V001_InitialSchema.sql:191` | Parameterized SQLite queries prevent SQL injection | Extremely long payload strings in `remarks` or `override_reason` could bloat database pages |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Full-Table In-Memory Queries | `DatabaseService.cs:38-39` (`BootHistoryLimit = 1000`) | Fast for small datasets (<5,000 tickets) | As weighbridge operates over years, loading 1,000 tickets at boot will increase memory consumption and startup delay | Introduce paginated virtual scrolling and indexed date range queries for historical screens |
| PBKDF2 CPU Load during Setup/Tests | `ConfigService.cs:15` (`Iterations = 100_000`) | ~63s test suite run for 77 tests | High CPU usage when seeding multiple operators simultaneously | Introduce work factor abstraction for test suites |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `AugmentScale/WebUI/index.html` | Root template containing layout, mod navigation, modals, and screen containers | 11 commits in last 90 days | Keep HTML structural changes isolated; maintain partial template separation |
| `AugmentScale/WebUI/js/state.js` | Central in-memory state store bridging UI screens and backend data | 10 commits in last 90 days | Write unit tests for state mutations before modifying reducer functions |
| `AugmentScale/Services/DatabaseService.cs` | Single point of change for any schema or business rule adjustment | 7 commits in last 90 days | Run full `dotnet test` suite before and after any database logic edits |
| `AugmentScale/Services/BridgeService.cs` | Dispatches IPC messages and handles UI thread marshaling | 6 commits in last 90 days | Ensure new commands define matching C# command classes and JS `sendCommand` callers |

### 6) `[ASK USER]` Questions

1. [ASK USER] Should mandatory first-run PIN change enforcement be added so operators cannot remain on default `1234`?
2. [ASK USER] Would you like `DatabaseService.cs` refactored into smaller domain-specific repositories (e.g. `TicketRepository`, `OperatorRepository`), or kept unified for now?
3. [ASK USER] Should a configurable PBKDF2 iteration parameter be introduced for test runs to drop the test suite time from ~63 seconds to under 2 seconds?
4. [ASK USER] Are there plans to activate the Supabase cloud sync outbox in an upcoming release, or will the system remain 100% offline-only for the foreseeable future?

### 7) Evidence

- `docs/codebase/.codebase-scan.txt` (Churn and line count metrics)
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/BridgeService.cs`
- `tools/Get-DbKey.ps1`
- `USER_MANUAL.md`
