# Concerns and Risks

## Core Sections (Required)

### 1) Top Risks

| Rank | Risk | Why it matters | Evidence |
|------|------|----------------|----------|
| 1 (High) | PIN authentication has no server-side throttling | The 4-digit PIN has only 10,000 combinations, and the only lockout is a `localStorage` counter (5 attempts / 60 s) that can be cleared or bypassed. `authenticatePin` accepts unlimited attempts directly through the bridge. An operator with local access can brute-force a supervisor PIN and then use the 15-minute admin token. | `WebUI/js/pin-auth.js:5-11`, `:45-112`; `BridgeService.cs:122-126`; `ConfigService.cs:93-98` |
| 2 (High) | Every production install starts with five operators on PIN `1234` | `Resources/setup.json` seeds all five operators with `1234`; provisioning hashes them and removes the plaintext PIN, but there is no forced change, no first-run setup wizard, and no warning. A fresh deployment is effectively unlocked until someone changes every PIN. | `Resources/setup.json:28-84`, `ConfigService.cs:229-257`, `DatabaseService.cs:280-302` |
| 3 (High) | Vehicle deletion is a physical delete | The approved design says “soft delete only” and “plate is lifetime-unique.” `DeleteVehicle` deletes the `vehicles` row and nulls `weigh_tickets.vehicle_id`, so the plate can be registered again and the vehicle master record is lost. Audit/outbox retain a JSON snapshot, but the relational history no longer points at a vehicle. | `DatabaseService.cs:870-919`; `..\Database_Design.md:42-45`, `:81`, `:84`, `:328` |
| 4 (Medium-High) | Destructive commands are not re-authorized by C# | `voidTicket`, `deleteTicket`, `registerVehicle`, `archiveVehicle`, `restoreVehicle`, and `deleteVehicle` have no role or supervisor check in `BridgeService`; only profile mutations require an admin token. The bridge does not know which operator is signed in, and DevTools is enabled, so a local user can call these commands directly. | `BridgeService.cs:234-264`; `MainWindow.xaml.cs:82`, `:192-198`; `WebUI/js/screens/history.js:967-995` |
| 5 (Medium-High) | Cloud sync is not implemented | The outbox is written but never consumed; `GetSyncStatus` always reports healthy and only counts pending rows. If central reporting is expected for the onsite test, it will not happen from this client. The plan describes this as Phase 2 preparation, so confirm the deployment expectation. | `DatabaseService.cs:1630-1652`, `:2176-2200`; `WebUI/js/sync.js:92-111`; `..\Implimentation_Plan.md:10`, `:717` |
| 6 (Medium) | Loss of `secrets.dat` makes the database unreadable | The database key exists only inside a DPAPI file. The app deliberately refuses to create a new key when the DB exists, and there is no in-app backup, export, or key rotation. A disk cleanup, profile rebuild, or copied DB without its secrets file causes an outage. | `ConfigService.cs:203-218`, `:260-267`; `DatabaseTests.MissingSecrets_WithExistingDatabase_RefusesToCreateNewKey` |
| 7 (Medium) | DevTools is enabled in all builds | `AreDevToolsEnabled = true` and `Ctrl+Shift+D` open DevTools. This is useful for development, but it exposes the page runtime and bridge API on production workstations. | `MainWindow.xaml.cs:82`, `:183-198` |
| 8 (Medium) | Large, coupled implementation files | `DatabaseService.cs` is 2,280 lines and owns unrelated domains; `first-weigh.js` is 1,680 lines and `history.js` is 1,329. Changes can collide, and the blast radius of a regression is wide. | File line counts; `Services/DatabaseService.cs`, `WebUI/js/screens/first-weigh.js`, `WebUI/js/screens/history.js` |
| 9 (Medium) | No CI, lint, or UI tests | The only automated gate is a manually run 77-test backend suite. WebView2 startup, bridge routing, JavaScript state/rendering, print flows, and real serial hardware are untested. Regressions in the operator workflow can reach onsite testing. | `AugmentScale.Tests/`, repository has no CI/lint configuration |
| 10 (Low) | Dead or stale code/comments | `showSystemPrintDialog` is implemented but has no WebUI caller; `pin-auth.js` still says “PINs live in client code,” which is only true in browser demo mode; `SetPin` accepts 4–8 digits while every UI path enforces 4. | `BridgeService.cs:189-194`, `pin-auth.js:5`, `ConfigService.cs:103-108`, `profiles.js:300-304` |

