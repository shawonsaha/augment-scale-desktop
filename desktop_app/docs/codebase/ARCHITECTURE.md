# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: Hybrid Desktop Shell (WPF Window hosting Microsoft Edge WebView2) with Layered Architecture, Repository Pattern, and an Offline-First Transactional Outbox Pattern for cloud synchronization.
- Why this classification:
  - The native layer (`AugmentScale`) manages OS integration, Win32 window handles, single-instance mutexes, DPAPI cryptography, serial COM port communication, and background worker threads.
  - The presentation layer (`WebUI`) executes in an isolated Chromium WebView2 runtime, serving HTML5/CSS/JavaScript assets through a local virtual host (`https://scale.augmentlab.net/`).
  - State mutations and database operations are encapsulated behind repository interfaces and executed inside atomic SQLCipher transactions.
  - Outbound data is written to an `outbox_events` table within the same transaction as business data, asynchronously synchronized to Supabase Cloud by a dedicated worker.
- Primary constraints:
  - 100% offline-first workstation resilience: Weighbridge weighing operations, ticket printing, and audit logging must operate continuously without an active internet connection.
  - Hard real-time serial ingest: RS-232 telemetry streams continuous ASCII/binary frames at 9600 baud without blocking the rendering or database threads.
  - Compliance and non-repudiation: Encrypted SQLCipher database, DPAPI secret management, soft deletions, and tamper-evident PDF day-sheet archive hashing.

### 2) System Flow

```text
[Scale Hardware / Simulator] -> [ScaleReaderService] -> [BridgeService] -> [WebView2 WebUI] -> [DatabaseService (Txn: Ticket + Audit + Outbox)] -> [Print System / Supabase Sync]
```

1. **Telemetry Ingest:** The indicator streams continuous XK3190 frames over RS-232 COM port or TCP socket. `ScaleReaderService` buffers the byte stream and dispatches it through `Xk3190FrameDecoder` and `StabilityDetector`.
2. **UI Broadcast:** When a frame is decoded, `ScaleReaderService` raises `ReadingReceived`. `BridgeService` throttles and pushes the weight reading to the WebView2 runtime using `ScaleApp.onWeightData()`.
3. **Operator Interaction:** The scale operator enters vehicle plate and product details in `first-weigh.js` or `second-weigh.js` and clicks Submit. JavaScript executes `sendCommand('createTicket' | 'completeTicket')` via `window.chrome.webview.postMessage`.
4. **Command Dispatch & Atomic Mutation:** `BridgeService` validates and deserializes the request on the thread pool, delegating to `DatabaseService` (`TicketRepository`). Within an atomic SQLite transaction, the ticket record is inserted/updated, an audit entry is created, and a corresponding synchronization event is appended to `outbox_events` with an incremented watermark sequence.
5. **Output Delivery:** `BridgeService` returns the completed ticket DTO to the WebUI to update local state and trigger the Windows print dialog via WebView2 `showSystemPrintDialog`.
6. **Asynchronous Cloud Sync:** `CloudControlService` background worker detects the new outbox row, batches pending events, and posts them to Supabase Cloud PostgreSQL REST endpoints.

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| `AugmentScale.Protocol` | Serial frame parsing, Yaohua checksum algorithms, byte stream framing, stability time-window calculation | Database queries, UI logic, network I/O | [Xk3190FrameDecoder.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Protocol/Xk3190FrameDecoder.cs) |
| `AugmentScale/Data` | Database schema migrations, SQLite connection management, repository queries, outbox sequencing, and retention maintenance | WebView2 interop, windowing, serial port I/O | [DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs) |
| `AugmentScale/Services` | Serial thread lifecycle, bridge message dispatch, Supabase heartbeat/sync loops, and PDF archive scheduling | Direct HTML rendering or SQL table definition | [BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs) |
| `AugmentScale/WebUI` | User interface presentation, DOM event handling, screen routing, touch/keyboard navigation, audio feedback | Direct database operations, native Win32 calls | [main.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/main.js) |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Transactional Outbox | [DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs#L106-L150) | Guarantees atomic dual-writes: database mutations and cloud sync messages commit or roll back together |
| Repository Pattern | [AugmentScale/Data/Repositories](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Repositories/) | Isolates SQL commands and parameterization from application business logic |
| Facade Pattern | [DatabaseService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/DatabaseService.cs#L16-L55) | Provides a clean, single-point API for `BridgeService` and background workers to interact with the database subsystem |
| IPC Request-Response Bridge | [BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs#L125) and [runtime.js](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/WebUI/js/runtime.js#L42) | Enables asynchronous promise-based message dispatch between WebView2 frontend and native C# backend |
| Background Worker / Semaphore Loop | `CloudControlService`, `PdfArchiveService`, `ScaleReaderService` | Runs persistent non-blocking background tasks with cancellation token support and instant wake signaling |

### 5) Known Architectural Risks

- Outbox queue stall on permanent failure: [Resolved] Previously, an error on any outbox sync event caused an immediate break, leaving the failed event pending indefinitely. CloudControlService now tracks retry attempts against `MaxOutboxAttempts` (10). Repeatedly failing events transition to `dead_letter` status (supported via `V006_OutboxDeadLetterStatus.sql` schema migration), logging `AppLog.Error` and allowing the queue worker to proceed to subsequent events without head-of-line blocking.
- Single workstation process model: The application assumes a single exclusive workstation lock per machine (`Local\AugmentScale.SingleInstance`).

### 6) Evidence

- [AugmentScale/MainWindow.xaml.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/MainWindow.xaml.cs)
- [AugmentScale/Services/BridgeService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/BridgeService.cs)
- [AugmentScale/Services/CloudControlService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs)
- [AugmentScale/Data/DatabaseContext.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs)
- [AugmentScale/Services/ScaleReaderService.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/ScaleReaderService.cs)
