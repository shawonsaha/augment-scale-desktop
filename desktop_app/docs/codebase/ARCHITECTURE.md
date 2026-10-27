# Architecture

## Core Sections (Required)

### 1) Architectural Style

- **Primary style:** Hybrid native desktop host + embedded WebUI (a layered desktop monolith) with an event-driven WebView2 bridge, transactional outbox, append-only audit trail, and a background PDF archive scheduler that reuses the WebUI report renderer.
- **Why this classification:** A native C# WPF host owns OS-level concerns — the single-instance mutex, serial port I/O (~15 fps), DPAPI secret protection, SQLCipher encryption, and printing — while Microsoft Edge WebView2 executes a zero-dependency ES module client application. The UI talks to C# through an asynchronous JSON request/response command envelope, and the scale reader pushes reading/status events back into the page (`BridgeService.cs`, `ScaleReaderService.cs`, `MainWindow.xaml.cs`).
- **Primary constraints:**
  - Air-gapped / offline-first execution: no cloud connectivity is required for full weighbridge ticketing operations; one encrypted local database per workstation (`ConfigService.cs:51-59`).
  - Strict hardware timing: the Yaohua XK3190-D10 continuous 12-byte stream at 9600 baud requires a dedicated non-blocking thread, read timeouts, and buffer splitting (`ScaleReaderService.cs:42-63`).
  - Tamper resistance and regulatory audit: encrypted local storage (SQLCipher AES-256), immutable `audit_events`, no physical ticket deletion, and required override reasons for weight anomalies (`V001_InitialSchema.sql`, `AuditService.cs`).
  - The WebUI is served from a virtual host and all durable writes cross the bridge rather than touching storage directly (`MainWindow.xaml.cs:89-98`, `WebUI/js/runtime.js`).

### 2) System Flow

```text
WPF App.OnStartup
  -> single-instance mutex -> ConfigService
  -> DatabaseService + ScaleReaderService + BridgeService
  -> MainWindow / WebView2 virtual host
  -> WebUI bootstrap (loadProductionData -> getBootState)
  -> operator action -> sendCommand({command,payload,requestId})
  -> BridgeService -> DatabaseService transaction (+ audit + outbox) -> response
  -> scale thread -> splitter/decoder/checksum/stability
  -> BridgeService push -> ScaleApp.onWeightData
  -> print / outbox
  -> PdfArchiveService scheduler -> archive_runs -> hidden WebView2 -> PrintToPdfAsync
```

