# External Integrations

> The prototype has **no real backend, database, or third-party API**. External surfaces below
> are either browser platform APIs, a simulated integration, or the boundary to the future
> C# WebView2 host.

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|-------------------------|---------|------------|-------------|----------|
| C# WebView2 host (`window.ScaleApp`) | In-process JS↔native bridge (JSON) | Receives real weight frames, exposes state/toasts/navigation to the host | None in JS; host is trusted | High (future production path) | `js/bridge.js:10-31`, `js/telemetry.js:81-89` |
| XK3190-D10 scale indicator | Serial hardware (RS-232/COM1 9600 8N1) | Source of weight readings | None (read-only, continuous stream) | High | `draft-prd.md:126-140`; simulated in `js/scale-simulator.js` |
| "Supabase Cloud" sync | **Simulated** cloud sync / outbox | Shows sync health, pending queue, retry UI | None — no network calls | Low (UI only) | `js/sync.js:1-3,144-183` |
| Google Fonts CDN | Remote stylesheet | IBM Plex Sans + JetBrains Mono | Public | Low (cosmetic) | `index.html:12-17` |
| Browser print | `window.print()` | Prints slip/certificate | None | Medium | `js/print.js:229,252,316` |
| Browser `localStorage` | Key/value store | Dev mode, sim toggle, serial port, theme, operator lockouts | None (client-side) | Medium | `js/state.js:238-246`, `js/theme.js:25`, `js/pin-auth.js:12` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| In-memory arrays (`pendingTickets`, `deletedTickets`, `REGISTERED_TRUCKS`) | Only ticket/truck storage; lost on reload | `js/state.js` | No persistence; all data lost on refresh | `js/state.js:64,135,184`; `ponytail-audit.md:3-5` |
| `localStorage` | UI preferences + PIN lockout counters | `js/settings.js`, `js/theme.js`, `js/pin-auth.js` | Cleared by any user; lockout bypassable | `js/pin-auth.js:5-6` |
| (planned) encrypted SQLite | Intended persistent store — **not implemented here** | n/a | n/a | `draft-prd.md:12-24` |

### 3) Secrets and Credentials Handling

- Credential sources: none. No `.env`, `.env.example`, secrets manager, or API key in the repo
  (`docs/codebase/.codebase-scan.txt` ENVIRONMENT VARIABLE TEMPLATES section).
- Hardcoding found: operator PINs are hardcoded in client source (`pin: '1234'` on all five
  operators) and compared in plain text; the code itself flags this with a `shortcut:` comment
  (`js/state.js:16`, `js/pin-auth.js:5-6,36-42`).
- Rotation/lifecycle: none exists (prototype). No JWT/token handling present.

### 4) Reliability and Failure Behavior

- Retry/backoff: **simulated only** — a 30 s heartbeat re-runs `triggerSync` while "healthy";
  the toggle flips a boolean and inflates `pendingQueue` (`js/sync.js:52-56,172-183`).
- Timeout policy: none (no real requests). Partial fetches use `Promise.all`; a failed partial
  throws and aborts bootstrap (`js/html-loader.js:26-33`).
- Circuit-breaker/fallback: none. If `loadPartials()` rejects, `bootstrap()` never runs its
  `init*` calls and the app renders an empty `#app` (`js/main.js:20-38`).
- Hardware failure path: `applyExternalWeight` stops the simulator, so if the host stops
  sending frames the last `state.currentLiveWeight` can persist (`js/telemetry.js:81-89`).

### 5) Observability for Integrations

- Logging around external calls: only `console.error`/`console.warn`; no request/response logs
  (`js/scale-simulator.js:93`).
- Metrics/tracing: none.
- Missing visibility gaps: no error reporting, no sync-failure telemetry beyond a toast, and the
  simulator can silently stand in for real hardware (flagged `shortcut:`
  `js/scale-simulator.js:17-18`).

### 6) Evidence

- `js/bridge.js`, `js/telemetry.js`, `js/sync.js`, `js/scale-simulator.js`
- `js/settings.js`, `js/theme.js`, `js/pin-auth.js`, `js/state.js`
- `index.html`, `js/print.js`
- `draft-prd.md` (Supabase/COM1/WebView2 intent — not implemented)
