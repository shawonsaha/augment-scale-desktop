# Architecture

## Core Sections (Required)

### 1) Architectural Style

- **Primary style:** Hybrid Native Desktop Host + Embedded WebUI + Layered Service Architecture with Transactional Outbox & Append-Only Audit Trail.
- **Why this classification:** Native C# WPF acts as an OS-level runtime host managing serial port I/O (~15 fps), DPAPI secret protection, and SQLCipher native encryption, while Microsoft Edge WebView2 executes a zero-dependency ES module client application over an asynchronous JSON IPC bridge (`BridgeService.cs`).
- **Primary constraints:**
  - Air-gapped / offline-first execution: No cloud connectivity required for full weighbridge ticketing operations.
  - Strict hardware timing: Yaohua XK3190-D10 continuous 12-byte stream at 9600 baud requires dedicated non-blocking thread reading and buffer splitting.
  - Tamper resistance & regulatory audit: Encrypted local storage (SQLCipher AES-256), immutable audit records (`audit_events`), no physical ticket deletion, and required override reasons for weight anomalies.

### 2) System Flow

```text
[XK3190-D10 / Serial/TCP] -> [ScaleReaderService / Protocol] -> [BridgeService (IPC)] -> [WebUI (WebView2)] -> [BridgeService Dispatch] -> [DatabaseService (SQLCipher)] -> [Print / Outbox]
```

1. **Hardware Stream Reading:** `ScaleReaderService` runs on a dedicated background thread reading raw bytes via `SerialPort` (or `TcpClient`) with 500ms read timeouts.
2. **Protocol Framing & Stability:** `Xk3190FrameSplitter` finds STX/ETX boundaries, `Xk3190FrameDecoder` verifies XOR checksum and sign/weight digits, and `StabilityDetector` monitors a rolling window (default 500ms, 10kg tolerance).
3. **Real-time Telemetry Push:** `BridgeService.OnReadingReceived` throttles in-flight messages and invokes `ExecuteScriptAsync("window.ScaleApp.onWeightData(...)")` into WebView2.
4. **Operator Action:** Operator performs first/second weighing or manages tickets in WebUI; UI calls `sendCommand("createTicket"|"completeTicket", payload)` via `window.chrome.webview.postMessage`.
5. **Transactional Mutation:** `BridgeService.HandleMessageAsync` offloads command handling to the thread pool (`Task.Run`); `DatabaseService` executes ticket creation/completion, weight capture recording, audit trail append (`AuditService`), and outbox entry (`outbox_events`) in a single atomic SQLite transaction.
6. **Print & Notification:** Result is returned to WebUI via `window.chrome.webview.postMessage` response; WebUI updates local state, shows toast, renders printable certificate preview, and requests system print via `BridgeService.ShowPrintUI`.

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| `AugmentScale.Protocol` | Frame boundary splitting, XOR checksum calculation, numeric parsing, stability rolling window variance | UI rendering, file I/O, database tables, COM port handles | `AugmentScale.Protocol/Xk3190FrameDecoder.cs`, `StabilityDetector.cs` |
| `ScaleReaderService` | COM port lifecycle, TCP socket client, reconnection loop (3s backoff), raw byte stream pump | Business validations, ticket numbering, SQL queries | `AugmentScale/Services/ScaleReaderService.cs` |
| `ConfigService` | DPAPI secret encryption/decryption, PBKDF2 PIN hashing/verification, paths resolution, `setup.json` loading | Serial communication, ticket transactions | `AugmentScale/Services/ConfigService.cs` |
| `DatabaseService` | SQL schema migrations, atomic transactions, business CRUD, audit logging, outbox queueing, DTO mappings | DOM manipulation, WPF controls, serial byte parsing | `AugmentScale/Services/DatabaseService.cs` |
| `BridgeService` | WebView2 message deserialization, UI thread marshaling, request/response correlation, push telemetry throttling | Direct SQL queries (delegates to `DatabaseService`) | `AugmentScale/Services/BridgeService.cs` |
| `WebUI` | Route navigation, HTML rendering, form controls, audio feedback, print layout, keyboard shortcuts | Direct file I/O, database keys, native OS APIs | `AugmentScale/WebUI/js/main.js`, `bridge.js` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Named Mutex (Single Instance) | `App.xaml.cs:21-31` | Prevents multiple instances from locking the encrypted database or COM port |
| Command Request/Response Envelope | `CommandEnvelope.cs`, `BridgeService.cs`, `runtime.js:47-70` | Provides asynchronous promise-based IPC between WebView2 JavaScript and C# backend |
| Transactional Outbox | `DatabaseService.cs`, `V001_InitialSchema.sql:328-346` | Guarantees atomic staging of events for future cloud synchronization alongside business data |
| Append-Only Audit Log | `AuditService.cs`, `V001_InitialSchema.sql:303-326` | Ensures immutable non-repudiable history of all mutations with before/after snapshots |
| Virtual Host Folder Mapping | `MainWindow.xaml.cs:89-90` | Maps `app.augmentscale.local` to `WebUI/` without CORS friction, blocking external web navigation |
| Sliding Window Stability Tracking | `StabilityDetector.cs` | Calculates weight variance over configurable time window to verify scale settling before capture |

### 5) Known Architectural Risks

- **God-Class Database Service (`DatabaseService.cs`):** At 2,280 lines, `DatabaseService` handles schema migrations, master data provisioning, ticket operations, vehicle management, profile authentication, report generation, and outbox staging in a single file, increasing maintenance complexity.
- **DPAPI Single-User Machine Lock-In:** Because `secrets.dat` uses Windows DPAPI `CurrentUser` scope, the database cannot be decrypted by any other Windows user account or on another machine without manual key extraction via `tools/Get-DbKey.ps1`.
- **In-Memory WebUI State Duplication:** `WebUI/js/state.js` maintains full client-side collections (`pendingTickets`, `vehicles`, `operators`). Large datasets could degrade browser memory performance over time.

### 6) Evidence

- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/WebUI/js/runtime.js`
- `AugmentScale.Protocol/StabilityDetector.cs`
