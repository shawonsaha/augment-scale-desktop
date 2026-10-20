# Architecture

## Core Sections (Required)

### 1) Architectural Style

- Primary style: **single-page, screen-module driven vanilla-JS app** with a shared mutable
  state singleton and imperative DOM updates. Not layered, not component-based, not reactive.
- Why this classification: there is no framework, no templating engine, and no data binding.
  `js/state.js` exports one mutable `state` object and module-level arrays
  (`js/state.js:229-285`); screens read/write DOM nodes directly by `getElementById`
  (e.g. `js/screens/first-weigh.js:380-670`). HTML lives in `partials/` and is injected once
  by `js/html-loader.js:21-38`.
- Primary constraints:
  1. Everything renders client-side from static files; there is no server/API in the prototype.
  2. Only one operator, one browser tab, in-memory only — no persistence of tickets
     (`ponytail-audit.md:3-5`).
  3. Must run inside a WebView2 host later, so hardware I/O is delegated to `window.ScaleApp`
     (`js/bridge.js:21-26`).

### 2) System Flow

```text
index.html -> loadPartials() [fetch partials -> #app]
           -> bootstrap() calls init*() on every screen module
scale frames:  ScaleSimulator (15 fps) --subscribe--> telemetry.renderScaleData
               OR C# bridge window.ScaleApp.onWeightData -> applyExternalWeight()
renderScaleData -> state (liveWeight/stable/connected)
                -> HUD renderers (Set)  +  telemetry-bar DOM
                -> active screen preview updater (first/second weigh)

weighing: dashboard -> openFirstWeigh(dir) -> capture -> Preview -> print modal
          -> (Confirm) onDeferredConfirm -> consumeTicketId + pendingTickets.unshift
          -> renderPendingTicketsTable + sync (simulated)
          -> dashboard table -> openSecondWeighWithTicket -> capture -> net calc
          -> Preview -> Confirm -> remove from pendingTickets -> print
```

Four to six steps, file-backed: `js/main.js:20-38` → `js/scale-simulator.js:24,88-96` →
`js/telemetry.js:30-75` → `js/screens/first-weigh.js:1468-1576` → `js/print.js:217-327` →
`js/screens/dashboard.js:274-350`.

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| `state.js` | Mutable app state, seed data, ticket-ID counter | DOM, listeners | `js/state.js:229-285` |
| `scale-simulator.js` | Frame generation, motion/stability, pub/sub | Ticket/business logic | `js/scale-simulator.js:6-136` |
| `telemetry.js` | Frame fan-out to HUD + previews | Persisting data | `js/telemetry.js:30-75` |
| `bridge.js` | Public `window.ScaleApp` API for the C# host | UI rendering | `js/bridge.js:10-31` |
| `router.js` | Screen visibility + top-bar state | Screen-specific logic | `js/router.js:7-51` |
| `screens/*` | Screen DOM, capture state machine, commit | Cross-screen shared widgets (candidates for extraction) | `js/screens/first-weigh.js`, `js/screens/second-weigh.js` |
| `print.js` | Slip/certificate rendering, deferred-commit transaction | Capture logic | `js/print.js:22-188,217-327` |
| `sync.js` | Simulated outbox/health UI | Real network calls | `js/sync.js:8-183` |
| `reason-dialog.js` / `confirm-dialog.js` | Shared modal + keyboard trap | Business rules (passed via callbacks) | `js/reason-dialog.js:26-222`, `js/confirm-dialog.js:24-129` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Singleton | `state` object (`js/state.js:229`), `scaleSimulator` instance (`js/scale-simulator.js:138`) | One shared app/scale instance |
| Publish–subscribe | `scaleSimulator.subscribe` (`js/scale-simulator.js:83-96`), `registerHudRenderer`/`hudRenderers` Set (`js/telemetry.js:10-28`) | Decouple frame producer from consumers |
| Init-function module contract | Every module exports `initXxx()` called once by `bootstrap` (`js/main.js:23-36`) | No DI container; explicit init order |
| Deferred-commit callback | `openPrintSlipModal({ isDeferredCommit, onDeferredConfirm })` (`js/print.js:238-264`, `js/screens/first-weigh.js:1518`) | Preview/print before mutating data |
| Callback-configured shared dialog | `openReasonDialog`/`openConfirmDialog` take `onConfirm`/`onCancel` | Reuse one modal across screens |
| Guarded DOM writes | `if (el) el.textContent = ...` throughout `updateXxxPreview` | Partials may not be loaded yet |

### 5) Known Architectural Risks

- **Single mutable global state + direct DOM writes** make behavior order-dependent; e.g. a
  truck selection triggers `updateFirstWeighPreview` several times synchronously
  (`ponytail-audit.md:88-93`).
- **`mountHud` is async but never awaited** in the three `init*` functions, so the HUD slot can
  be blank for the first frames (`js/hud.js:20`, `js/screens/first-weigh.js:1050`,
  `future-plan.md:63-71`).
- **`ScaleSimulator` starts in its constructor** and runs by default in every environment; the
  only stop path is the first real bridge frame (`js/scale-simulator.js:19,82`).
- **No separation between preview and commit** in `first-weigh.js`; the commit logic is inline
  in a callback, which is why it is untested (`ponytail-audit.md:69-74`).
- Intent vs reality: PRD/plan describe C# WPF + WebView2 + Supabase + Next.js
  (`draft-prd.md:12-53`), but this repo contains only the browser prototype; Supabase "sync"
  is a `setTimeout` simulation (`js/sync.js:144-170`).

### 6) Evidence

- `js/main.js`, `js/router.js`, `js/state.js`, `js/telemetry.js`, `js/scale-simulator.js`
- `js/screens/first-weigh.js`, `js/screens/second-weigh.js`, `js/print.js`, `js/sync.js`
- `js/bridge.js`, `js/hud.js`