Suggested actions, in priority order:

1. Move failed-attempt tracking and lockout into `ConfigService`/`DatabaseService`, keyed by profile and persisted in SQLCipher; add a deliberate delay or temporary lock after repeated failures.
2. Force a PIN change on first login for seeded accounts, or ship the approved first-run setup flow; block weighing until every active operator has a non-default PIN.
3. Replace `DeleteVehicle` with the approved soft delete (`deleted_at`/`deleted_by`/`deleted_reason`) and keep the unique plate index; preserve existing hard-delete recovery via migration.
4. Require an authenticated operator/supervisor context for destructive bridge commands, not just for profile administration.
5. Either implement the outbox sync worker or explicitly remove/defer the cloud-sync expectation from the onsite scope and document local-only reporting.
6. Add a documented backup procedure that copies `augment-scale.db` and `secrets.dat` together, and test restore before onsite deployment.

### 2) Technical Debt

| Debt item | Impact | Evidence |
|-----------|--------|----------|
| `DatabaseService` is a 2,280-line god class | Schema migration, provisioning, profiles, vehicles, tickets, reports, sync status, and health all change together; tests and reviews are harder | `DatabaseService.cs` |
| One new SQLCipher connection per command | No pooling or unit-of-work reuse; connection/key-derivation cost is paid per database-backed UI action and is not benchmarked | `DatabaseService.cs:126-140`, `BridgeService.cs:101` |
| Only one schema version | `V001_InitialSchema.sql` plus a `version < 1` branch; adding V002 requires new runner code, with no downgrade/rollback path | `DatabaseService.cs:143-174` |
| No JavaScript build, type system, or bundler | Bridge payload shapes are checked only at runtime; `state.js`, screens, and C# DTOs must be kept in sync manually | `WebUI/index.html:55`, `WebUI/js/state.js`, `BridgeService.cs` |
| No dependency lock file | Restores can resolve different transitive versions over time `[TODO]` decide whether to enable `RestorePackagesWithLockFile` | `.csproj` files; no `packages.lock.json` |
| Manual asset cache busting | Repeated `?v=prodN` strings must be updated by hand when CSS/JS changes | `WebUI/index.html:14-50` |
| Temporary test seam and `InternalsVisibleTo` | Production assembly exposes internals to tests; the source itself says to remove the seam when hardware tests exist | `ScaleReaderService.cs:136-141`, `AugmentScale.csproj:31-32` |
| Unused bridge command | `showSystemPrintDialog` adds a code path that no UI invokes; printing actually uses `window.print()` | `BridgeService.cs:189-194`, `print.js:384` |
| Stale explanatory comments | The PIN shortcut comment describes client-side PINs, but production authentication goes through C#; this can mislead future maintainers | `pin-auth.js:5-8`, `login.js:346-359` |
| PIN policy split | `ConfigService.SetPin` supports 4–8 digits, while login, profile creation, PIN change, and `--reset-pin` enforce exactly 4 | `ConfigService.cs:103-108`, `profiles.js:300-304`, `App.xaml.cs:133`, `:166` |

Suggested fixes: extract ticket/report/vehicle persistence out of `DatabaseService` into focused services; introduce a single connection/transaction scope per command; add a numbered migration runner; add JSDoc typedefs or TypeScript checking at the bridge boundary; remove the test seam once hardware tests exist; delete `showSystemPrintDialog` or wire it to the print flow; and standardize the PIN length.

### 3) Security Concerns

