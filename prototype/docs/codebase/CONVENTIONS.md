# Coding Conventions

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files | kebab-case; screen modules named `<screen>.js` | `html-loader.js`, `first-weigh.js`, `confirm-dialog.js` | `js/`, `js/screens/` |
| Functions/methods | camelCase, verb-led; exported screen helpers prefixed `init`/`open`/`update`/`do`/`set`/`handle` | `initFirstWeighScreen`, `openFirstWeigh`, `updateFirstWeighPreview`, `doCaptureFirstWeigh`, `handleFirstWeighBack` | `js/screens/first-weigh.js:50,380,675,1008,1046` |
| Module-private functions | No prefix; simply not exported | `renderTruckSuggestions`, `applyTruckSelection`, `evaluateTruckState` | `js/screens/first-weigh.js:838,887,1082` |
| State "private"/dialog flags | leading underscore | `_blockedByOpenTicket`, `_deleteDialogOpen`, `_overrideDialogOpen` | `js/state.js:254,283-284` |
| Constants / env-like keys | UPPER_SNAKE_CASE | `PIN_LENGTH`, `MAX_ATTEMPTS`, `ASSET_VERSION`, `PARTIALS`, `PREDEFINED_MATERIALS`, `LOCK_STORAGE_PREFIX` | `js/pin-auth.js:9-12`, `js/html-loader.js:9,11`, `js/screens/first-weigh.js:33` |
| DOM ids / CSS | kebab-case, screen-prefixed (`fw-`, `sw-`, `doc-`, `sim-`) | `fw-truck-input`, `sw-btn-capture`, `doc-truck-no` | `partials/screen-first-weigh.html`, `js/screens/second-weigh.js:240-325` |
| Data records | camelCase keys; plate normalization is `.trim().toUpperCase()` | `truckNo`, `firstWeightType`, `REGISTERED_TRUCKS` | `js/state.js:106-120`, `js/screens/first-weigh.js:296` |

### 2) Formatting and Linting

- Formatter: **Prettier** — `.prettierrc`: `semi: true`, `singleQuote: true`,
  `trailingComma: "es5"`, `tabWidth: 2`, `printWidth: 100`.
- Linter: **ESLint flat config** (`eslint.config.js`): `@eslint/js` recommended for `js/**`,
  browser globals, `no-unused-vars` as **warn** with `^_` ignore pattern, `no-console: off`,
  `no-empty` error allowing empty catch. `tests/**` uses Node globals.
- Ignore lists: ESLint ignores `node_modules`, `docs`, `avatars`; Prettier ignores
  `node_modules`, `package-lock.json`, `avatars`, `docs`.
- Run commands: `npm run lint`, `npm run format`, `npm run format:check`.
- Note: `npm run lint` passes clean; `npm run format:check` currently **exits 1** across 63
  files (see CONCERNS.md).

### 3) Import and Module Conventions

- All imports are **relative with explicit `.js` extension**; no path aliases
  (`import { state } from '../state.js'`, `js/screens/first-weigh.js:14-31`).
- Imports are grouped: external/package first (rare), then local modules in rough
  dependency order; named imports only (default imports only for `hapticAudio` and
  `scaleSimulator`).
- No barrel `index.js` files — consumers import the concrete module.
- Side-effect import used once for the bridge: `import './bridge.js'` (`js/main.js:18`).
- Files start with a `/** ... */` block describing the module's role.

### 4) Error and Logging Conventions

- Error strategy: no thrown errors across module boundaries for user flows. Failures surface as
  toasts via `showToast(message, 'error'|'warning'|'info'|'success')`
  (`js/toast.js:6`, used e.g. `js/screens/second-weigh.js:173-181`).
- Guarded DOM access is the norm (`if (el) ...`) instead of try/catch, since partials may be
  absent (`js/router.js:22-46`).
- `try/catch` is used around optional-API calls: `localStorage` helpers
  (`js/pin-auth.js:52-58,70-75`), `window.print()` (`js/print.js:228-233`), subscriber callbacks
  (`js/scale-simulator.js:89-95`).
- Logging: raw `console.error`/`console.warn` only; **no logger library and no structured
  format** (`js/scale-simulator.js:93`, `js/pin-auth.js:73`). `debugger` is never used.
- Deferred-work marker: the literal prefix **`shortcut:`** in comments flags known compromise
  (used by the ponytail tooling) — `js/pin-auth.js:5`, `js/scale-simulator.js:17`.
- Security convention: any operator-typed value interpolated into HTML must pass through
  `escapeHtml()` (`js/utils.js:118-124`; used in `js/screens/dashboard.js:334-337`).
  Escaping is covered by the test suite (`tests/self_check.js:50-58`).

### 5) Testing Conventions

- Test file naming/location: `tests/self_check.js` — a single sequential script, not
  co-located and not per-module. No `*.test.js` convention exists.
- Mocking strategy: hand-rolled fakes only; e.g. `createMockStorage()` returning an in-memory
  `Map` for `localStorage` (`tests/self_check.js:95-105`). No mocking library.
- Assertions: `node:assert` (`strictEqual`, `notStrictEqual`, `ok`) plus `node:fs` reads to
  assert on partial markup (`tests/self_check.js:13-16,145-153`).
- Coverage expectation: none enforced — no coverage tool or threshold config
  (`docs/codebase/.codebase-scan.txt` PERFORMANCE & TESTING: "No ... configs detected").

### 6) Evidence

- `.prettierrc`, `.prettierignore`, `eslint.config.js`
- `package.json:6-12`
- `js/screens/first-weigh.js`, `js/screens/second-weigh.js`, `js/utils.js`, `js/pin-auth.js`
- `tests/self_check.js`
- `ponytail-audit.md:17` (shortcut-comment convention)
