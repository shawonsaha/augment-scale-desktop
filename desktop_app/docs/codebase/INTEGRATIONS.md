# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Failure behavior | Evidence |
|--------|---------------------------|---------|------------|-------------|------------------|----------|
| Yaohua XK3190-D10 Indicator | Inbound hardware serial (RS-232) or TCP | Continuous live weight streaming (~15 fps) at 9600 baud for display, capture, and ticket weights | None (direct serial/TCP stream) | High | Reader catches port errors, marks the scale disconnected, retries every 3 s; UI shows a yellow status indicator and "Scale disconnected" toast, preserves captured readings, and remains usable with manual entry fallback | `AugmentScale/Services/ScaleReaderService.cs:65-123`, `AugmentScale/Resources/setup.json:18-27` |
| Development scale simulator | Inbound TCP loopback (`TCP:127.0.0.1:9876`) | Emits synthetic XK3190 frames for development | None (loopback only) | Low (dev only) | Same reader/reconnect path; the server accepts one client at a time | `AugmentScale.ScaleSimulator/Networking/TcpFrameServer.cs`, `start-dev-sim.ps1` |
| SQLCipher 4 / SQLite | Embedded database engine (local file I/O) | Encrypted local transactional persistence and system of record | 256-bit random database key (SQLCipher AES-256) supplied via connection string | High | Startup fails with an actionable error if the database cannot be unlocked; no automatic data loss | `AugmentScale/Data/DatabaseContext.cs` (`OpenConnection`), `AugmentScale/AugmentScale.csproj:26`, `ConfigService.cs:211-221` |
| Microsoft Edge WebView2 | Embedded browser runtime | Chromium rendering engine for the HTML/CSS/JS interface and postMessage bridge | Local virtual host `scale.augmentlab.net`; permission requests denied; new windows blocked | High | Missing runtime or navigation failure shows a WPF error/retry overlay | `AugmentScale/MainWindow.xaml.cs:64-113` |
| Windows DPAPI | Operating-system security API | Hardware/user-bound encryption for the database key and PIN hashes | Windows `CurrentUser` scope plus app entropy `AugmentScale.Secrets.v1` | High | Unreadable secrets with an existing database throws; recovery requires restoring `secrets.dat` | `AugmentScale/Services/ConfigService.cs:17`, `:185-267` |
| Windows Print System | Native OS subsystem / outbound browser print | First-weigh slips, second-weigh slips, and weight certificates | OS user printer permissions | Medium | Uses the browser print dialog; cancel leaves the ticket state unchanged. A `showSystemPrintDialog` bridge command calling WebView2 `ShowPrintUI` exists but has no WebUI caller | `AugmentScale/Services/BridgeService.cs:315-331`, `WebUI/js/print.js:368-411`, `USER_MANUAL.md:17` |
| Automatic PDF archive | Local offscreen WebView2 render + file output | Baseline and daily A4 PDF reports under `archives\` | Local process; no network or external credentials | Medium | `PdfArchiveService` records pending/failed runs in `archive_runs`, retries with backoff, and exposes status/retry in the Sync popover. It runs only while the app is open | `AugmentScale/Services/PdfArchiveService.cs`, `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`, `AugmentScale/Data/Repositories/ArchiveRunRepository.cs` |
| Cloud Sync / Supabase | Planned outbound REST/PostgREST cloud sync (Phase 2) | Upload `outbox_events` in a future release | Not implemented; no URL, key, or HTTP client exists; future JWT / device key `[TODO]` | Low (Phase 2) | Outbox rows accumulate locally; production UI reports "Local only" | `USER_MANUAL.md:21`, `V001_InitialSchema.sql:328-346`, `Data/Services/SyncStatusService.cs`, `WebUI/js/sync.js:92-111` |
| Application log files | Local file append | Startup, scale, and unhandled-error diagnostics | OS file ACLs | Medium | Logging swallows file-write failures; the app continues | `AugmentScale/Services/AppLog.cs:7-53` |
| Single-instance mutex | OS kernel object | Prevent two app instances per session from sharing the database | Windows named mutex `Local\AugmentScale.SingleInstance` | Medium | Second instance shows a message and exits | `AugmentScale/App.xaml.cs:21-31` |

No HTTP APIs, message queues, email/SMS, payment, identity-provider, API gateway, service-mesh, or telemetry SaaS integrations exist in the current source.

### 2) Data Stores

| Store | Role | What is stored | Access layer / format | Key risk | Evidence |
|-------|------|----------------|-----------------------|----------|----------|
| SQLite with SQLCipher 4 (`augment-scale.db`) | Primary local system of record | Organization/site/weighbridge/workstation, scale profiles, profiles/roles, vehicles, customers, products, drivers, weigh tickets, captures, corrections, print jobs, audit events, archive run log, sync outbox/cursors, and scale health | `Microsoft.Data.Sqlite` in `Data/DatabaseContext.cs`, `Data/Repositories/`, and `Data/Services/`; UUID strings for entities, integer ticket numbers starting at 1, ISO-8601 `"O"` timestamp strings | Accidental external write bypassing transaction/audit rules; loss of the DPAPI key renders the database unreadable; no built-in backup | `AugmentScale/Data/`, `Data/Schema/V001_InitialSchema.sql`, `Data/Schema/V002_ArchiveRuns.sql`, `Data/Repositories/TicketRepository.cs` (ticket-number constants), `OPEN_RAW_DB.md` |
| PDF archive folder (`archives\`) | Business document output | Baseline and daily A4 PDFs plus transient `.staging\` files | Files written by `PdfArchiveService` through `IPdfArchiveRenderer`; relative paths recorded in `archive_runs.file_path` | Plain PDFs outside SQLCipher; copied by the documented backup but not encrypted; personal data exposure if folder ACLs are weak | `AugmentScale/Services/PdfArchiveService.cs`, `AugmentScale/Services/ConfigService.cs`, `start-dev-sim.ps1`, `USER_MANUAL.md` |
| DPAPI secret file (`secrets.dat`) | Credential store | Base64 SQLCipher database key and per-profile PBKDF2 PIN hashes | DPAPI-protected JSON using `System.Security.Cryptography.ProtectedData`; atomic replace via `secrets.dat.tmp` | DPAPI is user-bound; file deletion or corruption causes permanent loss of the database passphrase; no rotation/recovery workflow | `AugmentScale/Services/ConfigService.cs:17-42`, `:185-267`, `OPEN_RAW_DB.md:151-177` |
| Local JSON configuration (`setup.json`) | Bootstrap configuration | Organization, site, weighbridge, scale connection, and bootstrap operator list | `System.Text.Json` in `ConfigService.cs`; copied from `Resources/setup.json` on first run; bootstrap `pin` fields are removed after hashing | Incorrect COM port or connection configuration breaks the scale reader; defaults include demo business data and PIN `1234` | `AugmentScale/Services/ConfigService.cs:61-70`, `:163-183`, `:229-257`, `Resources/setup.json` |
| `logs/app-YYYYMMDD.log` | Diagnostics | Startup, scale, and unhandled-exception messages | Plain text, one event per line with timestamp and level | Deleted after 30 days; no shipping or alerting | `AugmentScale/Services/AppLog.cs:24-53` |
| WebView2 user-data directory | Browser state | Cache and `localStorage` (theme, PIN lockout counters, session display state) | Chromium profile under the configured data directory | Clearing it resets client-side lockout and theme | `AugmentScale/Services/ConfigService.cs:58`, `WebUI/js/pin-auth.js:45-83` |
| `publish/` output | Deployment artifact | Application binaries and copied `Resources/setup.json` / WebUI assets | Gitignored build output | Replaced on publish | `.gitignore:12`, `AugmentScale/AugmentScale.csproj:35-39` |

### 3) Secrets and Credentials Handling

- Database encryption key:
  - Generated as 32 random bytes and Base64-encoded (`ConfigService.cs:219-222`).
  - Stored only inside DPAPI-protected `secrets.dat`, scoped to the current Windows user with app-specific entropy (`ConfigService.cs:17`, `:260-267`).
  - If `secrets.dat` is missing or corrupt while `augment-scale.db` exists, the app refuses to generate a new key because that would make existing data unreadable (`ConfigService.cs:203-218`; covered by `DatabaseTests.MissingSecrets_WithExistingDatabase_RefusesToCreateNewKey`).
  - `tools/Get-DbKey.ps1` can decrypt the key with the same DPAPI scope and prints or copies it for read-only database inspection (`tools/Get-DbKey.ps1`, `OPEN_RAW_DB.md`).
- PINs:
  - PBKDF2-SHA256 with 100,000 iterations, a 16-byte random salt, and a 32-byte hash, stored as `salt:hash` Base64 inside `secrets.dat` (`ConfigService.cs:15`, `:129-161`).
  - Initial operator PINs come from `Resources/setup.json` (all five default to `1234`) and are hashed into `secrets.dat`; the plaintext `pin` fields are then removed from the data-directory copy of `setup.json` (`ConfigService.cs:229-257`, `Resources/setup.json`).
  - No repository credential is stored in the repo because the default data directory is outside the repo (`%LOCALAPPDATA%\AugmentScale`).
  - PINs can be reset by a supervisor in the WebUI or through the CLI tool `AugmentScale.exe --reset-pin <operator-id>`.
- Supervisor authorization token:
  - Process-local only, with a 15-minute sliding expiry; not persisted (`BridgeService.cs:20`, `:278-313`).
- Hardcoding checks:
  - No database credentials, production keys, API keys, connection strings, cloud credentials, or certificates are hardcoded in source. Seed PINs in `Resources/setup.json` (`1234`) are for initial development/testing only and are hashed to `secrets.dat` on first launch.
  - The planned Supabase integration has no credential handling yet `[TODO]`.
- Rotation or lifecycle notes:
  - The database key cannot be rotated without re-encrypting the database via a SQLCipher export.
  - No built-in backup, export, or key-rotation workflow exists; the manual documents copying the data directory, and the dev launcher supports `-BackupDatabase`.

### 4) Reliability and Failure Behavior

- Scale:
  - The reader runs on a dedicated background thread and reconnects every 3 seconds after any failure (`ScaleReaderService.cs:65-98`).
  - Serial reads/writes time out at 500 ms; TCP connect times out after 3 seconds (`ScaleReaderService.cs:112-113`, `:127-129`).
  - Malformed or checksum-invalid frames are counted and dropped. Stable readings require at least 3 samples over the configured 500 ms window within 10 kg (`AugmentScale.Protocol/StabilityDetector.cs`, `ScaleReaderService.cs:142-198`).
  - On disconnect, the WebUI shows a yellow status indicator and a toast; captured readings are preserved and manual entry remains available.
- Persistence:
  - SQLite is opened with foreign keys on and a 5-second busy timeout (`Data/DatabaseContext.cs` (`OpenConnection`)).
  - Mutations use explicit transactions; audit and outbox writes share the transaction, so a failed mutation does not leave a misleading audit row (`AuditService.cs:8-10`, `Data/Repositories/TicketRepository.cs` (`CreateTicket`), `Data/DatabaseContext.cs` (`InsertOutbox`)).
  - No write-ahead/backup/restore automation is built into the app; the operator manual documents copying the data directory and the dev launcher supports `-BackupDatabase`.
- Bridge/UI:
  - Each command has a 30-second JavaScript timeout and rejects the caller on failure (`runtime.js:47-69`).
  - `BridgeService` catches exceptions so a single command failure does not crash the host (`BridgeService.cs:96-108`).
- PDF archive:
  - Baseline and daily runs are serialized by one scheduler; missed days are enqueued on launch, empty periods become `skipped`, and failed runs retry after 1m/5m/15m/1h/6h up to five attempts (`PdfArchiveService.cs`, `ArchiveRunRepository.cs`).
  - PDFs are written to `.staging\` and atomically moved to the final path; a crash can leave a staging file, which is cleaned on the next launch.
  - The scheduler runs only while the application is open; there is no Windows service or off-machine copy.
- Cloud:
  - No retry, backoff, or delivery worker exists. Outbox events remain in SQLCipher indefinitely until a future Phase 2 consumer is built (`Data/DatabaseContext.cs` (`InsertOutbox`)).
- Single workstation:
  - The process mutex prevents concurrent instances; there is no multi-user or multi-workstation locking beyond SQLite transactions (`App.xaml.cs:21-31`).

### 5) Observability for Integrations

- Logging around external calls: serial connection lifecycle, WebView2 startup, and port errors are logged to `AppLog.cs` and recorded in the `scale_health_events` database table (`ScaleReaderService.cs:86`).
- Application log: rolling daily text logs with `INFO`/`ERROR`, including unhandled exceptions and stack traces (`AppLog.cs:20-35`).
- Audit trail: `audit_events` captures before/after JSON, actor, workstation, reason, and timestamp in the same transaction as the mutation (`AuditService.cs:18-75`).
- Outbox: `outbox_events` records entity changes for future sync; `GetSyncStatus` counts pending rows and reads the latest `sync_cursors` timestamp (`Data/Services/SyncStatusService.cs`).
- Archive: `archive_runs` records status, attempt count, next retry, error text, relative PDF path, report ID, and integrity hash; `AppLog` records start/skip/failure messages. The Sync popover surfaces recent runs and the last error.
- Scale health: `scale_health_events` records connection, port-error, and frame-validation events; pruned to 30 days on the first write per process (`Data/Services/ScaleHealthService.cs`).
- Metrics/tracing coverage: none configured.
- Missing visibility gaps: no metrics, distributed tracing, structured JSON logging, log shipping, health endpoint, alerting, or correlation ID beyond the per-command `requestId` in `runtime.js`. No remote telemetry or cloud/network telemetry exists in Phase 1 (local offline deployment).

### 6) Evidence

- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Data/`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/WebUI/js/print.js`
- `AugmentScale/Services/PdfArchiveService.cs`
- `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`
- `AugmentScale/Data/Schema/V001_InitialSchema.sql`
- `AugmentScale/Data/Schema/V002_ArchiveRuns.sql`
- `AugmentScale/Resources/setup.json`
- `USER_MANUAL.md`
- `OPEN_RAW_DB.md`
- `tools/Get-DbKey.ps1`
