# Future Plan — Deferred Cleanup

Follow-ups from the [ponytail audit](./ponytail-audit.md) that were intentionally **not** done in the polish pass. None are blocking a demo; they become worth doing as the prototype grows or before it ships to a live station.

Ordered by return-on-effort (highest first).

---

## A. Extract the First Weigh screen into focused modules (audit #4)

**Problem:** `js/screens/first-weigh.js` is ~1,400 lines doing five jobs: direction selection, truck autocomplete, material dropdown, the capture state machine, and commit. The truck-suggestion rendering alone is 100+ lines inside `init()`.

**Approach (no behavior change):**
1. `js/screens/first-weigh/truck-autocomplete.js` — input wiring, suggestion render, keyboard nav, apply-selection.
2. `js/screens/first-weigh/material-dropdown.js` — same for material.
3. `js/screens/first-weigh/discard-dialog.js` — thin wrapper over the now-shared `openConfirmDialog` (already done for the shared part; the wrapper still lives in `first-weigh.js`).
4. Keep the capture state machine, validation, and `init()` wiring in the parent.

**Acceptance:** `first-weigh.js` under ~600 lines; `npm test` green; no DOM or behavior change (verify with the browser smoke pass).

**Effort:** Medium. Do it in one screen-extraction PR; don't bundle other changes.

---

## B. Test the capture → commit flow in Node (audit #8)

**Problem:** The single most important operation — capture weight, build a ticket, push to `pendingTickets` — only runs in the browser. Pure functions are well covered; the core flow is not.

**Approach:**
1. Extract the commit body from the deferred-confirm callback in `first-weigh.js` into `commitFirstWeighTicket(state, data)` (pure-ish: takes state + captured data, mutates `pendingTickets`, returns the ticket).
2. Add a `tests/self_check.js` section that builds a fake state, commits two tickets, and asserts: IDs are sequential and non-reused, `pendingTickets` shape is correct, duplicate-ticket blocking still triggers.

**Acceptance:** A ticket committed with truck `MH12AB1234` produces exactly one `pendingTickets` entry with the expected fields and the next-peeked ID.

**Effort:** Small–medium. High value.

---

## C. Coalesce `updateFirstWeighPreview` calls (audit #10)

**Problem:** A single truck selection triggers the preview 3× synchronously (`applyTruckSelection` → `evaluateTruckState` → `updateRegisterStrip`), each doing ~20 DOM reads/writes. Fine today; wasteful as the screen grows.

**Approach:** Batch the non-telemetry callers behind a single `schedulePreview()` that coalesces into one `requestAnimationFrame`. Leave the telemetry path writing directly (it already runs once per frame).

**Acceptance:** Selecting a truck updates the preview once per frame; no visual difference.

**Effort:** Small. Do it opportunistically, not on its own.

---

## D. Replace the manual `?v=polish2` cache buster with a build step (audit #12)

**Problem:** `?v=polish2` appears in `index.html` (10 links) and is now the source of truth in `js/html-loader.js` (`ASSET_VERSION`). It must be bumped by hand every deploy or operators see stale CSS/JS.

**Approach:** Add a tiny build/release script that rewrites the version tag from the git short SHA (or a package version) across `index.html` + `ASSET_VERSION`. When the app is bundled into the C# WebView2 package, the tag can be dropped entirely (files ship together).

**Acceptance:** One command sets a new version in both places; grep finds no hardcoded `polish2`.

**Effort:** Small.

---

## E. HUD render/await ordering (audit #7, remainder)

**Problem:** `mountHud` is async and called without `await`; if the (now cacheable) fetch is slow, the HUD slot is empty for the first frames. Null guards prevent crashes, but the HUD is briefly blank.

**Approach:** Either `await mountHud(...)` in the three init functions, or add `hud.html` to the `PARTIALS` array and have `mountHud` clone the already-loaded template instead of fetching.

**Acceptance:** HUD is populated on first paint on a throttled connection.

**Effort:** Small.

---

## Not planned here

- **Operator PINs (#3)** — move verification to the C# host before any live station. Tracked as a pre-deploy gate, not a cleanup task.
