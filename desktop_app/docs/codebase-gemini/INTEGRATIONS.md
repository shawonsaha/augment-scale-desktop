# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| Yaohua XK3190-D10 Indicator | Hardware Serial / RS-232 (or TCP) | Continuous live weight streaming (~15 fps) | None (direct serial/TCP stream) | High | `AugmentScale/Services/ScaleReaderService.cs` |
| SQLCipher 4 / SQLite | Embedded Database Engine | Encrypted local transactional persistence | 256-bit AES passphrase via connection string | High | `AugmentScale/Services/DatabaseService.cs`, `AugmentScale.csproj:26` |
| Microsoft Edge WebView2 | Embedded Browser Runtime | Chromium rendering engine for HTML/CSS/JS interface | Virtual host mapping (`app.augmentscale.local`) | High | `AugmentScale/MainWindow.xaml.cs:75-98` |
| Windows DPAPI | Operating System Security API | Hardware/user-bound encryption for database key & PIN hashes | Windows CurrentUser security descriptor + app entropy | High | `AugmentScale/Services/ConfigService.cs:17` |
| Windows Print System | Native OS Subsystem | First-weigh slips and weight certificates printing | OS user printer permissions | Medium | `AugmentScale/Services/BridgeService.cs:315-331`, `USER_MANUAL.md:17` |
| Cloud Sync / Supabase | REST/PostgREST Cloud Sync (Phase 2) | Staged sync outbox (`outbox_events`); client not implemented in Phase 1 | Future JWT / Device key `[TODO]` | Low (Phase 2) | `USER_MANUAL.md:21`, `V001_InitialSchema.sql:328-346` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| SQLite with SQLCipher 4 (`augment-scale.db`) | Master data, tickets, captures, audit events, print jobs, sync outbox | `Microsoft.Data.Sqlite` in `DatabaseService.cs` | Accidental external write bypassing transaction/audit rules; loss of DPAPI key renders DB unreadable | `AugmentScale/Services/DatabaseService.cs`, `OPEN_RAW_DB.md` |
| DPAPI Secret File (`secrets.dat`) | Stores Base64 SQLCipher DB key and PBKDF2 operator PIN hashes | `System.Security.Cryptography.ProtectedData` in `ConfigService.cs` | File deletion causes permanent loss of database encryption passphrase | `AugmentScale/Services/ConfigService.cs:17-42`, `OPEN_RAW_DB.md:151-177` |
| Local JSON Configuration (`setup.json`) | Organization, site, weighbridge, and serial connection settings | `System.Text.Json` in `ConfigService.cs` | Incorrect COM port configuration breaks scale reader connection | `AugmentScale/Services/ConfigService.cs:61-70`, `Resources/setup.json` |

### 3) Secrets and Credentials Handling

- Credential sources: `%LOCALAPPDATA%\AugmentScale\secrets.dat` encrypted with Windows DPAPI (`DataProtectionScope.CurrentUser`) using entropy `AugmentScale.Secrets.v1`.
- Hardcoding checks: No database credentials or production keys hardcoded in source code. Seed PINs in `Resources/setup.json` (`1234`) are for initial development/testing only and hashed to `secrets.dat` on first launch.
- Rotation or lifecycle notes: PINs can be reset via supervisor in WebUI or CLI tool `AugmentScale.exe --reset-pin <operator-id>`. Database key cannot be rotated without re-encrypting the database via SQLCipher export.

### 4) Reliability and Failure Behavior

- Retry/backoff behavior: Serial connection automatically reconnects every 3 seconds if disconnected, port is busy, or cable is detached (`ScaleReaderService.Run:96`).
- Timeout policy: Serial read timeout set to 500ms; bridge IPC timeout set to 30,000ms (`runtime.js:58`).
- Circuit-breaker or fallback behavior: When scale disconnects, WebUI shows yellow status indicator and displays "Scale disconnected" toast, preserving currently captured readings.

### 5) Observability for Integrations

- Logging around external calls: Serial connection lifecycle and port errors logged to `AppLog.cs` and recorded in `scale_health_events` database table (`ScaleReaderService.cs:86`).
- Metrics/tracing coverage: None configured.
- Missing visibility gaps: No remote telemetry or alerting pipeline in Phase 1 (local offline deployment).

### 6) Evidence

- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `USER_MANUAL.md`
- `OPEN_RAW_DB.md`
