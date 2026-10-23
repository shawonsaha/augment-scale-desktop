# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: layered desktop monolith with an event-driven WebView2 bridge.
- Why this classification: the code is organized into a WPF host shell, a service layer, a persistence layer, and a separate browser-rendered UI. The UI talks to C# through a request/response command envelope, while the scale reader pushes asynchronous reading/status events into the page (`AugmentScale/Services/BridgeService.cs`, `AugmentScale/Services/ScaleReaderService.cs`).
- Primary constraints:
  - One encrypted local database per workstation and no network dependency for weighing (`ConfigService.cs:51-59`).
  - Hardware timing and reconnect behavior are isolated on a dedicated background thread (`ScaleReaderService.cs:42-63`).
  - The UI is an offline-first HTML application served from a virtual host; all durable writes cross the bridge rather than touching storage directly (`MainWindow.xaml.cs:89-98`, `WebUI/js/runtime.js`).

### 2) System Flow

```text
WPF App.OnStartup
  -> ConfigService + DatabaseService + ScaleReaderService + BridgeService
  -> MainWindow / WebView2 virtual host
  -> WebUI bootstrap (loadProductionData -> getBootState)
  -> operator action -> sendCommand({command,payload,requestId})
  -> BridgeService -> DatabaseService transaction -> response
  -> scale thread -> decoder/stability -> BridgeService push -> ScaleApp.onWeightData
```

1. `App.OnStartup` acquires the single-instance mutex, initializes `ConfigService`, constructs the services, shows `MainWindow`, then calls `DatabaseService.EnsureInitialized()` so the splash can paint while SQLCipher opens (`App.xaml.cs:17-87`).
2. `MainWindow.OnLoaded` checks the WebView2 runtime, maps `app.augmentscale.local` to the `WebUI` folder, attaches `BridgeService`, and navigates to `index.html` (`MainWindow.xaml.cs:60-98`).
3. `main.js` starts `loadProductionData()` and HTML partial loading concurrently. `loadProductionData()` calls `getBootState`, which returns operators, vehicles, pending tickets, up to 1,000 history tickets, next ticket number, and sync status (`WebUI/js/main.js:25-57`, `WebUI/js/state.js:485-509`, `DatabaseService.cs:987-1001`).
4. Operator actions call `sendCommand` in `runtime.js`, which posts `{command, payload, requestId}` to the WebView2 host and rejects after 30 seconds (`WebUI/js/runtime.js:47-69`).
5. `BridgeService.HandleMessageAsync` deserializes the envelope, runs `DispatchAsync` on the thread pool, and posts a `commandResponse` back on the UI thread. Database writes are performed by `DatabaseService` with an explicit transaction; audit and outbox rows are written in the same transaction (`BridgeService.cs:88-110`, `DatabaseService.cs:1318-1368`).
6. The scale thread reads serial or TCP bytes, splits XK3190 frames, decodes and checks checksums, applies `StabilityDetector`, then raises `ReadingReceived`. `BridgeService` serializes the reading and calls `window.ScaleApp.onWeightData(...)` via `ExecuteScriptAsync` (`ScaleReaderService.cs:138-198`, `BridgeService.cs:355-374`).

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| WPF shell | Process lifetime, single-instance mutex, WebView2 setup, fullscreen/F11, loading overlay, fatal-error display | SQL, scale parsing, ticket rules | `App.xaml.cs`, `MainWindow.xaml.cs` |
| Configuration/secrets | Data-directory selection, `setup.json`, DPAPI-protected `secrets.dat`, PBKDF2 PIN hashes | Ticket or vehicle business rules | `Services/ConfigService.cs` |
| Persistence | Schema migration, provisioning, profiles, vehicles, ticket lifecycle, history/report queries, outbox/audit writes, scale health | UI state or DOM rendering | `Services/DatabaseService.cs`, `Services/AuditService.cs` |
| Scale transport | Serial/TCP connection, reconnect loop, XK3190 split/decode/checksum, stability detection, status messages | Ticket persistence or UI layout | `Services/ScaleReaderService.cs`, `AugmentScale.Protocol/` |
| Bridge | Command validation/routing, JSON serialization, live-push coalescing (drop a push while one is in flight), 15-minute supervisor session token | Business rules beyond authorization gating | `Services/BridgeService.cs` |
| WebUI | Screen rendering, client state, keyboard flows, validation, autocomplete, print layout, local display of locks | Direct SQLite/serial access; authoritative PIN verification in production | `WebUI/js/main.js`, `WebUI/js/state.js`, `WebUI/js/screens/` |
| Simulator | Loopback TCP server and synthetic scale frames/scenarios | Production data or real hardware access | `AugmentScale.ScaleSimulator/` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Manual composition root | `App.xaml.cs:57-75` | Four small services; no DI container or lifetime framework is needed |
| Request/response command envelope | `BridgeService.cs:88-110`, `WebUI/js/runtime.js:47-69` | Gives the browser UI a Promise-like RPC interface over WebView2 postMessage with correlation IDs and timeouts |
| Event push / observer | `ScaleReaderService.ReadingReceived` and `StatusChanged`; `BridgeService.OnReadingReceived` | Decouples the blocking serial thread from WPF/WebView2 |
| DTO mapping at the boundary | `Models/*Dto.cs`, `Models/Commands/*` | Keeps JSON payloads camelCase and separate from database rows |
| Idempotent provisioning/upsert | `DatabaseService.Provision` (`:188-312`) uses `ON CONFLICT` and seeds only when empty | Makes every startup safe to run against an existing database |
| Short-lived authorization token | `BridgeService.UnlockProfileAdmin` / `RequireProfileAdmin` (`:278-313`) | Avoids resending the supervisor PIN on every profile mutation; token slides for 15 minutes |
| Local-first outbox | `outbox_events` inserts in business transactions; `GetSyncStatus` counts pending rows (`DatabaseService.cs:1623-1652`) | Reserves a durable queue for a future cloud sync worker |
| Dual-mode UI | `IS_PRODUCTION` in `runtime.js:9-11`; seeded arrays in `state.js` | The same UI can run as a browser demo or against the C# host |