- Authentication and authorization:
  - Client-side lockout only; no server-side failed-attempt state (`pin-auth.js:45-112`). OWASP A07.
  - 4-digit PIN with no forced initial change and all seeded operators sharing `1234` (`Resources/setup.json`). OWASP A07/A05.
  - Only profile administration is re-authorized in C#. Ticket void/delete and vehicle archive/delete/restore rely on the UI for role enforcement (`BridgeService.cs:234-264`). OWASP A01.
  - `--reset-pin` changes any operator PIN with no old-PIN challenge; it requires access to the Windows user session and the data directory (`App.xaml.cs:108-195`). OWASP A01/A07.
- Secrets:
  - DPAPI is scoped to the current Windows user; any process running as that user can unprotect `secrets.dat`, including `tools/Get-DbKey.ps1` (`ConfigService.cs:17`, `tools/Get-DbKey.ps1`). OWASP A02/A05.
  - No rotation, backup, or recovery workflow; losing DPAPI access is unrecoverable for the DB (`ConfigService.cs:203-218`). OWASP A02.
- Integrity:
  - `audit_events` is append-only by application convention, not by database permission/trigger. The local user can open the SQLCipher DB with the extracted key and modify rows. OWASP A09.
  - History-report integrity uses an unkeyed SHA-256 over canonical JSON. It detects accidental or partial tampering but not a local attacker who can rewrite both the snapshot and its hash (`DatabaseService.cs:1129-1285`). OWASP A08.
- Error exposure:
  - `BridgeService` returns `ex.Message` to the UI. Messages can include file paths or SQLite details (`BridgeService.cs:96-108`). OWASP A05.
- Transport/render surface:
  - WebView2 permission requests are denied and new windows are blocked, which limits browser attack surface (`MainWindow.xaml.cs:92-93`), but DevTools remains enabled (`:82`). OWASP A05.

### 4) Performance and Scaling

| Concern | Why it matters | Evidence |
|---------|----------------|----------|
| Boot payload is large | `getBootState` returns all operators/vehicles, all pending tickets, and up to 1,000 history tickets in one response; large sites will increase startup time and memory | `DatabaseService.cs:984-1001`, `:954-980` |
| History is loaded into client memory | Screens filter/sort locally; pagination is display-only, so growth is bounded by what the bridge returns, not by SQL paging | `WebUI/js/screens/history.js`, `WebUI/js/state.js` |
| Every bridge command opens a new encrypted connection | SQLCipher connection setup and key handling repeat per command; no benchmark exists for high-frequency weighing | `DatabaseService.cs:126-140` |
| Single-workstation design | The process mutex prevents multiple instances on one session, and there is no multi-workstation lease or server coordination beyond unused `offline_leases` rows | `App.xaml.cs:21-31`, `Data/Schema/V001_InitialSchema.sql` |
| Synchronous reader thread | Read timeouts are 500 ms and a stalled stream blocks reconnection until the read/connect path returns; acceptable for one scale, not a high-throughput aggregator | `ScaleReaderService.cs:65-98`, `:112-113` |
| Unbounded outbox | No sync worker or retention policy exists, so `outbox_events` grows with every mutation for the life of the workstation | `DatabaseService.cs:2176-2200`, `GetSyncStatus` count |

Suggested improvements: page history in SQL and return only the visible slice; benchmark and then pool/reuse connections if SQLCipher setup is material; define an outbox retention/compaction policy; and document the one-workstation deployment limit or add `offline_leases` coordination if multi-workstation is required.

### 5) Fragile/High-Churn Areas

