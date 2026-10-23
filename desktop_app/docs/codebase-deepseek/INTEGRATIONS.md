# External Integrations and Data Flow

## Core Sections (Required)

### 1) Integration Inventory

| Integration | Direction/type | Purpose | Auth mechanism | Criticality | Failure behavior | Evidence |
|-------------|----------------|---------|----------------|-------------|------------------|----------|
| XK3190-D10 weigh indicator | Inbound serial (RS-232) or TCP | Streams weight frames for live display, capture, and ticket weights | None (physical port) | High | Reader catches port errors, marks disconnected, retries every 3 s; UI remains usable with manual entry fallback | `ScaleReaderService.cs:65-123`, `Resources/setup.json:18-27` |
| Development scale simulator | Inbound TCP loopback (`TCP:127.0.0.1:9876`) | Emits synthetic XK3190 frames for development | None (loopback only) | Low (dev only) | Same reader/reconnect path; server accepts one client at a time | `AugmentScale.ScaleSimulator/Networking/TcpFrameServer.cs`, `start-dev-sim.ps1:1-120` |
| SQLCipher database | Local file I/O | System of record for tickets, vehicles, profiles, audit, outbox, health | 256-bit random database key from DPAPI-protected `secrets.dat` | High | Startup fails with an actionable error if the DB cannot be unlocked; no automatic data loss | `DatabaseService.cs:126-140`, `ConfigService.cs:211-221` |
| Windows DPAPI | OS API | Protect the database key and PIN hashes at rest | Current Windows user + fixed entropy `AugmentScale.Secrets.v1` | High | Unreadable secrets with an existing DB throws; recovery requires restoring `secrets.dat` | `ConfigService.cs:17`, `:185-267` |
| WebView2 runtime + virtual host | In-process browser | Render the HTML/CSS/JS UI and carry the postMessage bridge | Local virtual host `app.augmentscale.local`; permission requests denied; new windows blocked | High | Missing runtime or navigation failure shows a WPF error/retry overlay | `MainWindow.xaml.cs:64-113` |
| Printing | Outbound OS/browser | Print first/second weigh slips and history reports | OS printer selection | Medium | Uses the browser print dialog; cancel leaves the ticket state unchanged | `WebUI/js/print.js:368-411`, `:483`, `:574` |
| Cloud synchronization (Supabase) | Planned outbound network | Upload outbox events in Phase 2 | Not implemented; no URL, key, or HTTP client exists | Low (not implemented) | Outbox rows accumulate locally; production UI reports “Local only” | `DatabaseService.cs:1630-1652`, `WebUI/js/sync.js:92-111`, `..\Implimentation_Plan.md:717` |
| Application log files | Local file append | Startup and unhandled-error diagnostics | OS file ACLs | Medium | Logging swallows file-write failures; app continues | `AppLog.cs:7-53` |
| Single-instance mutex | OS kernel object | Prevent two app instances per session sharing the DB | Windows named mutex `Local\AugmentScale.SingleInstance` | Medium | Second instance shows a message and exits | `App.xaml.cs:21-31` |

No HTTP APIs, message queues, email/SMS, payment, identity-provider, API gateway, service mesh, or telemetry SaaS integrations exist in the current source.

### 2) Data Stores

| Store | Role | What is stored | Key format/conventions | Key risk | Evidence |
|-------|------|----------------|------------------------|----------|----------|
| `augment-scale.db` (SQLCipher) | Primary local system of record | Organization/site/weighbridge/workstation, scale profiles, profiles/roles, vehicles, customers, products, drivers, weigh tickets, captures, corrections, print jobs, audit, outbox, sync cursors, scale health | UUID strings for entities; integer ticket numbers starting at 11353; timestamps as ISO-8601 `"O"` strings | Losing `secrets.dat` makes the file unreadable; no built-in backup | `Data/Schema/V001_InitialSchema.sql`, `DatabaseService.cs:36-38`, `:1655-1669` |
| `secrets.dat` | Credential store | `databaseKey` and per-profile PBKDF2 PIN hashes | DPAPI-protected JSON; atomic replace via `secrets.dat.tmp` | DPAPI is user-bound; no rotation/recovery workflow | `ConfigService.cs:185-267` |
| `setup.json` (data directory) | Bootstrap config | Organization/site/weighbridge/scale connection, bootstrap operator list | JSON; copied from `Resources/setup.json` on first run; bootstrap `pin` fields are removed after hashing | Defaults include demo business data and PIN `1234` | `ConfigService.cs:163-183`, `:229-257` |
| `logs/app-YYYYMMDD.log` | Diagnostics | Startup, scale, and unhandled-exception messages | Plain text, one event per line with timestamp/level | Deleted after 30 days; no shipping/alerting | `AppLog.cs:24-53` |
| WebView2 user-data directory | Browser state | Cache and `localStorage` (theme, PIN lockout counters, session display state) | Chromium profile under the data directory | Clearing it resets client lockout/theme | `ConfigService.cs:58`, `WebUI/js/pin-auth.js:45-83` |
| `publish/` output | Deployment artifact | Application binaries and copied `Resources/setup.json` / WebUI | Gitignored build output | Replaced on publish | `.gitignore:12`, `AugmentScale.csproj:35-39` |