### 5) Known Architectural Risks

- `DatabaseService` is a 2,280-line class that owns schema, provisioning, profiles, vehicles, tickets, corrections, reports, sync status, and health logging. Changes to unrelated domains can collide in one file and tests for one area may require the whole service.
- Authentication is only as strong as the 4-digit PIN plus a browser-local lockout. Production PIN verification is in C# (`ConfigService.AuthenticatePin`), but failed-attempt counters live in `localStorage`, so clearing browser storage resets the lockout and there is no server-side rate limit (`WebUI/js/pin-auth.js:44-112`, `BridgeService.cs:122-126`).
- The outbox is written and counted but never delivered. `GetSyncStatus` always reports `IsHealthy = true` and the production UI labels sync as “Local only” (`DatabaseService.cs:1630-1652`, `WebUI/js/sync.js:92-111`). Cloud sync is a planned Phase 2 capability, not an implemented integration.
- There is no JavaScript build, type checker, or automated UI test layer. Large screens (`first-weigh.js` 1,680 lines, `history.js` 1,329 lines) rely on manual browser/desktop verification.
- Every database-backed bridge command opens a new SQLCipher connection and runs the operation synchronously inside `Task.Run` (`BridgeService.cs:101`, `DatabaseService.cs:126-140`). This is acceptable for one operator but does not provide a pooling or multi-workstation concurrency model.
- Schema evolution has one migration (`V001_InitialSchema.sql`) recorded in `schema_version`; there is no migration runner beyond the `version < 1` branch (`DatabaseService.cs:143-174`). A second schema version requires new code `[TODO]`.
- The window enables WebView2 DevTools and a `Ctrl+Shift+D` shortcut (`MainWindow.xaml.cs:82`, `:192-198`), which allows a local operator to inspect or modify the page runtime.

### 6) Evidence

- `AugmentScale/App.xaml.cs`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/WebUI/js/runtime.js`
- `AugmentScale/WebUI/js/state.js`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/Data/Schema/V001_InitialSchema.sql`