1. **Startup:** `App.OnStartup` acquires the single-instance mutex, initializes `ConfigService`, constructs the services, shows `MainWindow`, then calls `DatabaseService.EnsureInitialized()` so the splash can paint while SQLCipher opens (`App.xaml.cs`). After initialization it starts `PdfArchiveService`, which uses `MainWindow.EnvironmentReady` to wait for the shared WebView2 environment before rendering archive PDFs. The `--reset-pin` branch opens a WPF dialog and exits before normal startup (`App.xaml.cs`).
2. **WebView2 boot:** `MainWindow.OnLoaded` checks the WebView2 runtime, maps `scale.augmentlab.net` to the `WebUI` folder, attaches `BridgeService`, and navigates to `index.html` (`MainWindow.xaml.cs:60-98`). Permission requests are denied, new windows are blocked, and the scale reader starts only after navigation succeeds (`:92-93`, `:115-132`).
3. **Boot payload:** `main.js` starts `loadProductionData()` and HTML partial loading concurrently. `loadProductionData()` calls `getBootState`, which returns active operators/vehicles, all pending tickets, today's closed tickets (up to the 1,000-row boot limit), the next ticket number, and sync status (`WebUI/js/main.js:25-57`, `WebUI/js/state.js:485-514`, `Data/Services/BootStateService.cs`). Archived vehicles load when the Trucks screen opens. History always pages through `queryHistory` → `TicketRepository.HistoryPage`, which filters, sorts, aggregates, and pages in SQLite and returns only the visible page; interactive ranges are capped at 366 days.
4. **Operator action:** The WebUI calls `sendCommand` in `runtime.js` (for example `createTicket` or `completeTicket`), which posts `{command, payload, requestId}` through `window.chrome.webview.postMessage` to the WebView2 host and rejects after 30 seconds (`WebUI/js/runtime.js:47-69`).
5. **Transactional mutation:** `BridgeService.HandleMessageAsync` deserializes the envelope, runs `DispatchAsync` on the thread pool, and posts a `commandResponse` back on the UI thread. `DatabaseService` executes ticket creation/completion, capture recording, audit append, and outbox staging in one explicit SQLite transaction (`BridgeService.cs:88-110`, `Data/Repositories/TicketRepository.cs` (`CreateTicket`)).
6. **Telemetry push and output:** The scale thread reads raw bytes via `SerialPort` or `TcpClient` with 500 ms read timeouts, splits XK3190 frames at STX/ETX boundaries, verifies the XOR checksum and sign/weight digits, and applies `StabilityDetector` (default 500 ms window, 10 kg tolerance, at least 3 samples). `BridgeService.OnReadingReceived` coalesces in-flight pushes and invokes `window.ScaleApp.onWeightData(...)` via `ExecuteScriptAsync` (`ScaleReaderService.cs:138-198`, `BridgeService.cs:355-374`). The UI updates state, shows a toast, renders the printable certificate preview, and requests system print through `window.print()`. A `showSystemPrintDialog` bridge command exists that would call WebView2 `ShowPrintUI`, but no WebUI code invokes it (see `CONCERNS.md`).

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| WPF shell / app host | Process lifetime, single-instance mutex, WebView2 setup, fullscreen/F11, loading overlay, fatal-error display | SQL, scale parsing, ticket rules | `App.xaml.cs`, `MainWindow.xaml.cs` |
| Configuration/secrets | Data-directory selection, `setup.json`, DPAPI-protected `secrets.dat`, PBKDF2 PIN hashes, paths resolution | Serial communication, ticket or vehicle business rules | `Services/ConfigService.cs` |
| Persistence | Schema migrations, provisioning, profiles, vehicles, ticket lifecycle, history/report queries, archive run log, outbox/audit writes, scale health, DTO mappings | UI state, DOM rendering, WPF controls, serial byte parsing | `Services/DatabaseService.cs` (facade), `Data/DatabaseContext.cs`, `Data/Repositories/`, `Data/Services/`, `Services/AuditService.cs` |
| PDF archive | Baseline/daily scheduling, missed-day catch-up, retry/backoff, staging/atomic file placement, archive status for the Sync UI, offscreen WebView2 PDF rendering | Ticket business rules, direct SQL, UI layout | `Services/PdfArchiveService.cs`, `Services/IPdfArchiveRenderer.cs`, `Services/WebViewPdfArchiveRenderer.cs`, `Data/Repositories/ArchiveRunRepository.cs`, `WebUI/archive-report.*` |
| `AugmentScale.Protocol` | Frame boundary splitting, XOR checksum calculation, numeric parsing, frame encoding, stability rolling-window variance | UI rendering, file I/O, database tables, COM port handles | `AugmentScale.Protocol/Xk3190FrameDecoder.cs`, `Xk3190FrameEncoder.cs`, `Xk3190FrameSplitter.cs`, `StabilityDetector.cs` |
| Scale transport | COM port lifecycle, TCP socket client, reconnection loop (3 s backoff), raw byte stream pump, status messages | Business validations, ticket numbering, SQL queries, UI layout | `Services/ScaleReaderService.cs` |
| Bridge | WebView2 message deserialization, command validation/routing, JSON serialization, UI thread marshaling, request/response correlation, push telemetry throttling, 15-minute supervisor session token | Direct SQL queries (delegates to `DatabaseService`), business rules beyond authorization gating | `Services/BridgeService.cs` |
| WebUI | Route navigation, HTML rendering, form controls, client state, keyboard flows, validation, autocomplete, audio feedback, print layout, local display of locks | Direct file I/O, database keys, raw SQL, native OS APIs, authoritative PIN verification in production | `WebUI/js/main.js`, `state.js`, `bridge.js`, `screens/` |
| Simulator | Loopback TCP server and synthetic scale frames/scenarios | Production database writes, real hardware access, production business logic | `AugmentScale.ScaleSimulator/` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Named mutex (single instance) | `App.xaml.cs:21-31` | Prevents multiple instances from locking the encrypted database or COM port; a second instance shows a message and exits |
| Manual composition root | `App.xaml.cs:57-75` | Four small services are wired explicitly; no DI container or lifetime framework is needed |
| Command request/response envelope | `CommandEnvelope.cs`, `BridgeService.cs:88-110`, `runtime.js:47-69` | Provides a Promise-like RPC interface over WebView2 postMessage with correlation IDs and a 30-second timeout |
| Event push / observer | `ScaleReaderService.ReadingReceived` and `StatusChanged`; `BridgeService.OnReadingReceived` | Decouples the blocking serial thread from WPF/WebView2 and coalesces pushes while one is in flight |
| Transactional outbox (local-first) | `Data/DatabaseContext.cs` (`InsertOutbox`), `Data/Services/SyncStatusService.cs`, `V001_InitialSchema.sql:328-346` | Atomically stages events for a future cloud sync worker alongside business data; `GetSyncStatus` counts pending rows |
| Append-only audit log | `AuditService.cs`, `V001_InitialSchema.sql:303-326` | Ensures non-repudiable history of mutations with actor, workstation, reason, and before/after snapshots in the same transaction |
| Virtual host folder mapping | `MainWindow.xaml.cs:89-90` | Maps `scale.augmentlab.net` to `WebUI/` without CORS friction and blocks external web navigation |
| Sliding-window stability tracking | `StabilityDetector.cs` | Calculates weight variance over a configurable window to verify the scale has settled before capture |
| DTO mapping at the boundary | `Models/*Dto.cs`, `Models/Commands/*` | Keeps camelCase JSON payloads separate from database rows and C# models |
| Idempotent provisioning/upsert | `Data/Provisioner.cs` uses `ON CONFLICT` and seeds only when empty | Makes every startup safe to run against an existing database |
| Domain repositories behind interfaces | `Services/DatabaseService.cs` composes `Data/Repositories/*` and `Data/Services/*`; implementations are `internal sealed` | Keeps SQL in focused units while preserving one public entry point and manual composition |
| Short-lived authorization token | `BridgeService.UnlockProfileAdmin` / `RequireProfileAdmin` (`:278-313`) | Avoids resending the supervisor PIN on every profile mutation; the token slides for 15 minutes and is process-local |
| Host-driven WebUI | `hasDesktopBridge` in `runtime.js`; state loaded from SQLite via bridge | The UI runs exclusively against the C# host; standalone browser demo fallback has been retired |
| Background scheduler with durable run log | `PdfArchiveService`, `ArchiveRunRepository`, `archive_runs` | Serializes archive work, survives restarts, catches up missed days, and retries failed runs without duplicating periods |
| Shared report renderer | `WebUI/js/history-report-document.js`, `history-report.js`, `archive-report.js` | Interactive preview and automated PDF archive use the same report DOM, avoiding layout drift |
| Hidden WebView2 print-to-PDF | `WebViewPdfArchiveRenderer` | Reuses the main WebView2 environment and installed runtime; renders A4 PDFs without a user print dialog or a second browser engine |