### 3) Secrets and Credentials Handling

- Database encryption key:
  - Generated as 32 random bytes, Base64-encoded (`ConfigService.cs:219-222`).
  - Stored only inside DPAPI-protected `secrets.dat`, scoped to the current Windows user with app-specific entropy (`ConfigService.cs:17`, `:260-267`).
  - If `secrets.dat` is missing/corrupt while `augment-scale.db` exists, the app refuses to generate a new key because that would make existing data unreadable (`ConfigService.cs:203-218`; covered by `DatabaseTests.MissingSecrets_WithExistingDatabase_RefusesToCreateNewKey`).
  - `tools/Get-DbKey.ps1` can decrypt the key with the same DPAPI scope; it prints or copies the key for read-only DB inspection (`tools/Get-DbKey.ps1`, `OPEN_RAW_DB.md`).
- PINs:
  - PBKDF2-SHA256, 100,000 iterations, 16-byte random salt, 32-byte hash, stored as `salt:hash` Base64 inside `secrets.dat` (`ConfigService.cs:15`, `:129-161`).
  - Initial operator PINs come from `Resources/setup.json` (all five default to `1234`) and are hashed into `secrets.dat`; the plaintext `pin` fields are then removed from the data-directory copy of `setup.json` (`ConfigService.cs:229-257`, `Resources/setup.json`).
  - No credential is stored in the repository's data directory because the default data directory is outside the repo (`%LOCALAPPDATA%\AugmentScale`).
- Supervisor authorization token:
  - Process-local only, 15-minute sliding expiry; not persisted (`BridgeService.cs:20`, `:278-313`).
- No API keys, connection strings, cloud credentials, or certificates are present in source. The planned Supabase integration has no credential handling yet `[TODO]`.

### 4) Reliability and Failure Behavior

- Scale:
  - Reader runs on a dedicated background thread and reconnects every 3 seconds after any failure (`ScaleReaderService.cs:65-98`).
  - Serial reads/writes time out at 500 ms; TCP connect times out after 3 seconds (`ScaleReaderService.cs:112-113`, `:127-129`).
  - Malformed/checksum-invalid frames are counted and dropped; stable readings require at least 3 samples over the configured 500 ms window within 10 kg (`Protocol/StabilityDetector.cs`, `ScaleReaderService.cs:142-198`).
- Persistence:
  - SQLite is opened with foreign keys on and a 5-second busy timeout (`DatabaseService.cs:138`).
  - Mutations use explicit transactions; audit and outbox writes share the transaction, so a failed mutation does not leave a misleading audit row (`AuditService.cs:8-10`, `DatabaseService.cs:1318-1368`).
  - No write-ahead/backup/restore automation is built into the app; the operator manual documents copying the data directory and the dev launcher supports `-BackupDatabase`.
- Bridge/UI:
  - Each command has a 30-second JavaScript timeout; failures reject the caller (`runtime.js:47-69`).
  - `BridgeService` catches exceptions so a single command failure does not crash the host (`BridgeService.cs:96-108`).
- Cloud:
  - No retry, backoff, or delivery worker exists. Outbox events remain in SQLCipher indefinitely until a future Phase 2 consumer is built (`DatabaseService.cs:2176-2200`).
- Single workstation:
  - The process mutex prevents concurrent instances; there is no multi-user or multi-workstation locking beyond SQLite transactions (`App.xaml.cs:21-31`).

### 5) Observability

- Application log: rolling daily text logs with `INFO`/`ERROR`, including unhandled exceptions and stack traces (`AppLog.cs:20-35`).
- Audit trail: `audit_events` captures before/after JSON, actor, workstation, reason, and timestamp in the same transaction as the mutation (`AuditService.cs:18-75`).
- Outbox: `outbox_events` records entity changes for future sync; `GetSyncStatus` counts pending rows and reads the latest `sync_cursors` timestamp (`DatabaseService.cs:1630-1652`).
- Scale health: `scale_health_events` records connection, port error, and frame-validation events; pruned to 30 days on first write per process (`DatabaseService.cs:1655-1679`).
- Gaps: no metrics, distributed tracing, structured JSON logging, log shipping, health endpoint, alerting, or correlation ID beyond the per-command `requestId` in `runtime.js`. No cloud/network telemetry exists.

### 6) Evidence

- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/Services/AppLog.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/WebUI/js/print.js`
- `AugmentScale/Data/Schema/V001_InitialSchema.sql`
- `tools/Get-DbKey.ps1`
- `OPEN_RAW_DB.md`
