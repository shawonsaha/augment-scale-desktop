# Codebase Concerns

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Rank | Severity | Concern | Evidence | Impact | Suggested action |
|------|----------|---------|----------|--------|------------------|
| 1 | High | PIN authentication has no server-side throttling | `WebUI/js/pin-auth.js:5-11`, `:45-112`; `BridgeService.cs:122-126`; `ConfigService.cs:93-98` | The 4-digit PIN has only 10,000 combinations, and the only lockout is a `localStorage` counter (5 attempts / 60 s) that can be cleared or bypassed. `authenticatePin` accepts unlimited attempts directly through the bridge. A local user can brute-force a supervisor PIN and then use the 15-minute admin token. | Move failed-attempt tracking and lockout into `ConfigService`/`DatabaseService`, keyed by profile and persisted in SQLCipher; add a deliberate delay or temporary lock after repeated failures. |
| 2 | High | Every production install starts with five operators on PIN `1234` | `Resources/setup.json:28-84`; `ConfigService.cs:229-257`; `Data/Provisioner.cs`; `USER_MANUAL.md:276` | Provisioning hashes the seed PINs and removes the plaintext, but there is no forced change, first-run setup wizard, or warning. A fresh deployment is effectively unlocked until someone changes every PIN. | Require a mandatory first-launch PIN change before allowing ticketing, or ship the approved first-run setup flow; block weighing until every active operator has a non-default PIN. |
| 3 | High | DPAPI secret loss is irrecoverable | `ConfigService.cs:17-42`, `:203-218`, `:260-267`; `OPEN_RAW_DB.md:170-177`; `DatabaseTests.MissingSecrets_WithExistingDatabase_RefusesToCreateNewKey` | If `secrets.dat` is deleted, corrupted, or accessed under a different Windows user profile, the encrypted database cannot be opened; all tickets and history are permanently lost. There is no in-app backup, export, key rotation, or recovery workflow. | Implement an automated paired backup of `augment-scale.db` and `secrets.dat`, include the `archives\` folder, and test restore before onsite deployment; evaluate off-machine key escrow and an in-app backup/export command. |
| 4 | Med-High | Vehicle deletion is a physical hard delete | `Data/Repositories/VehicleRepository.cs` (`DeleteVehicle`); `..\Database_Design.md:42-45`, `:81`, `:84`, `:328` | The approved design requires soft delete only and a lifetime-unique plate. `DeleteVehicle` deletes the `vehicles` row and nulls `weigh_tickets.vehicle_id`, so the plate can be registered again and the vehicle master record is lost. Audit/outbox retain a JSON snapshot, but relational history no longer points at a vehicle. | Replace physical deletion with a `deleted_at`/`deleted_by`/`deleted_reason` soft delete and keep the unique plate index; preserve existing hard-delete recovery via migration. |
| 5 | Med-High | Destructive commands are not re-authorized by C# | `BridgeService.cs:234-264`; `MainWindow.xaml.cs:82`, `:192-198`; `WebUI/js/screens/history.js:967-995` | `voidTicket`, `deleteTicket`, `registerVehicle`, `archiveVehicle`, `restoreVehicle`, and `deleteVehicle` have no role or supervisor check in `BridgeService`; only profile mutations require an admin token. The bridge does not know which operator is signed in, and DevTools is enabled, so a local user can call these commands directly. | Require an authenticated operator/supervisor context for destructive bridge commands, not just for profile administration. |
| 6 | Med-High | Cloud sync is not implemented | `Data/Services/SyncStatusService.cs`, `Data/DatabaseContext.cs` (`InsertOutbox`); `WebUI/js/sync.js:92-111`; `..\Implimentation_Plan.md:10`, `:717` | The outbox is written but never consumed; `GetSyncStatus` always reports healthy and only counts pending rows. If central reporting is expected for the onsite test, it will not happen from this client. The plan describes this as Phase 2 preparation. | Either implement the outbox sync worker or explicitly remove/defer the cloud-sync expectation from the onsite scope and document local-only reporting. |
| 7 | Medium | DevTools is enabled in all builds | `MainWindow.xaml.cs:82`, `:183-198` | `AreDevToolsEnabled = true` and a `Ctrl+Shift+D` shortcut expose the page runtime and bridge API on production workstations. | Disable DevTools and the shortcut for production builds, or gate them behind an explicit development flag. |
| 8 | Medium | Large WebUI screen files | File line counts; `WebUI/js/screens/first-weigh.js`, `WebUI/js/screens/history.js` | `first-weigh.js` is 1,487 lines and `history.js` is 1,184. Changes can collide, and the blast radius of a regression is wide. The persistence layer is now split into focused repositories/services under `AugmentScale/Data/`. | Split large screens; add tests around the affected domain before extracting code. |
| 9 | Medium | No CI, lint, or UI tests | `AugmentScale.Tests/`; repository has no CI/lint configuration | The only automated gate is a manually run 88-test backend suite. WebView2 startup, bridge routing, JavaScript state/rendering, print flows, archive PDF rendering, and real serial hardware are untested. Regressions in the operator workflow can reach onsite testing. | Add CI, linting, and JavaScript/WebView2 tests as a release gate before onsite use. |
| 10 | Low | Test suite duration bottleneck | `AugmentScale.Tests/DatabaseTests.cs:8-17`, `PdfArchiveTests.cs` | PBKDF2 hashing (100,000 rounds) runs per seeded operator in every `TempDatabase` instantiation, and archive tests create real encrypted databases, pushing the suite to roughly 34–70 seconds for 88 tests. | Allow a configurable PBKDF2 iteration count in test environments (e.g. 1,000 iterations for testing, 100,000 for production). |
| 11 | Low | Dead or stale code/comments | `BridgeService.cs:189-194`, `pin-auth.js:5` | `showSystemPrintDialog` is implemented but has no WebUI caller; `pin-auth.js` still says "PINs live in client code," which is only true in browser demo mode. | Delete or wire the unused print command and correct stale comments. |
| 12 | Low | Archive generation depends on the app being open | `Services/PdfArchiveService.cs`; `USER_MANUAL.md` archive section | If the workstation is off at 00:05, the previous day is not archived until the next launch. There is no Windows service, scheduled task, or off-machine copy. | Accept the on-launch catch-up model for Phase 1, or add a service/scheduled task if unattended archiving is required. |

Suggested actions, in priority order:

1. Move failed-attempt tracking and lockout into `ConfigService`/`DatabaseService`, keyed by profile and persisted in SQLCipher; add a deliberate delay or temporary lock after repeated failures.
2. Force a PIN change on first login for seeded accounts, or ship the approved first-run setup flow; block weighing until every active operator has a non-default PIN.
3. Replace `DeleteVehicle` with the approved soft delete (`deleted_at`/`deleted_by`/`deleted_reason`) and keep the unique plate index; preserve existing hard-delete recovery via migration.
4. Require an authenticated operator/supervisor context for destructive bridge commands, not just for profile administration.
5. Either implement the outbox sync worker or explicitly remove/defer the cloud-sync expectation from onsite scope and document local-only reporting.
6. Add a documented backup procedure that copies `augment-scale.db`, `secrets.dat`, and `archives\` together, and test restore before onsite deployment.

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Persistence split lacks repository-level tests | The 2,280-line `DatabaseService` was split into `Data/Repositories` and `Data/Services`, but all 26 database tests still drive the facade | `AugmentScale/Data/`, `AugmentScale.Tests/DatabaseTests.cs` | A regression inside one repository may be masked by facade-level tests, and the new files have no direct test coverage | Add focused tests for `TicketRepository`, `VehicleRepository`, `OperatorRepository`, and `HistoryReportService` as the split settles |
| One new SQLCipher connection per command | No pooling or unit-of-work reuse; connection setup and key handling are paid per database-backed UI action | `Data/DatabaseContext.cs` (`OpenConnection`), `BridgeService.cs:101` | Latency and key-derivation cost per command, with no benchmark for high-frequency weighing | Introduce a single connection/transaction scope per command and benchmark before adding pooling |
| Migration runner is explicit, not generic | `SchemaMigrator` has explicit V001 and V002 branches; there is no migration discovery, downgrade, or rollback path | `Data/SchemaMigrator.cs`, `Data/Schema/` | Future schema changes need ad-hoc code and have no safe rollback | Add a numbered migration runner with forward and rollback handling |
| Archive rendering is not covered by automated tests | `PdfArchiveTests` uses a fake `IPdfArchiveRenderer`; the real hidden WebView2 `PrintToPdfAsync` path is checked manually for page count/size, but visual layout is not inspected | `Services/WebViewPdfArchiveRenderer.cs`, `AugmentScale.Tests/PdfArchiveTests.cs` | A WebView2, CSS, or print-setting regression could produce missing or badly paginated PDFs without failing CI | Add a desktop integration test or a renderer smoke test that opens the generated PDF and checks page count/size |
| Archive PDFs are outside the encrypted database | PDFs are plain files under `archives\`; the documented backup now copies them alongside `augment-scale.db` and `secrets.dat`, but the PDFs themselves are not encrypted | `Services/PdfArchiveService.cs`, `Services/ConfigService.cs`, `start-dev-sim.ps1`, `USER_MANUAL.md` | A backup or restore that omits `archives\` loses delivered PDFs; a folder copy without ACLs exposes personal data | Keep `archives\` in backup/restore drills and restrict folder permissions |
| Dual-mode browser/desktop code in WebUI | The prototype needed to run standalone in standard browsers as well as inside WebView2 | `WebUI/js/runtime.js`, `state.js`, `bridge.js` | Dead code paths or accidental execution of mock/seed browser logic in production | Decouple production build assets or retire the browser-only mock fallback |
| In-memory UI state replication | Avoids full database roundtrips for table rendering in the prototype | `WebUI/js/state.js` | Potential desynchronization between client arrays and SQLite | Transition to paginated server-side queries via bridge commands |
| No JavaScript build, type system, or bundler | Browser code is plain ES modules and bridge payloads are checked only at runtime | `WebUI/index.html:55`, `WebUI/js/state.js`, `BridgeService.cs` | `state.js`, screens, and C# DTOs must be kept in sync manually; payload-shape regressions surface only at runtime | Add JSDoc typedefs or TypeScript checking at the bridge boundary |
| No dependency lock file | Versions are pinned per `.csproj`; no `packages.lock.json` or NuGet lock mode is enabled | `.csproj` files; no `packages.lock.json` | Restores can resolve different transitive versions over time | Decide whether to enable `RestorePackagesWithLockFile` `[TODO]` |
| Manual asset cache busting | Repeated `?v=prodN` strings must be updated by hand when CSS/JS changes | `WebUI/index.html:14-50` | Stale WebView2 caches after deployment | Automate cache-busting during build/publish |
| Temporary test seam and `InternalsVisibleTo` | Tests need access to `ScaleReaderService.ProcessStream`; the source says to remove the seam when hardware tests exist | `ScaleReaderService.cs:136-141`, `AugmentScale.csproj:31-32` | Production assembly exposes internals to tests | Remove the seam once hardware-in-the-loop tests exist |
| Unused bridge command | `showSystemPrintDialog` adds a code path that no UI invokes; printing actually uses `window.print()` | `BridgeService.cs:189-194`, `print.js:384` | Dead code and a misleading API surface | Delete `showSystemPrintDialog` or wire it into the print flow |
| Stale explanatory comments | The PIN shortcut comment describes client-side PINs, but production authentication goes through C# | `pin-auth.js:5-8`, `login.js:346-359` | Misleads future maintainers about the security model | Update the comments to distinguish browser demo mode from production |

### 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
|------|----------------|----------|--------------------|-----|
| Credential exposure via helper tool | A01:2021-Broken Access Control | `tools/Get-DbKey.ps1` | DPAPI restricts extraction to the current Windows user | Any local script or process running under the same user account can extract the raw SQLCipher passphrase |
| Lack of PIN rate limiting | A07:2021-Identification and Authentication Failures | `BridgeService.cs:122-126`, `ConfigService.cs:93-98`, `WebUI/js/pin-auth.js:45-112` | 4-digit PINs required for login; supervisor PIN required for admin actions; 5 attempts / 60 s client-side lockout | No server-side account lockout or exponential backoff; the `localStorage` counter can be cleared and bridge calls accept unlimited attempts |
| Default shared PIN / no forced change | A07:2021, A05:2021-Security Misconfiguration | `Resources/setup.json`, `ConfigService.cs:229-257` | Seed PINs are hashed into `secrets.dat` and plaintext is removed | All five seeded operators start with `1234`; no first-run setup wizard or mandatory change |
| Destructive commands not re-authorized | A01:2021-Broken Access Control | `BridgeService.cs:234-264`, `MainWindow.xaml.cs:82`, `:192-198`, `WebUI/js/screens/history.js:967-995` | Only profile administration requires the 15-minute admin token | Ticket void/delete and vehicle archive/delete/restore rely on UI role enforcement; the bridge does not know the signed-in operator |
| `--reset-pin` has no old-PIN challenge | A01:2021, A07:2021 | `App.xaml.cs:108-195` | Requires access to the Windows user session and data directory | Anyone with that local access can change any operator PIN |
| DPAPI user-bound secrets | A02:2021-Cryptographic Failures, A05:2021 | `ConfigService.cs:17`, `:185-267`, `tools/Get-DbKey.ps1` | DPAPI `CurrentUser` scope protects secrets at rest | Any process running as the same Windows user can unprotect `secrets.dat`; no rotation, backup, or recovery workflow |
| Audit trail is append-only by convention | A09:2021-Security Logging and Monitoring Failures | `AuditService.cs`, `Data/Schema/V001_InitialSchema.sql` | Application only inserts audit rows inside business transactions | No database permission or trigger prevents a local user with the extracted key from modifying rows |
| Report integrity uses an unkeyed hash | A08:2021-Software and Data Integrity Failures | `Data/Services/HistoryReportService.cs` | SHA-256 over canonical JSON detects accidental or partial tampering | A local attacker can rewrite both the snapshot and its hash; no keyed signature |
| Error message exposure | A05:2021-Security Misconfiguration | `BridgeService.cs:96-108` | Errors are caught so a command failure does not crash the host | Raw `ex.Message` reaches the UI and may include file paths or SQLite details |
| Missing input length constraints on freeform notes | A03:2021-Injection | `Data/Repositories/TicketRepository.cs` (`CreateTicket`, `CompleteTicket`), `V001_InitialSchema.sql:191` | Parameterized SQLite queries prevent SQL injection | Extremely long payload strings in `remarks` or `override_reason` could bloat database pages |
| DevTools enabled | A05:2021-Security Misconfiguration | `MainWindow.xaml.cs:82`, `:183-198` | Default context menus are disabled, permission requests are denied, and new windows are blocked | DevTools and `Ctrl+Shift+D` expose the page runtime and bridge API on production workstations |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| Boot payload is bounded by today | `Data/Services/BootStateService.cs`, `Data/Repositories/TicketRepository.cs` (`GetHistorySince`), `Data/Repositories/VehicleRepository.cs` (`GetActiveVehicles`) | Boot no longer grows with all-time history: it returns active operators/vehicles, all pending tickets, today's closed tickets, next number, and sync status | A very busy day can hit `BootHistoryLimit = 1000`, and the History screen assumes boot covered today until the operator changes ranges; startup is bounded by daily activity and the active vehicle master rather than years of data | Add SQL page-level queries if daily volume or large custom ranges become slow; consider an indexed UTC `business_at` |
| History is loaded into client memory | `WebUI/js/screens/history.js`, `WebUI/js/state.js` | Screens filter/sort locally and feel fast on small data | The History screen replaces the ledgers with the selected date range, but a 30-day or custom range can still load up to 5,000 rows; all filtering/sorting remains client-side | Move filtering/sorting/paging to SQL-backed bridge commands |
| Every bridge command opens a new encrypted connection | `Data/DatabaseContext.cs` (`OpenConnection`), `BridgeService.cs:101` | Acceptable for one operator | SQLCipher connection setup and key handling repeat per command; no benchmark exists for high-frequency weighing | Benchmark and then pool/reuse connections if setup cost is material |
| PBKDF2 CPU load during setup/tests | `ConfigService.cs:15` (`Iterations = 100_000`), `DatabaseTests.cs:8-17` | ~34–70 s test suite for 84 tests; high CPU when seeding multiple operators | Slower test feedback and setup on low-end hardware | Introduce a work-factor abstraction/configurable iteration count for test environments |
| Archive rendering is serial and in-process | `Services/PdfArchiveService.cs`, `Services/WebViewPdfArchiveRenderer.cs` | One hidden WebView2 render at a time; baseline catch-up can take time on first launch | A large backlog delays archive completion and shares the UI process | Measure baseline render time on the target workstation; consider a progress indicator or a separate worker process if the backlog is large |
| Single-workstation design | `App.xaml.cs:21-31`, `Data/Schema/V001_InitialSchema.sql` (`offline_leases` rows) | One process per Windows session is enforced | No multi-workstation lease or server coordination beyond unused `offline_leases` rows | Document the one-workstation deployment limit or add lease coordination if multi-workstation is required |
| Synchronous reader thread | `ScaleReaderService.cs:65-98`, `:112-113` | Read timeouts are 500 ms; a stalled stream blocks reconnection until the read/connect path returns | Acceptable for one scale, not for a high-throughput aggregator | Isolate connect/read paths with cancellation or asynchronous I/O |
| Unbounded outbox | `Data/DatabaseContext.cs` (`InsertOutbox`), `Data/Services/SyncStatusService.cs` (`GetSyncStatus`) | `outbox_events` grows with every mutation | No sync worker or retention policy exists for the life of the workstation | Define an outbox retention/compaction policy and implement delivery in Phase 2 |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal (last 90 days) | Safe change strategy |
|------|-------------|-----------------------------|----------------------|
| `AugmentScale/WebUI/index.html` | Root template containing layout, navigation, modals, and screen containers; structural coupling to partials and CSS | 11 commits | Keep HTML structural changes isolated; maintain partial template separation; update `html-loader.js` and CSS links in the same change |
| `AugmentScale/WebUI/js/state.js` | Central in-memory state store bridging UI screens and backend data | 10 commits | Write unit tests for state mutations before changing reducer functions; treat it as a contract |
| `AugmentScale/WebUI/js/html-loader.js` | Partial load order and manifest; adding/removing a partial breaks the page if not updated | 8 commits | Update `PARTIALS` and the matching `index.html` CSS when adding/removing a partial; smoke test all screens |
| `AugmentScale.Tests/DatabaseTests.cs` | 758 lines centralizing many domains; adding unrelated features tends to extend this file | 8 commits | Add tests around the affected domain; avoid extending it for unrelated features; consider splitting by domain |
| `USER_MANUAL.md` | Documents commands, data locations, recovery, and troubleshooting | 8 commits | Update alongside behavior, path, or command changes |
| `AugmentScale/Services/DatabaseService.cs` | Thin composition root for persistence; new domain wiring touches it | 7 commits | Keep composition changes localized; run the full `dotnet test` suite before and after edits |
| `AugmentScale/Data/` | Persistence infrastructure and domain services extracted from the former monolith; transaction/connection semantics are shared | New split (0 commits) | Treat `DatabaseContext` transaction/connection semantics as a contract; add focused tests before changing lifecycle rules |
| `AugmentScale/Services/BridgeService.cs` | Dispatches IPC messages and handles UI thread marshaling | 6 commits | Ensure every new command defines a matching C# command class and JS `sendCommand` caller; test routing and timeout |
| `AugmentScale/WebUI/js/main.js` | Bootstrap and side-effect module imports | 6 commits | Verify bootstrap ordering, side-effect imports, and screen initialization after changes |
| `AugmentScale/WebUI/partials/modals.html` | Shared modal markup used across screens | 6 commits | Smoke test every modal on every screen that opens it |
| `AugmentScale/WebUI/partials/telemetry-bar.html` | Shared live scale/status markup | 6 commits | Smoke test connected, disconnected, and unstable states |
| `AugmentScale/WebUI/js/screens/history.js` | Large (1,184 lines) filter/sort/report UI with range-scoped loading | 6 commits | Manual WebView2 smoke test of filters, date ranges, sorting, reports, and print after changes |
| `AugmentScale/WebUI/js/screens/dashboard.js` | Dashboard stats and pending queue rendering | 6 commits | Smoke test with empty, populated, and large ticket sets |
| `AugmentScale/WebUI/js/keyboard.js` | Global keyboard shortcuts | 5 commits | Verify shortcuts on every screen and after modal focus changes |
| `AugmentScale/MainWindow.xaml.cs` | WebView2 lifecycle, virtual host, navigation, and reader start | 5 commits | Retest runtime check, virtual host, navigation failure, and reader startup |
| `AugmentScale/WebUI/js/screens/first-weigh.js` | Largest screen script (1,487 lines); ticket creation/capture flow | 5 commits | Manual smoke test of every first-weigh path and print output |
| `AugmentScale/WebUI/css/dashboard.css` | Screen-specific layout and table styling | 5 commits | Visual check at supported window sizes and with long plate/name values |
| `AugmentScale/App.xaml.cs` | Startup composition, mutex, CLI reset, global exception handlers | 4 commits | Retest startup, single-instance behavior, `--reset-pin`, and fatal-error handling |
| `AugmentScale/Services/ConfigService.cs` | DPAPI secrets, setup bootstrap, and PIN hashing | 4 commits | Retest first run, existing database, missing/corrupt secrets, and PIN reset |
| `AugmentScale/WebUI/js/screens/trucks.js` | Vehicle management flows | 4 commits | Run vehicle lifecycle integration tests plus a UI smoke test |
| `AugmentScale/WebUI/js/print.js` | Print layouts and fallback behavior | 4 commits | Verify print preview and fallback for first-weigh, second-weigh, and history reports |
| `AugmentScale/Services/PdfArchiveService.cs` | Schedule/retry/file-placement state machine shared by startup and the Sync UI | New (0 commits) | Test baseline, daily catch-up, empty-day skip, failure/backoff, manual retry, and restart recovery after any change |
| `AugmentScale/Services/WebViewPdfArchiveRenderer.cs` | Hidden WebView2 lifecycle, environment handoff, print settings, and PDF output | New (0 commits) | Smoke test a real PDF after changing WebView2, CSS, print settings, or the report DOM |
| `AugmentScale/WebUI/js/sync.js` | Sync/archive status polling and retry button | 7 commits | Smoke test production sync, archive active/failed states, retry, and heartbeat polling |
| `AugmentScale/WebUI/js/history-report-document.js` | Shared report DOM used by interactive preview and archive PDF | New (0 commits) | Verify both preview and generated PDF after report layout changes |

Largest source files: `first-weigh.js` 1,487 lines, `history.js` 1,184, `state.js` 793, `DatabaseTests.cs` 758, `TicketRepository.cs` 727, `second-weigh.js` 639, `dashboard.js` 571, `trucks.js` 548, `print.js` 522, `PdfArchiveService.cs` 253. The shared report builder extraction reduced `history-report.js` from 717 to 416 lines.

Cross-file coupling that breaks easily:

- Adding or removing a partial requires updating `html-loader.js` and the CSS links in `index.html`.
- Adding a bridge command requires touching `BridgeService` dispatch, `Models/Commands`, `runtime.js`/`state.js`, and the calling screen, with no compile-time check across the boundary.
- Changing a DTO property can silently break the WebUI because serialization is camelCase by convention and JavaScript has no types.
- Updating JS/CSS requires manually bumping the matching `?v=` strings to avoid stale WebView2 caches.
- Changing the history report DOM or print CSS affects both the interactive preview and the automatic archive PDF; verify both.
- Adding or changing archive status fields requires touching `ArchiveRunRepository`, `ArchiveStatusDto`, `SyncStatusService`, `sync.js`, and the Sync popover markup together.

Test fragility: the suite depends on temp-directory filesystem behavior and SQLCipher native assets; `SimulatorProtocolTests.TcpTransport_PublishesDecodedReadings` depends on real loopback timing.

Safe change strategy: treat `state.js` and the bridge DTOs as a contract, add/adjust the C# DTO and JS consumer together, run the full xUnit suite plus a manual WebView2 smoke test on every screen touched, and bump the matching `?v=` asset versions. For the persistence layer, keep new SQL in the owning repository/service, treat `DatabaseContext` transaction/connection semantics as a contract, and run the full suite after any change.

### 6) `[ASK USER]` Questions

1. [ASK USER] Should mandatory first-run PIN change enforcement be added so operators cannot remain on the default `1234`?
2. [ASK USER] Should a configurable PBKDF2 iteration parameter be introduced for test runs to drop the test suite time from roughly 34–70 seconds to under 2 seconds?
3. [ASK USER] Is cloud/Supabase sync required before this onsite test, or is local-only operation acceptable for this phase? Are there plans to activate the sync outbox in an upcoming release?
4. [ASK USER] Should the installer run the approved empty-database setup wizard, or is seeding five operators/vehicles with PIN `1234` intentional for the onsite test?
5. [ASK USER] Must every seeded operator change PIN `1234` before weighing?
6. [ASK USER] Should void/delete ticket and archive/delete vehicle require a supervisor PIN or role check in C#, rather than relying on the UI?
7. [ASK USER] Is physical vehicle deletion approved despite the design's soft-delete-only and lifetime-unique-plate rules? If not, should `deleteVehicle` be removed or converted to a soft delete?
8. [ASK USER] Should DevTools and the `Ctrl+Shift+D` shortcut be disabled for production builds?
9. [ASK USER] What is the required backup/restore procedure for `secrets.dat` and `augment-scale.db`, and should the app provide an in-app backup/export command?
10. [ASK USER] Is `--reset-pin` an acceptable support workflow, and who is allowed to use it?
11. [ASK USER] Should CI, linting, and JavaScript/WebView2 tests be added as a release gate before onsite use?
12. [ASK USER] Is the target deployment framework-dependent (requires .NET 10 Desktop Runtime + WebView2 Evergreen) or self-contained?

### 7) Evidence

- `docs/codebase/.codebase-scan.txt` (churn and line-count metrics)
- `AugmentScale/Services/DatabaseService.cs`
- `AugmentScale/Data/`
- `AugmentScale/Services/BridgeService.cs`
- `AugmentScale/Services/ConfigService.cs`
- `AugmentScale/Services/AuditService.cs`
- `AugmentScale/Resources/setup.json`
- `AugmentScale/MainWindow.xaml.cs`
- `AugmentScale/App.xaml.cs`
- `AugmentScale/WebUI/js/pin-auth.js`
- `AugmentScale/WebUI/js/sync.js`
- `AugmentScale/WebUI/js/screens/history.js`
- `AugmentScale/WebUI/js/screens/profiles.js`
- `AugmentScale.Tests/DatabaseTests.cs`
- `AugmentScale.Tests/PdfArchiveTests.cs`
- `AugmentScale/Services/PdfArchiveService.cs`
- `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`
- `AugmentScale/Data/Repositories/ArchiveRunRepository.cs`
- `AugmentScale/Data/Schema/V002_ArchiveRuns.sql`
- `tools/Get-DbKey.ps1`
- `USER_MANUAL.md`
- `OPEN_RAW_DB.md`
- `..\Implimentation_Plan.md`
- `..\Database_Design.md`

## Extended Sections (Optional)

### Investigation Notes

- Code markers: no `TODO`, `FIXME`, or `HACK` comments were found in source. Three `shortcut:` markers acknowledge temporary tradeoffs (`AugmentScale.csproj:31`, `ScaleReaderService.cs:136`, `pin-auth.js:5`).
- Hardcoded/config values: the organization, site, weighbridge, five seeded vehicles, all operator PINs (`1234`), COM1/9600/8N1, stability window, and 5 kg division are in `Resources/setup.json` and default models. Scale port/timeouts are read from config at runtime, but the shipped defaults assume the prototype hardware.
- Sequential-call check: `GetBootState` builds operators, active vehicles, pending tickets, today's closed history, next number, and sync status on one connection (`Data/Services/BootStateService.cs`); no N+1 external-call pattern exists. The boot payload is bounded by today's activity and the active vehicle master; older tickets load by selected date range from `history.js`.
- Large files over 500 lines: `TicketRepository.cs` (727 lines, single persistence domain), five WebUI screen/state scripts (`first-weigh.js`, `history.js`, `state.js`, `second-weigh.js`, `dashboard.js`), and several screen CSS files. The WebUI scripts are the clearest mixed-responsibility cases now that persistence is split by domain. `PdfArchiveService` is 253 lines and `ArchiveRunRepository` is 371 lines, both below the 500-line threshold.
