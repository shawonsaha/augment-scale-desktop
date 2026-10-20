# Ponytail Audit — Augment Scale Prototype

**What this repo does:** A browser-based weighbridge management prototype that simulates a two-step weighing workflow (First Weigh → Second Weigh) with operator PIN login, live scale telemetry from an XK3190-D10 simulator, duplicate-ticket safety blocking, anomaly detection (gross ≤ tare), and a print-slip certificate. It is a single-operator HTML/JS app served by `python3 -m http.server`. All data lives in memory — there is no database.

**Assumed load:** One operator at a time on a single browser tab. No server, no persistence, no concurrent users.

---

## Must Fix

### 1. `getNextTicketId()` advances the counter every time it is *read* ([state.js:L209-215](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/state.js#L209-L215))

- **What this is:** The function that generates the next ticket ID. It is called both to *display* the predicted ID in the First Weigh header and to *assign* the real ID at commit time.
- **Problem:** It calls `nextTicketId++` on every invocation — including the display-only calls from `updateTicketIdDisplay()`. So opening First Weigh, then closing and reopening it, burns IDs. The header might say #11355 but the ticket actually committed as #11353 because `openPrintSlipModal` calls `getNextTicketId()` again, getting a different number than the one shown.
- **Fix:** Split into `peekNextTicketId()` (read-only, no increment) for display and `consumeNextTicketId()` (increments) for commit. Or: cache the peeked ID in `state.firstWeigh` when the screen opens and use that same value at commit time.
- **If we skip it:** Ticket IDs on the printed slip can differ from what the operator saw on screen. Gaps in the ID sequence — confusing for auditors.
- **Status:** ✅ Fixed — split into `peekNextTicketId()` (display-only, no increment) and `consumeTicketId(id)` (commit; advances and clamps above the highest existing ID). The displayed ID and the committed ID now always agree. Covered by `tests/self_check.js` §3 and §3b.

### 2. `telemetry.js` capture-button override is redundant dead code ([telemetry.js:L53-66](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/telemetry.js#L53-L66))

- **What this is:** On every telemetry frame (~15/sec), `renderScaleData` directly sets `btn.disabled` on both capture buttons based solely on `isConnected && isStable`.
- **Correction (recheck):** The original claim — that this "clobbers" the screen-level guards so capture appears enabled when blocked — is **wrong**. `renderScaleData` runs the override and *then* calls `updateFirstWeighPreview` / `updateSecondWeighPreview` in the same synchronous callback, so the final write is always the screen-level guard. The override never wins; it is simply a redundant assignment that runs before the authoritative one. (Verified in-browser: button stays correctly disabled for a blocked direction.)
- **Fix:** Removed the `[btnCapture1, btnCapture2].forEach(...)` block. The screen-level preview updaters already set button state correctly and were already the effective writers. Also dropped the now-unused `btnCapture1`/`btnCapture2` captures in the callback.
- **If we skip it:** No bug, no user impact — it is dead work, not a defect. Removing it eliminates two per-frame DOM writes.
- **Status:** ✅ Fixed (override block removed from `telemetry.js`).

### 3. All operators share PIN `1234` — hardcoded in client code ([state.js:L16,27,38,49,60](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/state.js#L6-L62), [pin-auth.js:L5-7](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/pin-auth.js#L5-L7))

- **What this is:** Every operator has `pin: '1234'`. The PIN is compared in plain text on the client.
- **Problem:** Anyone who views source or opens DevTools can read every operator's PIN. All five are the same, so any person can sign in as any operator. The `shortcut:` comment in `pin-auth.js` acknowledges this, but it is still the most critical security gap for a station that prints legal weight certificates with operator attribution.
- **Fix:** Already documented as "move verification to the C# host before a live station". The shortcut comment covers this. **No change needed right now** unless this prototype is about to be used for real weighing — in that case, fix before deployment.
- **If we skip it:** Any bystander can impersonate any operator. Weight certificates carry the wrong operator name.

---

## Should Fix

### 4. `first-weigh.js` is 1,679 lines — one file doing five jobs ([first-weigh.js](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/first-weigh.js))

