# Codebase Concerns

> Scope: the `scale/prototype/` browser prototype. Prior analysis lives in
> `ponytail-audit.md` (fixes done) and `future-plan.md` (deferred work).

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | All five operators share the hardcoded PIN `1234`, verified in plain text on the client | `js/state.js:16,28,38,50,60`; `js/pin-auth.js:5-6,36-42` | Anyone can impersonate any operator; printed certificates carry the wrong operator name | Move PIN verification to the C# host before any live weighing (already the stated pre-deploy gate: `future-plan.md:75-77`) |
| high | The scale simulator starts in its constructor and runs by default in every environment; only a real bridge frame stops it | `js/scale-simulator.js:17-24,82`; `js/telemetry.js:81-89` | On a real station without the serial link, fabricated weights could be presented as real | Gate the simulator on `devMode` before a pilot (flagged in-code as `shortcut:`) |
| high | No persistence — tickets/trucks live only in memory | `js/state.js:135,184`; `ponytail-audit.md:3-5` | A refresh loses all pending tickets; not usable for real weighing | Out of scope for the prototype; required in the C#/SQLite phase (`draft-prd.md:12-24`) |
| med | The core capture→commit flow is untested | `ponytail-audit.md:69-74`; `future-plan.md:25-35`; `tests/self_check.js` | A regression in the most important path would ship unnoticed | Extract `commitFirstWeighTicket(state, data)` and cover it (`future-plan.md:29-35`) |
| med | `npm run format:check` fails across 63 files | terminal output of `npm run format:check` (exit 1) | Pre-commit/style expectations can't be enforced; noisy CI if added | Run `npm run format` once, or relax the ignore list |
| med | No CI pipeline runs tests or lint | `docs/codebase/.codebase-scan.txt` CI/CD section: "No CI/CD pipelines detected" | Nothing prevents broken pushes | Add a workflow running `npm test` + `npm run lint` |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| `first-weigh.js` is ~1,591 lines doing ~5 jobs (direction, truck autocomplete, material dropdown, capture state machine, commit) | Grew during polish passes | `js/screens/first-weigh.js` (1591 lines); noted `ponytail-audit.md:38-43` | Every change risks unrelated behavior | Extract truck-autocomplete / material-dropdown / discard modules (`future-plan.md:9-21`) |
| Commit logic is inline inside the print-modal callback | Deferred-commit design | `js/screens/first-weigh.js:1518-1571` | Cannot be unit-tested | Extract a pure-ish `commitFirstWeighTicket` (`future-plan.md:29-35`) |
| `updateFirstWeighPreview` called 3–6× per truck selection, ~20 DOM ops each | Multiple call sites | `js/screens/first-weigh.js:942-943,1133-1134,1259,1391-1392`; `ponytail-audit.md:88-93` | Redundant layout work as the screen grows | Coalesce behind one `requestAnimationFrame` (`future-plan.md:39-47`) |
| Manual `?v=polish2` cache-buster duplicated in `index.html` (10 links) and `ASSET_VERSION` | No build step | `index.html:20-29`, `js/html-loader.js:9` | Stale assets after deploy unless bumped by hand | Generate the tag from a build/release script (`future-plan.md:51-59`) |
| HUD partial fetched outside the `PARTIALS` array and `mountHud` is never awaited | Speed-of-light concern not applied to the HUD | `js/hud.js:14,20`; `js/screens/first-weigh.js:1050`, `js/screens/dashboard.js:17`, `js/screens/second-weigh.js:22` | HUD blank for first frames on slow connections | Await `mountHud` or add `hud.html` to `PARTIALS` (`future-plan.md:63-71`) |
| Single test script mutates shared module state in order-dependent fashion | No test harness/reset | `tests/self_check.js:60-73,155-167` | Fragile suite; a failure stops all later checks | Split into independent assertions with reset helpers |
| Browser-structure tests assert exact copy strings | Fast regression checks | `tests/self_check.js:195-229` | Copy changes break tests | Assert on ids/roles instead of exact text |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Shared/plaintext operator PINs in client source | A07 Identification & Authentication Failures | `js/state.js:16`, `js/pin-auth.js:36-42` | None | No server-side auth; verify on the C# host (`future-plan.md:75-77`) |
| Lockout is `localStorage`-only and clearable | A07 | `js/pin-auth.js:5-6,47-91` | Attempt counter + 60 s lock | Anyone can clear storage to reset attempts |
| No CSP / served over plain `http.server` | A05 Security Misconfiguration | `package.json:11`, `index.html` (no CSP meta) | None | Add CSP when hosted in WebView2 |
| Untrusted text rendered into HTML | A03 Injection | `js/screens/dashboard.js:334-337`, `js/screens/first-weigh.js:852` | `escapeHtml()` used for operator-typed values (`js/utils.js:118`), tested (`tests/self_check.js:50-58`) | Materials/plates usually safe; keep escaping consistent in any new rows |
| Committed browser capture logs may contain data | A09 Logging Failures | `.playwright-mcp/console-*.log` (1.7 MB), currently untracked (`git status`) | None | Keep untracked / add to `.gitignore` before committing |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Telemetry writes to DOM every frame (~15 fps) | `js/scale-simulator.js:12,24,70-80`; `js/telemetry.js:30-71` | Fine locally | Cabin/WebView2 CPUs may stutter; PRD asks for ~4–5 fps DOM throttle (`draft-prd.md:142,369`) | Decouple/throttle DOM updates from the reader |
| Redundant preview recalculation per action | `ponytail-audit.md:88-93` | Imperceptible today | Grows with screen complexity | `requestAnimationFrame` coalescing |
| Two page-wide `document` click/keydown listeners for dropdowns | `js/screens/first-weigh.js:1329`; `ponytail-audit.md:45-51` | Two checks per click for app lifetime | Minor | Register only while a dropdown is open (partly addressed) |
| HUD async mount race | `js/hud.js:20` | Blank HUD on slow load | Worse on throttled hardware | Await or preload template |