### 5) Known Architectural Risks

- **Thin facade is the only composition root:** `DatabaseService.cs` manually wires the domain repositories and services; there is no DI container. Adding a persistence domain requires updating the facade constructor and properties, and the internal implementations are not independently resolvable. Keep composition changes localized to `DatabaseService`.
- **DPAPI single-user machine lock-in:** `secrets.dat` uses Windows DPAPI `CurrentUser` scope. The database cannot be decrypted by another Windows user account or on another machine without extracting the key via `tools/Get-DbKey.ps1`; loss of the file is unrecoverable.
- **PIN authentication is only as strong as a 4-digit PIN plus a browser-local lockout:** Production verification runs in C# (`ConfigService.AuthenticatePin`), but failed-attempt counters live in `localStorage`, so clearing browser storage resets the lockout and there is no server-side rate limit (`WebUI/js/pin-auth.js:44-112`, `BridgeService.cs:122-126`).
- **In-memory WebUI state duplication:** `WebUI/js/state.js` maintains the boot snapshot (active operators/vehicles, today's closed tickets, and all pending tickets). History no longer replaces the ledgers with a selected range; it keeps only the visible page and asks SQLite for every filter, sort, total, and page. Client arrays can still drift from SQLite for the dashboard ledgers.
- **Outbox written but never delivered:** `GetSyncStatus` always reports `IsHealthy = true` and the production UI labels sync as "Local only" (`Data/Services/SyncStatusService.cs`, `WebUI/js/sync.js:92-111`). Cloud sync is a planned Phase 2 capability, not an implemented integration.
- **No JavaScript bundler or automated UI test layer:** Bridge payloads and state mutations are now statically typed in the editor via `jsconfig.json`, `types.d.ts`, and JSDoc (`@ts-check`), but UI DOM rendering and screen workflows still rely on manual desktop workstation verification.
- **One new SQLCipher connection per database-backed command:** Operations run synchronously inside `Task.Run` (`BridgeService.cs:101`, `Data/DatabaseContext.cs` (`OpenConnection`)). This is acceptable for one operator but provides no pooling or multi-workstation concurrency model.
- **Migration runner is still minimal:** `SchemaMigrator` now applies `V001_InitialSchema.sql` and `V002_ArchiveRuns.sql` transactionally, but there is no generic discovery, downgrade, or rollback path. A future migration requires another explicit version branch (`Data/SchemaMigrator.cs`).
- **PDF archive depends on the desktop session:** `PdfArchiveService` runs inside the app, so a workstation that is off at 00:05 catches up only on the next launch. The hidden WebView2 renderer depends on the main window's `EnvironmentReady` task, and a failure leaves the run failed until an automatic or manual retry (`Services/PdfArchiveService.cs`, `Services/WebViewPdfArchiveRenderer.cs`).
- **Archive PDFs are outside SQLCipher:** files under `archives\` are plain PDFs, not encrypted by the database key. The documented backup now copies them with the database and secrets, but they still contain the same business and personal data and must be access-controlled separately (`Services/ConfigService.cs`, `start-dev-sim.ps1`, `USER_MANUAL.md`).
- **DevTools enabled in all builds:** `AreDevToolsEnabled = true` and a `Ctrl+Shift+D` shortcut allow a local operator to inspect or modify the page runtime and bridge API (`MainWindow.xaml.cs:82`, `:192-198`).

### 6) Evidence

- `AugmentScale/App.xaml.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Data/DatabaseContext.cs`
- `AugmentScale/Data/Repositories/`
- `AugmentScale/Data/Services/`
- `AugmentScale/Models/BootStateDto.cs`
- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/WebUI/js/runtime.js`
- `AugmentScale/WebUI/js/state.js`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/WebUI/js/main.js`
- `AugmentScale.Protocol/StabilityDetector.cs`
- `AugmentScale/Data/Schema/V001_InitialSchema.sql`
- `AugmentScale/Data/Schema/V002_ArchiveRuns.sql`
- `AugmentScale/Services/PdfArchiveService.cs`
- `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`
- `AugmentScale/Data/Repositories/ArchiveRunRepository.cs`
- `AugmentScale/WebUI/archive-report.html`
- `AugmentScale/WebUI/js/history-report-document.js`