- **What this is:** The First Weigh screen module. It handles direction selection, truck input + autocomplete dropdown, material dropdown, form validation, weight capture, duplicate-ticket blocking, discard dialog, preview/commit, and register-truck.
- **Problem:** Hard to read, hard to test. Each of these five concern areas (direction, truck input, material, capture state machine, commit) is interleaved with the others. The truck suggestion rendering alone is 100+ lines mixed into the init function.
- **Fix:** Extract truck-autocomplete, material-dropdown, and the discard dialog into their own small modules. Keep the state machine and init wiring in `first-weigh.js`. No behavior change.
- **If we skip it:** Any future change risks breaking unrelated behavior. The file is already the hardest to navigate in the repo.

### 5. Duplicate `document.addEventListener('click', ...)` for outside-click on truck and material dropdowns ([first-weigh.js:L1331-1339, L1433-1441](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/first-weigh.js#L1331-L1441))

- **What this is:** Two separate global click handlers that close the truck suggestions and material dropdown respectively.
- **Problem:** These are registered once at init and never removed. They are functionally fine, but they fire on *every click on the page* for the lifetime of the app — even on the login screen and dashboard. Two checks on every click, all the time.
- **Fix:** Merge into one handler, or register/unregister when the dropdowns open/close.
- **If we skip it:** Minor inefficiency. No bug, no user impact at single-operator scale.
- **Status:** ✅ Fixed — the two page-wide listeners are now one handler that closes either dropdown on an outside click, registered once (null-safe on both elements).

### 6. `html-loader.js` fetches partials with `Date.now()` cache buster on every page load ([html-loader.js:L24](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/html-loader.js#L24))