### 5) Fragile/High-Churn Areas

Git churn, last 90 days (`git log --since="90 days ago" --name-only`).

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `index.html` | Entry: asset list, version tag, fonts | 17 commits | Change versions/scripts in unison with `js/html-loader.js:9` |
| `js/state.js` | Central mutable state + ticket-ID counter | 9 commits | Additive changes; keep peek/consume contract (`tests/self_check.js:60-73`) |
| `js/screens/second-weigh.js` | Large state machine (A–E states) | 9 commits | Changing preview states needs screenshots + manual re-verify |
| `js/keyboard.js` | Global hotkeys layer over screens/modals | 9 commits | Test each modal/screen interaction after edits |
| `js/screens/first-weigh.js` | Largest module; multi-concern | 8 commits | Avoid bundling unrelated edits (`future-plan.md:21`) |
| `tests/self_check.js` | String assertions + shared state | 8 commits | Update assertions alongside copy changes |
| `js/app.js`, `css/styles.css`, `prototype/README.md` | **Referenced in churn but no longer exist** (split/deleted) | 14, 12, 8 commits | Confirm their replacements (`js/main.js`, per-screen CSS) before reviving patterns |

### 6) `[ASK USER]` Questions

1. `[ASK USER]` Is this browser prototype intended to ship as the literal UI inside the C# WebView2 shell (as `draft-prd.md:355-365` says), or is it a throwaway design reference?
2. `[ASK USER]` Should the **simulator default-on** behavior be gated behind `devMode` now, before any real station is used? (`js/scale-simulator.js:17`)
3. `[ASK USER]` Should the PINs be left as-is for the prototype, or is a client-side improvement wanted ahead of the C#-host auth?
4. `[ASK USER]` Which document is authoritative for the repo's intent going forward: root `draft-prd.md` or the prototype's own docs (`prototype/README.md` was deleted)?
5. `[ASK USER]` Is failing `npm run format:check` acceptable (format-on-demand) or should the repo be re-formatted once and enforced?
6. `[ASK USER]` Is a CI pipeline (test + lint) in scope, or is this repo intentionally pre-CI?
7. `[ASK USER]` Should the durable browser-capture artifacts (`.playwright-mcp/`, `screenshots/`) be committed, ignored, or removed?

### 7) Evidence

- Git churn: `git log --since="90 days ago" --name-only -- prototype` (see §5 counts)
- `js/screens/first-weigh.js`, `js/state.js`, `js/pin-auth.js`, `js/scale-simulator.js`, `js/hud.js`
- `tests/self_check.js`
- `ponytail-audit.md`, `future-plan.md`
- `docs/codebase/.codebase-scan.txt` (CI/CD, SECURITY, PERFORMANCE sections)
- Terminal: `npm test` (pass), `npm run lint` (pass), `npm run format:check` (exit 1), `git status`
