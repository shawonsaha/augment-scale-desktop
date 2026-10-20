# Codebase Structure

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `index.html` | Sole HTML entry point. Loads 10 CSS files + `js/main.js` (ES module), each tagged `?v=polish2`. Contains only `#app`; screens are injected at runtime | `index.html:20-38` |
| `partials/` | HTML fragments fetched and injected into `#app` by `js/html-loader.js` (8 files: telemetry bar, 4 screens, modals, simulator dock, HUD) | `js/html-loader.js:11-19`, `partials/` |
| `js/` | All application logic (24 ES modules) | `js/` |
| `js/screens/` | The four screen modules: `login.js`, `dashboard.js`, `first-weigh.js`, `second-weigh.js` | `js/screens/` |
| `css/` | 10 stylesheets: `tokens` → `base` → `layout` → per-screen → `responsive`, `print` | `index.html:20-29`, `css/` |
| `avatars/` | 5 SVG operator avatars referenced from `OPERATORS` | `js/state.js:14`; `avatars/frame-*.svg` |
| `tests/` | Single Node self-check suite | `tests/self_check.js` |
| `screenshots/` | PNG evidence captures + stub README | `screenshots/README.md` |
| `docs/codebase/` | This documentation set (and the raw scan output) | `docs/codebase/.codebase-scan.txt` |
| `.agents/`, `.gemini/` | Agent-skill definitions (tooling, not app code) | `.agents/skills/`, `skills-lock.json` |
| `.playwright-mcp/` | Committed Playwright console/YAML capture logs | `.playwright-mcp/` |
| `ponytail-audit.md`, `future-plan.md` | Prior audit results and the deferred-work backlog | `ponytail-audit.md`, `future-plan.md` |

### 2) Entry Points

- Main runtime entry: `js/main.js` (loaded by `index.html:38`). `bootstrap()` awaits
  `loadPartials()`, then calls each module's `init*` function (`js/main.js:20-38`).
- Secondary entry points: `tests/self_check.js` (Node); `window.ScaleApp` object exposed for
  the external C# WebView2 host (`js/bridge.js:10-31`).
- How entry is selected: no router config/`main` field — the static `index.html` script tag is
  the only entry. In-app navigation is `showScreen(id)` toggling `.active`
  (`js/router.js:7-51`).

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `js/state.js` | The single mutable `state` object, `OPERATORS`, `REGISTERED_TRUCKS`, `pendingTickets`, ticket-ID helpers | No DOM access, no event listeners |
| `js/utils.js` | Pure functions (date formatting, `escapeHtml`, `calcNet`) | No state mutation, no DOM (stated at `js/utils.js:2-4`) |
| `js/telemetry.js` | Fan-out of scale frames to HUD renderers and screen previews | No business/ticket logic |
| `js/scale-simulator.js` | XK3190-D10 frame emulation + pub/sub | Must not run in production (marked `shortcut:` `js/scale-simulator.js:17-18`) |
| `js/screens/*.js` | Per-screen DOM wiring, capture state machines, commit flow | Shared helpers should live in `js/` root (some duplication exists — see CONCERNS.md) |
| `js/print.js`, `js/router.js`, `js/toast.js`, `js/audio.js`, `js/theme.js`, `js/settings.js`, `js/keyboard.js`, `js/sync.js` | Cross-screen services/UI chrome | Should not own screen-specific state machines |
| `partials/*.html` | Screen markup templates | No inline `<script>` logic |

### 4) Naming and Organization Rules

- File naming: **kebab-case** (`html-loader.js`, `first-weigh.js`, `scale-simulator.js`,
  `confirm-dialog.js`). Screen files are `<screen>.js` under `js/screens/`.
- Directory organization: **by layer/concern, not by feature** — `js/screens/` (views),
  `js/` root (services, state, utils), `css/` (one file per screen + tokens/layout).
- Import conventions: relative ES imports with explicit `.js` extension
  (`import { state } from './state.js'`, `../state.js`). **No path aliases / `tsconfig`**
  exist; `@/`-style imports are not used.
- Partials are referenced as plain strings in one array (`js/html-loader.js:11-19`); the HUD
  partial is fetched separately by `js/hud.js:14` and is *not* in that array.

### 5) Evidence

- `index.html`, `js/main.js`, `js/html-loader.js`, `js/router.js`
- `js/state.js`
- `docs/codebase/.codebase-scan.txt` (DIRECTORY TREE section)
