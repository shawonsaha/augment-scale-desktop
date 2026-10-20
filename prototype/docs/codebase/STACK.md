# Technology Stack

> Scope: the `scale/prototype/` application (the Phase-0 UI prototype). The wider repo
> (`draft-prd.md`) targets a C#/.NET WPF + WebView2 desktop app and a Next.js admin portal,
> but none of that is implemented here. See ARCHITECTURE.md for the divergence.

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | JavaScript (vanilla ES modules), HTML, CSS | `js/main.js:1`, `index.html:38`, `css/tokens.css` |
| Runtime + version | Browser (Chromium/Edge, incl. WebView2 target). Node `v22.22.2` used only to run the self-check test; no `.nvmrc`/`engines` pin | `node --version`; `package.json:7`; `js/bridge.js:2` |
| Package manager | npm (`package-lock.json`, lockfileVersion 3) | `package-lock.json:191`, `package-lock.json:3` |
| Module/build system | Native ES modules (`"type": "module"`); **no bundler, no build step**. Scripts ship as-is | `package.json:5`, `package.json:6-12`, `index.html:38` |
| Static server | `python3 -m http.server 8080` | `package.json:11` |

### 2) Production Frameworks and Dependencies

There are **no production dependencies**. `dependencies` is absent from `package.json`;
the app uses only browser platform APIs (DOM, `fetch`, Web Audio, `localStorage`, `window.print`).
Third-party web assets are loaded from a CDN at runtime:

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| (none) | — | No `dependencies` block exists | `package.json:22-27` |
| Google Fonts — IBM Plex Sans + JetBrains Mono | `wght@400;500;600;700` / `500;600;700;800` | UI typefaces, loaded via `<link>` from fonts.googleapis.com | `index.html:12-17` |
| C# WebView2 host (out of scope here) | — | Consumes `window.ScaleApp` JSON bridge; not present in this repo | `js/bridge.js:2-31` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| ESLint `^10.12.0` (+ `@eslint/js` `^10.0.1`, `globals` `^17.13.0`) | LINT (flat config) | `package.json:23-25`, `eslint.config.js` |
| Prettier `^3.9.10` | FORMAT | `package.json:26`, `.prettierrc` |
| Node `node:assert` + `node:fs` | TEST (no test framework) | `tests/self_check.js:13-16` |
| Python 3 `http.server` | DEV SERVE | `package.json:11` |

### 4) Key Commands

```bash
npm install              # no runtime deps; installs the dev toolchain
npm run serve            # python3 -m http.server 8080  (no build step exists)
npm test                 # node tests/self_check.js
npm run lint             # eslint .
npm run format           # prettier --write .
npm run format:check     # prettier --check .   (currently exits 1 — see CONCERNS.md)
```

### 5) Environment and Config

- Config sources: `package.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`.
- Required env vars: none. **No `.env.example`/`.env.template` exists** and no source file reads
  `process.env`. Runtime configuration is stored in browser `localStorage` under keys
  `weighbridge-dev-mode`, `weighbridge-sim-active`, `weighbridge-serial-port`,
  `weighbridge-theme`, and `weighbridge_op_lock_<id>` (`js/state.js:238-246`,
  `js/settings.js:137-139`, `js/theme.js:25`, `js/pin-auth.js:12`).
- Deployment/runtime constraints: served as static files over HTTP (partials are `fetch`ed,
  so `file://` will not work); default hard-coded serial port `COM1`; auto asset-version tag
  `polish2` must be bumped by hand on deploy (`js/html-loader.js:9`, `index.html:20-29`).

### 6) Evidence

- `package.json`
- `package-lock.json`
- `eslint.config.js`, `.prettierrc`, `.prettierignore`
- `index.html`
- `node --version` output (v22.22.2)
