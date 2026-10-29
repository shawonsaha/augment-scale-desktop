# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| Yaohua XK3190-D10 Scale Indicator | Serial Port (RS-232 / USB-Serial) | Live gross/tare continuous weight data stream | Physical cable / COM port parameters (9600-8-N-1) | High | [ScaleReaderService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ScaleReaderService.cs#L14) |
| Scale Simulator (Dev/Test) | TCP Socket | Emulated hardware weight stream for acceptance testing and training | Localhost TCP port (`TCP:127.0.0.1:9099`) | Low | [ScaleReaderService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ScaleReaderService.cs#L32) |
| Microsoft Edge WebView2 | Embedded Chromium Control | Workstation HTML5 user interface rendering & PDF report generator | Local virtual host mapping (`scale.augmentlab.net`) | High | [MainWindow.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/MainWindow.xaml.cs#L88) |
| Supabase Cloud | REST API (PostgREST) | Remote workstation management, license enforcement, and outbox synchronization | Bearer JWT (`anon` public key) | Medium | [CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L220) |
| Windows Print Spooler | OS Subsystem | Printing first-weigh slips and final completed weigh certificates | Windows User Session permissions | High | [BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs#L210) |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| SQLite / SQLCipher (`augment-scale.db`) | Local persistence of tickets, vehicles, operators, audit logs, and sync outbox | `DatabaseContext` via ADO.NET (`Microsoft.Data.Sqlite`) | File corruption from ungraceful machine shutdown; mitigated by WAL mode and transactional commits | [DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs#L66) |
| DPAPI Secret Vault (`secrets.dat`) | Local encryption key and operator PIN salt storage | `ConfigService` via `ProtectedData` Win32 API | Lost credentials if user profile is corrupted or transferred to another machine | [ConfigService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ConfigService.cs#L14) |
| Daily PDF Archives (`archives/*.pdf`) | Immutable daily PDF export of completed weighbridge operations | `PdfArchiveService` via WebView2 print-to-PDF | Disk space exhaustion over prolonged operations | [PdfArchiveService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/PdfArchiveService.cs#L10) |

### 3) Secrets and Credentials Handling

- Credential sources:
  - Database master encryption key: Dynamically generated 256-bit cryptographic key, encrypted using Windows Data Protection API (DPAPI) `DataProtectionScope.CurrentUser` and stored in `secrets.dat`.
  - Operator PINs: Hashed using PBKDF2 (100,000 iterations, SHA-256) with unique cryptographic salts stored in `secrets.dat`.
  - Supabase Cloud credentials: URL and anon JWT key loaded from `setup.json`.
- Hardcoding checks:
  - Default placeholder credentials exist as fallback properties in [SetupConfig.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L24-L25). Recommended to clear in production builds.
- Rotation or lifecycle notes:
  - Operator PINs can be rotated through the supervisor profile administration screen.
  - Database key remains static for the lifetime of the encrypted database file.

### 4) Reliability and Failure Behavior

- Retry/backoff behavior:
  - Scale Reader: If disconnected, enters automatic reconnect loop checking port availability every 1 second.
  - Cloud Sync: If sync fails or network drops, outbox worker records error in `last_error` and retries on next heartbeat interval or manual operator trigger (`syncNow`). Repeatedly failing events (attempts >= 10) transition to `dead_letter` status (enabled via `V006_OutboxDeadLetterStatus.sql` migration) and are recorded with error payloads in `server_response` to prevent stalling subsequent pending outbox events.
  - PDF Archiving: Interrupted or failed PDF renders remain recorded in `archive_runs` as `failed` and are automatically retried on next application startup.
- Timeout policy:
  - SQLite: `busy_timeout` set to 5000ms (`PRAGMA busy_timeout = 5000;`).
  - Supabase HTTP client: Uses standard 30-second request timeouts.
- Circuit-breaker or fallback behavior:
  - 30-day offline grace period: If the Supabase Cloud heartbeat is unreachable, the workstation checks `license_cache` and continues full offline operation for up to 30 days without interruption.

### 5) Observability for Integrations

- Logging around external calls: All scale connection events, outbox push batches, heartbeat statuses, and PDF generation steps are recorded with timestamps and thread IDs in `AppLog`.
- Metrics/tracing coverage: Real-time UI telemetry bar displays indicator connection status, live weight stability, Supabase cloud sync status, and license countdown.
- Missing visibility gaps: No remote telemetry pipeline for application crash dumps or hardware packet error rates beyond local disk logs.

### 6) Evidence

- [AugmentScale/Services/ScaleReaderService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ScaleReaderService.cs)
- [AugmentScale/Services/CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs)
- [AugmentScale/Services/ConfigService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ConfigService.cs)
- [AugmentScale/Data/DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs)
- [AugmentScale/Services/PdfArchiveService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/PdfArchiveService.cs)