- High-churn files in the last 90 days: `WebUI/index.html` (11 commits), `WebUI/js/state.js` (10), `WebUI/js/html-loader.js` (8), `AugmentScale.Tests/DatabaseTests.cs` (8), `USER_MANUAL.md` (8), `Services/DatabaseService.cs` (7), `BridgeService.cs` (6), `WebUI/js/screens/history.js` (6), `WebUI/js/main.js` (6).
- Largest files: `DatabaseService.cs` 2,280 lines, `first-weigh.js` 1,680, `history.js` 1,329, `state.js` 889, `DatabaseTests.cs` 841, `history-report.js` 793, `second-weigh.js` 714, `dashboard.js` 642, `trucks.js` 620, `print.js` 598.
- Cross-file coupling that breaks easily:
  - Adding/removing a partial requires updating `html-loader.js` and the CSS links in `index.html`.
  - Adding a bridge command requires touching `BridgeService` dispatch, `Models/Commands`, `runtime.js`/`state.js`, and the calling screen, with no compile-time check across the boundary.
  - Changing a DTO property can silently break the WebUI because serialization is camelCase by convention and JS has no types.
  - Updating JS/CSS requires manually bumping `?v=` strings to avoid stale WebView2 caches.
- Test fragility: the suite depends on temp-directory filesystem behavior and SQLCipher native assets; `SimulatorProtocolTests.TcpTransport_PublishesDecodedReadings` depends on real loopback timing.

Safe change strategy: treat `state.js` and the bridge DTOs as a contract, add/adjust the C# DTO and JS consumer together, run the full xUnit suite plus a manual WebView2 smoke test on every screen touched, and bump the matching `?v=` asset versions. For `DatabaseService`, add tests around the affected domain before extracting code, and avoid changing unrelated sections in the same commit.

### 6) Investigation Notes

- Code markers: no `TODO`, `FIXME`, or `HACK` comments were found in source. Three `shortcut:` markers acknowledge temporary tradeoffs (`AugmentScale.csproj:31`, `ScaleReaderService.cs:136`, `pin-auth.js:5`).
- Hardcoded/config values: the organization, site, weighbridge, five seeded vehicles, all operator PINs (`1234`), COM1/9600/8N1, stability window, and 5 kg division are in `Resources/setup.json` and default models. Scale port/timeouts are read from config at runtime, but the shipped defaults assume the prototype hardware.
- Sequential-call check: `GetBootState` builds operators, vehicles, pending tickets, history, next number, and sync status on one connection (`DatabaseService.cs:984-1001`); no N+1 external-call pattern exists. The scaling issue is volume loaded into memory, not a fan-out of network calls.
- Large mixed-responsibility files over 500 lines: `DatabaseService.cs`, six WebUI screen/state/report scripts (`first-weigh.js`, `history.js`, `state.js`, `history-report.js`, `second-weigh.js`, `dashboard.js`), and several screen CSS files. The C# service is the clearest mixed-responsibility case.

### 7) [ASK USER] Questions

1. Is cloud/Supabase sync required before this onsite test, or is local-only operation acceptable for this phase? The plan calls it Phase 2 preparation, and no sync worker exists.
2. Should the installer run the approved empty-database setup wizard, or is seeding five operators/vehicles with PIN `1234` intentional for the onsite test?
3. Must every seeded operator change PIN `1234` before weighing, and should the policy be exactly 4 digits or 4–8 digits?
4. Should void/delete ticket and archive/delete vehicle require a supervisor PIN or role check in C#, rather than relying on the UI?
5. Is physical vehicle deletion approved despite the design’s soft-delete-only and lifetime-unique-plate rules? If not, should `deleteVehicle` be removed or converted to a soft delete?
6. Should DevTools and the `Ctrl+Shift+D` shortcut be disabled for production builds?
7. What is the required backup/restore procedure for `secrets.dat` and `augment-scale.db`, and should the app provide an in-app backup/export command?
8. Is `--reset-pin` an acceptable support workflow, and who is allowed to use it?
9. Should CI, linting, and JavaScript/WebView2 tests be added as a release gate before onsite use?
10. Is the target deployment framework-dependent (requires .NET 10 Desktop Runtime + WebView2 Evergreen) or self-contained?

### 8) Evidence

- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Resources/setup.json`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/App.xaml.cs`
- `AugmentScale/WebUI/js/pin-auth.js`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/WebUI/js/screens/history.js`
- `AugmentScale/WebUI/js/screens/profiles.js`
- `AugmentScale.Tests/DatabaseTests.cs`
- `..\Implimentation_Plan.md`
- `..\Database_Design.md`
