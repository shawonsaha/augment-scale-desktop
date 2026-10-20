# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: **none** — a hand-rolled Node script using `node:assert`
  (`tests/self_check.js:13`). There is no Jest/Vitest/Mocha/Playwright config in the repo.
- Assertion/mocking tools: `node:assert` (`strictEqual`, `notStrictEqual`, `ok`), `node:fs`
  for reading partials, and a manual `createMockStorage()` fake for `localStorage`.
- Commands:

```bash
npm test                 # node tests/self_check.js  -> "✔ All scale prototype self-checks passed."
# run a subset: edit/comment sections — there is no filter flag, no watch mode
npm run lint             # eslint .   (passes)
npm run format:check     # prettier --check .   (currently exits 1)
# no coverage command exists
```

Verified locally: `npm test` passes; `npm run lint` exits 0.

### 2) Test Layout

- Test file placement pattern: a single **`tests/` folder** at the project root
  (`tests/self_check.js`). Tests are not co-located with source and are not split per module.
- Naming convention: only `self_check.js` exists; no `*.test.js` / `*.spec.js` pattern.
- Setup files: none. The script imports production modules directly
  (`import { ... } from '../js/state.js'`, `tests/self_check.js:1-12`) and asserts as it runs,
  printing one success line at the end (`tests/self_check.js:263`).

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Partial | Pure helpers: `formatDateTime12H`, `formatShortDateWithSeconds`, `calcNet`, `escapeHtml`, ticket-ID peek/consume, PIN/lockout logic | `tests/self_check.js:21-142` |
| Integration | No | Capture → commit → `pendingTickets`; print deferred-commit | Explicitly missing (`ponytail-audit.md:69-74`, `future-plan.md:25-35`) |
| E2E | No | Login → first weigh → second weigh flows | No browser runner configured; manual screenshots only (`screenshots/README.md`) |

Markup/structure assertions are also present: the suite greps `partials/*.html` and
`js/screens/second-weigh.js` for required/forbidden strings
(`tests/self_check.js:144-261`).

### 4) Mocking and Isolation Strategy

- Main mocking approach: **manual fakes passed as parameters** — e.g. `pin-auth.js` functions
  accept a `storage` argument so tests inject an in-memory `Map` fake
  (`js/pin-auth.js:47-59`, `tests/self_check.js:95-105`).
- Isolation guarantees: none automated. The suite mutates real module state
  (`pendingTickets`, `deletedTickets`, the ticket-ID counter) in-process and never resets it;
  correctness depends on execution order within the single script
  (`tests/self_check.js:60-73,155-167`).
- Common failure mode in tests: no assertion framework/timeout, so a thrown assertion stops the
  whole run at the first failure with a stack trace; there is no per-test reporting.

### 5) Coverage and Quality Signals

- Coverage tool + threshold: **none** (`docs/codebase/.codebase-scan.txt` PERFORMANCE & TESTING:
  "No performance testing configs detected").
- Current reported coverage: `[TODO]` — not measured.
- Known gaps/flaky areas:
  - No test for the capture→commit flow, the most important path
    (`ponytail-audit.md:69-74`).
  - No DOM/telemetry tests; `renderScaleData` and preview updaters are untested
    (`js/telemetry.js:30-71`).
  - Structural assertions are brittle: they assert exact strings in partials
    (`tests/self_check.js:195-229`), so a copy tweak breaks tests.
  - No CI runs the suite (`docs/codebase/.codebase-scan.txt` CI/CD: none detected).

### 6) Evidence

- `tests/self_check.js`
- `package.json:7` (`"test": "node tests/self_check.js"`)
- `js/pin-auth.js` (injectable storage seam)
- `docs/codebase/.codebase-scan.txt` (CI/CD, PERFORMANCE & TESTING sections)
- `npm test` / `npm run lint` terminal output