- **What this is:** Every partial is fetched with `?t=${Date.now()}` to bust the cache.
- **Problem:** In production (served from a C# WebView2), this means 7 network fetches that can never be cached. The `index.html` CSS links already use `?v=polish2` — a versioned cache buster that allows caching between deploys.
- **Fix:** Use the same `?v=polish2` pattern, or remove the cache buster entirely since the app will be bundled in the WebView2 package.
- **If we skip it:** Extra latency on every cold start. Not a problem during prototyping.
- **Status:** ✅ Fixed — partials now fetch with the shared `ASSET_VERSION` tag (`?v=polish2`) instead of `?t=${Date.now()}`, so they cache between deploys.

### 7. `hud.js` fetches `partials/hud.html` again even though it's not in the `PARTIALS` list ([hud.js:L13](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/hud.js#L13))

- **What this is:** The HUD template is fetched separately from the main partial loader. `mountHud` is called for each screen that has a HUD slot (dashboard, first-weigh, second-weigh).
- **Problem:** The fetch is cached after the first call, so there's only one extra request. But `mountHud` is async and called without `await` from `initDashboard`, `initFirstWeighScreen`, and `initSecondWeighScreen`. If the fetch is slow, the HUD elements won't exist when telemetry starts rendering, causing silent failures (null checks prevent crashes, but the HUD stays blank until the next frame).
- **Fix:** Add `hud.html` to the `PARTIALS` array in `html-loader.js` and have `mountHud` read from the already-loaded DOM template instead of re-fetching. Or `await mountHud(...)` in each init function.
- **If we skip it:** On a fast local connection, imperceptible. On a slow connection, the HUD may not render for the first few seconds.
- **Status:** ⚠️ Partly fixed — the redundant request is now versioned/cacheable (`?v=${ASSET_VERSION}`, single fetch after first call). The `mountHud` await-ordering concern is deferred (see future plan).

### 8. No test for the weight capture and ticket commit flow ([tests/self_check.js](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/tests/self_check.js))

- **What this is:** The existing self-check tests cover formatting, ticket ID generation, PIN auth, ticket deletion, and HTML structure checks. Good coverage of pure functions.
- **Problem:** No test for the core business flow: capturing a weight, building a ticket, committing it to `pendingTickets`, and verifying that `pendingTickets` now contains a correct ticket. This is the single most important operation in the app, and it only runs in a browser.
- **Fix:** Extract the commit logic from the `onDeferredConfirm` callback in `first-weigh.js:L1607-1658` into a testable function like `commitFirstWeighTicket(data)` that can run in Node.
- **If we skip it:** The most critical path is only tested manually by clicking through the UI.

### 9. Discard dialog code is nearly copy-pasted between first-weigh and second-weigh ([first-weigh.js:L196-311](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/first-weigh.js#L196-L311), [second-weigh.js:L151-267](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/second-weigh.js#L151-L267))

- **What this is:** Both screens create a "Discard?" confirmation dialog with identical HTML structure, identical keyboard trap, identical button handlers. ~120 lines duplicated.
- **Problem:** Two places that must change together. The repo already has a shared `reason-dialog.js` for exactly this pattern.
- **Fix:** Refactor both discard dialogs to use `openReasonDialog` or a simpler shared `openConfirmDialog`. Delete ~100 lines.
- **If we skip it:** Must change two files every time the dialog style or keyboard behavior changes.
- **Status:** ✅ Fixed — added a shared `js/confirm-dialog.js` (`openConfirmDialog`). Both `openDiscardFirstWeighDialog` and `openDiscardWeightDialog` are now thin wrappers configuing title/message/labels/onConfirm. ~230 duplicated lines removed; keyboard trap and dialog behavior preserved.

---

## Nice to Have

### 10. `updateFirstWeighPreview` is called 3-6 times per action ([first-weigh.js](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/first-weigh.js))

- **What this is:** The preview state machine. It is called from `evaluateTruckState`, `updateRegisterStrip`, `applyTruckSelection`, `applyMaterialSelection`, and from the telemetry stream at 15 fps.
- **Problem:** Each call does ~20 DOM reads and writes. At 15 fps from telemetry alone, this is fine. But a single truck selection triggers it 3 times synchronously (apply selection → evaluate truck → update register strip).
- **Fix:** Debounce via `requestAnimationFrame` for the non-telemetry calls, or batch the three calls into one.
- **If we skip it:** No visible jank on modern hardware.

### 11. Missing `favicon.ico` — 8 console errors per session ([console log](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/.playwright-mcp/console-2026-10-17T08-35-22-183Z.log))

- **What this is:** The browser requests `/favicon.ico` on every page navigation. The Python dev server returns 404.
- **Fix:** Add a `favicon.ico` or a `<link rel="icon" href="data:,">` to suppress the request.
- **If we skip it:** Console noise. No user impact.
- **Status:** ✅ Fixed — added `<link rel="icon" href="data:," />` to `index.html`; the 404 is gone.

### 12. `?v=polish2` cache buster in `index.html` is manual and will get stale ([index.html:L17-26](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/index.html#L17-L26))

- **What this is:** All CSS and JS links have `?v=polish2`. This must be updated manually on every deploy.
- **Fix:** Use a build step or `Date.now()` in the HTML (only for development).
- **If we skip it:** Operators might see stale CSS after an update until hard-refresh.

---

**Verdict:** Healthy for a prototype. The original must-fix #1 (ticket ID mutation) is resolved — that one was a genuine UI-correctness bug. #2 was **not** the bug it was described as (the override was dead code; the screen-level guards always won) and has been removed. The recheck of #2 surfaced a *real* crash that this audit missed — see the addendum below — now fixed. #3 (shared PINs) remains a pre-deploy item, unchanged. The rest of the fixed cleanup (#5, #6, #9, #11) is done; #4, #8, #10, #12 are deferred to the future plan.

**Lean:** ~60 lines removed net. Two ~120-line discard dialogs collapsed into one 130-line shared `confirm-dialog.js` plus two thin wrappers (−177 in the screen files), minus the new shared module, plus the telemetry override block (−14) and the merged outside-click handler (−10).

**Not checked:** CSS files (3 of 10 are 10k+ lines — not audited for dead rules), avatar SVGs, HTML partials (read structure only, not every attribute), `node_modules`.

---

## Addendum — bug found while rechecking #2 (not in the original audit)

**Null reading crashes `updateSecondWeighPreview` and floods the console ~15×/sec** ([scale-simulator.js:L34-44](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/scale-simulator.js#L34-L44) → [second-weigh.js:L433](file:///Users/shawon/Documents/weight-scale/weight-scale-onsite-testing-report/scale/prototype/js/screens/second-weigh.js#L433))

- **What this is:** When the simulator is disconnected it emits `{ weight: null, isConnected: false }`. The telemetry stream passes `data.weight` straight into `updateSecondWeighPreview`, which called `currentWeight.toLocaleString()` unguarded.
- **Problem:** `TypeError: Cannot read properties of null (reading 'toLocaleString')` thrown on every frame while disconnected on the Second Weigh screen — console spam and a frozen preview.
- **Fix:** Guarded with `hasReading = Number.isFinite(currentWeight)`; the net fields now show `------` / "No live reading — scale offline" and `calcNet` is skipped when there is no reading.
- **Status:** ✅ Fixed and verified live (disconnect now shows a disabled "Waiting for stable…" button and the offline message, no console errors).
