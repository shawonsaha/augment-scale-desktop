# Ponytail Audit — Augment Scale Desktop App

**What this repo does:** A WPF desktop weighbridge application (.NET 10, WebView2 UI, SQLCipher) that reads an XK3190-D10 scale over RS-232/TCP, creates and completes weigh tickets (first weigh → second weigh → net payload), manages vehicles/operators, prints slips, generates a daily PDF archive, and syncs everything to Supabase through an offline-first outbox. PIN-authenticated operators use a single workstation at the yard gate.

**Assumed load:** One workstation, 1–5 operators, one scale connection, a few hundred tickets per day, one Supabase project, one Windows install. Not multi-tenant and not multi-process. Growth measured in years, not requests per second.

**Verified:** `dotnet test AugmentScale.slnx --nologo -v q` → 135 passed, 0 failed, 0 skipped (2 × xUnit2013 warnings). Findings below were re-checked against current code; the previous version of this file was stale.

---

## Must fix

### 1. `--reset-pin` does nothing, and the obvious workaround destroys the database

**What this is:** `App.xaml.cs:157-190` builds a `PasswordBox` pair and a `Button`, then returns without ever showing a window, wiring `Click`, validating input, or calling `ConfigService.SetPin`.

**Problem:** `AugmentScale.exe --reset-pin mr` prints no error and exits successfully, but the PIN is unchanged. An operator locked out of a 4-digit PIN has no supported recovery. The natural next step — deleting `secrets.dat` — also destroys `DatabaseKey` (`ConfigService.cs:261`), which is the SQLCipher key for the ticket database. That converts "forgot my PIN" into "all weigh tickets are now unreadable". The one recovery path in the product is the one that loses the data.

**Fix:** Show a real dialog (`ShowDialog` + `PasswordBox` ×2), validate 4 digits and equality, call `ConfigService.SetPin(op.Id, pin)` or `DatabaseService.SetProfilePin` so the change is audited, then exit with a clear success message. Roughly 25 lines.

**If we skip it:** A forgotten supervisor PIN means a reinstall and permanent loss of the encrypted history; no remote or phone support can fix it.

### 2. DevTools is enabled in the shipping build

**What this is:** `MainWindow.xaml.cs:103` sets `AreDevToolsEnabled = true` unconditionally, and `MainWindow.xaml.cs:215-219` opens the DevTools window on Ctrl+Shift+D. Nothing disables either in Release.

**Problem:** `BridgeService` trusts every command from the page; the only check is `EnsureLicenseActive()` (`BridgeService.cs:186-192`). `createTicket`, `completeTicket`, `voidTicket`, and `deleteTicket` (`BridgeService.cs:353-379`) accept `OperatorId`/`OperatorName` from the message and never verify that an operator is signed in. Any operator at the terminal can open DevTools (or Ctrl+Shift+D) and run `chrome.webview.postMessage({command:'deleteTicket', payload:{ticketId:42, reason:'x', operatorId:'mr', ...}})`, deleting or voiding tickets as the supervisor with a forged audit actor. No PIN is asked for. The audit trail the PDF archive exists to prove becomes advisory.

**Fix:** Set `AreDevToolsEnabled = false` and remove the shortcut for release builds (gate both behind `#if DEBUG`), and add a per-session operator token to the mutating bridge commands, the same way `RequireProfileAdmin` already guards profile writes.

**If we skip it:** "Who voided this ticket?" has no trustworthy answer; any operator can rewrite history in a browser console.

### 3. Every install ships with supervisor PIN `1234`

**What this is:** `Resources/setup.json:45` sets `"pin": "1234"`, `Models/SetupConfig.cs:14-17` defaults the same, and `ConfigService.cs:272-289` hashes it into `secrets.dat` on first run, then blanks it from `setup.json`. Nothing marks it as temporary or forces a change.

**Problem:** A fresh install has a known supervisor credential. Anyone who has used the product, or read this public repo, can sign in as MD. RAJU, void tickets, edit profiles, and generate reports. Hashing at rest does not help when the plaintext is the default.

**Fix:** Ship no PIN. On first launch, require the supervisor to set one (the profile UI already supports `setProfilePin`), or force a change the first time a bootstrap PIN is used and mark it `mustChange`.

**If we skip it:** The weakest credential in the system is printed in the installer.

### 4. Renumber-on-conflict can collide again and dead-letter the ticket

**What this is:** `CloudControlService.cs:830-853` reacts to a duplicate `idx_tickets_number` by computing `newNumber = Math.Max(cloudMax ?? 0, currentNum) + 1`, writing it locally via `RenumberLocalTicket` (`CloudControlService.cs:1016-1053`), updating the outbox payload, and retrying. `RenumberLocalTicket` updates `weigh_tickets` and the sequence watermark but writes no `audit_events` row.

**Problem:** The formula ignores higher local ticket numbers. Concrete case: restore a backup whose local maximum is 150 while the cloud maximum is 100. Ticket #120 conflicts on upload; the code renumbers it to 121, which already exists locally, so the unique index (`V001_InitialSchema.sql:400`) throws again. That exception is caught at `CloudControlService.cs:875`, the event is marked failed, and after 10 attempts it becomes `dead_letter` (`CloudControlService.cs:1224-1243`). The retry recomputes 121 every time because the payload is only updated after the local write succeeds, so it never escapes. Even when renumbering works, the number changes with no audit record, which breaks the serial audit trail.

**Fix:** Allocate from all three maxima (cloud, local `MAX(ticket_number)`, watermark), do the read and the update in one transaction or a bounded retry loop, and insert an audit row (`ticket_number_change`, before/after, actor = system) in the same transaction. On permanent failure, keep the ticket visible as pending rather than silently dead-lettering it.

**If we skip it:** After any restore, reinstall, or second workstation, tickets can vanish from the cloud permanently; auditors see a renumbered ticket with no explanation.

### 5. `Site.Timezone` is stored but never read

**What this is:** `Models/SetupConfig.cs:55` and the `sites.timezone` column hold `Asia/Dhaka`, but the only other use is `Provisioner.cs:40` writing it. `TicketRepository.cs:126-129` (history), `HistoryReportService.cs:79-82` (reports), `GetEarliestReportDate` (`HistoryReportService.cs:72`), and `PdfArchiveService.cs:121-125` (archive schedule) all use the OS local time zone.

**Problem:** The business day is defined by Windows, not by the site. On a Dhaka site running a UTC-configured Windows (common on VPS/English installs), tickets weighed 00:00–06:00 local are filed under the previous day in history, in reports, and in the PDF archive; the 00:05 archive cutoff fires at 06:05 local. The frontend date helpers (`WebUI/js/screens/history.js:89-231`) also use browser-local dates, so the UI agrees with the bug.

**Fix:** Resolve `TimeZoneInfo` from `setup.Site.Timezone` once and use it for every day boundary (`HistoryPage`, `GenerateReport`, `GetEarliestReportDate`, `PdfArchiveService`), or pass the site-local date from the host to the UI. Keep storing UTC.

**If we skip it:** The compliance archive will look correct and file tickets under the wrong day whenever the OS zone differs from the site.

### 6. PIN lockout lives only in `localStorage`

**What this is:** `WebUI/js/pin-auth.js:9-11,83-98` implements 5 attempts / 60 s lock per operator in `localStorage` under `weighbridge_op_lock_*`. The authoritative check is `ConfigService.AuthenticatePin` (`OperatorRepository.cs:81-85`) with no attempt counter, no delay, and no audit.

**Problem:** A 4-digit PIN has 10,000 combinations. The lockout is bypassed by clearing storage, reloading, or a DevTools loop calling `authenticatePin`; the host happily verifies all 10,000 guesses. Failed attempts are not logged, so a brute-force attempt leaves no trace. With finding #2 present this needs no tools at all.

**Fix:** Track failures and `lock_until` on the host (in `secrets.dat` or a DB table) keyed by operator id, add an increasing delay, write failed attempts to `audit_events`, and make the lock survive a reload.

**If we skip it:** PINs are decorative; an unattended terminal can be walked into in minutes.

---

## Should fix

### 7. The daily PDF is sealed before the day it describes is over

**What this is:** `PdfArchiveService.cs:15,121-125` enqueues the previous day at 00:05 local. Reports filter by `business_at` (`TicketRepository.cs:772-773`), and `V002_ArchiveRuns.sql:26-29` makes `(organization_id, kind, period_start, period_end)` unique, so a day is never regenerated.

**Problem:** A truck weighed at 23:30 and completed at 00:30 is archived in yesterday's PDF as `pending` at 00:05, and no later archive will ever show it completed. The PDF is the compliance artifact, so it permanently records an unfinished ticket and totals that disagree with the database.

**Fix:** Either move the cutoff past the shift (e.g. 05:00) and document it, or allow a day to be re-archived when one of its tickets changes (drop the unique index or add a revision column, and enqueue a replacement run on late completion).

**If we skip it:** Late completions are invisible to the archive; the PDF totals drift from the DB every time a truck crosses midnight.

### 8. Every vehicle event stays in the outbox forever, and V006 drops the index that makes that survivable

**What this is:** `DatabaseMaintenance.cs:52-67` deliberately never prunes accepted rows for `vehicles` and `ticket_corrections`, because the backfill queries in `CloudControlService.cs:626,659-664` use row absence to mean "never queued". Separately, `V004_Hardening.sql:5` creates `idx_outbox_entity`, then `V006_OutboxDeadLetterStatus.sql:35` drops `outbox_events` (and all its indexes) and only recreates `idx_outbox_status` at line 39. Fresh installs run V004 then V006, so the entity index never exists in practice.

**Problem:** Vehicles are upserted as tickets are weighed, so the outbox grows by one full-row JSON payload per vehicle update, forever, and the backfill queries full-scan that ever-growing table on every sync cycle. After a few years the "reliable outbox" is the largest table in the database and the hourly heartbeat pays for it.

**Fix:** Recreate `idx_outbox_entity` at the end of V006 (or in a V007), and replace the "row absence means never queued" trick with a small `synced_entities`/watermark table so accepted `vehicles` rows can be pruned like everything else.

**If we skip it:** Slow sync and a database that only grows; painless for a year, unpleasant after three.

### 9. The reported license state disagrees with the enforced one

**What this is:** `SyncStatusService.cs:71` hardcodes `(DateTimeOffset.UtcNow - dt).TotalDays > 30`, while `CloudControlService` uses `_config.Setup.Cloud.LicenseGraceDays` (`CloudControlService.cs:139,541-554,1282`).

**Problem:** If the configured grace period is anything other than 30 days, the UI and the operator lock screen report the wrong license state. Set it to 7 and the header says "active" for 23 days while every write throws.

**Fix:** Pass `ConfigService` into `SyncStatusService` and use the same `LicenseGraceDays` value, or have `CloudControlService` own the calculation and expose it.

**If we skip it:** The UI can promise an active license that the backend refuses to honor.

### 10. Operator fields are interpolated into HTML without escaping

**What this is:** `WebUI/js/screens/login.js:151-158` builds the operator card with `op.name`, `op.role`, `op.shift`, `op.color`, and `op.avatar` inside `innerHTML`; unlike `profiles.js:57-74`, it does not import `escapeHtml`.

**Problem:** Operator names are supervisor-provided profile data. A name containing markup becomes stored XSS on the login screen — the one screen that runs before authentication — and can render fake operator cards or exfiltrate the PIN as it is typed.

**Fix:** Import `escapeHtml` from `../utils.js` and wrap every interpolated field, including `alt` and `style` attributes (validate the color against the existing hex allowlist instead of escaping it).

**If we skip it:** A profile edit becomes script execution at the login screen.

### 11. Double-launching the app throws from `OnExit`

**What this is:** `App.xaml.cs:48-58` creates a named `Mutex`; when `isFirst` is false it shows "already running" and calls `Shutdown()`. `OnExit` (`App.xaml.cs:135-144`) unconditionally calls `_singleInstance?.ReleaseMutex()`.

**Problem:** In the second-instance path the process does not own the mutex, so `ReleaseMutex()` throws `ApplicationException: Object synchronization method was called from an unsynchronized block of code` inside `OnExit`. Depending on shutdown timing, the user sees an unhandled-exception dialog after an otherwise correct "already running" message.

**Fix:** Only call `ReleaseMutex()` when the mutex was actually acquired (track a `_ownsMutex` flag, or `try/catch` around the release), and set `_singleInstance = null` before `Shutdown()`.

**If we skip it:** A confusing error every time someone double-clicks the shortcut.

### 12. Initial schema migration runs outside a transaction

**What this is:** `SchemaMigrator.cs:39-45` executes all of `V001_InitialSchema.sql` and the `schema_version` insert directly, unlike V002–V006 which wrap their work.

**Problem:** A crash or disk error during first-run schema creation leaves a partial schema with no version row. The current statements are `IF NOT EXISTS`, so a rerun usually heals it, but the version insert is not atomic with the DDL, and any future non-idempotent edit to V001 will make this a landmine.

**Fix:** Wrap the V001 block in `BeginTransaction` like the later migrations.

**If we skip it:** Low probability, high confusion; it fails at install time on a machine you cannot easily inspect.

### 13. Schema migration splits SQL on `;` and ignores pragmas inside a transaction

**What this is:** `SchemaMigrator.cs:66-79,107-120,133-140` splits V003/V005/V006 into statements on `;`, and `V006_OutboxDeadLetterStatus.sql:2,41` sets `PRAGMA foreign_keys=OFF/ON` inside that transaction.

**Problem:** SQLite ignores `foreign_keys` pragmas inside a transaction, so the rebuild of `outbox_events` runs with foreign keys still on (works today only because nothing references that table). More importantly, any future migration containing a trigger body, a `;` inside a string, or a `BEGIN … END` block will be silently cut in half and fail at runtime.

**Fix:** Execute each migration file as one command (Microsoft.Data.Sqlite supports multiple statements in `CommandText`), and run table rebuilds with the pragma outside the transaction.

**If we skip it:** The next migration someone writes with a trigger breaks on existing installs, not in tests.

### 14. `DatabaseMaintenance` throttle is static

**What this is:** `DatabaseMaintenance.cs:33-41` keeps `_lastRun` in a static field shared by every `DatabaseContext` in the process.

**Problem:** Production has one context, so it is harmless. Tests create many contexts in one process; the first one runs maintenance and every later context within an hour silently skips it, which makes retention tests order-dependent.

**Fix:** Move `_lastRun` onto `DatabaseContext` (instance field) or pass it in; keep `force: true` for explicit runs.

**If we skip it:** Flaky tests, not a production bug.

---

## Nice to have

### 15. Dead code that still has to be read and maintained

- `TicketRepository.cs:966-971` — `ReadPrintLog` single-ticket overload has no callers; the batched `ReadPrintLogs` is used everywhere. (6 lines)
- `TicketRepository.cs:409-413` — the `firstType` ternary is immediately overwritten by the `if (direction == "OUT")` lines; only the direction check matters. (4 lines)
- `Program.cs:19-48` — `CreateSimulatorShortcut` is never called; the simulator is launched from the shipped `Run-With-Simulator.cmd`. (~30 lines)
- `Program.cs:12` and `App.xaml.cs:16` both call `VelopackApp.Build().Run()`. Harmless today, but two startup hooks are one too many.
- `BridgeService.cs:258-262` — the `getHistory` command is not used by any screen (history uses `queryHistory`).

**Fix:** Delete them. **If we skip it:** Every future reader pays for them.

### 16. Test suite covers the happy paths, not the risky ones

**What this is:** 135 tests pass, including ticket lifecycle, history, archives, cloud outbox, and protocol parsing. There is no test for: the reset-pin path, a renumber collision (`RenumberLocalTicket`), a non-local site time zone at a day boundary, late completion after an archive run, or DevTools/command authorization.

**Problem:** The four highest-consequence bugs in this report (#1, #4, #5, #7) are exactly the paths with no coverage. A green suite reads as "safe" when it is really "the ordinary flows work".

**Fix:** Add one test each for renumbering with a higher local number, a report/archive window in `Asia/Dhaka` while the test host is UTC, and a ticket completed after its day was archived. The reset-pin dialog can be tested through `ConfigService.SetPin`.

**If we skip it:** These will regress the first time someone refactors sync or archiving.

---

## Verdict

Fix **#1–#6** before the next install: they are the ones that lose data or let an operator rewrite history. In order: reset-pin (#1), DevTools/session authorization (#2), default PIN (#3), renumber collision (#4), timezone (#5), PIN throttling (#6). Then **#7–#9** in the next maintenance window — the archive cutoff and the outbox index/retention are slow-growing but permanent. **#10–#16** are cheap and can ride along with the next touch of those files.

The core architecture is sound: transactions carry business data, audit, and outbox together; history queries are parameterized and allowlisted; vector/HTML output is mostly escaped; the workflow state machine is tested. The failures are at the edges — recovery, the browser surface, and time.

**Lean:** ~50 lines deletable (#15) plus the ~9-line dead reset-pin dialog that gets replaced. No unnecessary dependencies found. Two generated `tools/*.js` scripts (2.7k lines) live outside the build and are not counted.

**Not checked:** `AugmentScale.WebUI/css` and `partials/` in depth, `AugmentScale.ScaleSimulator`, `tools/*.ps1` and the two `tools/*.js` generators, `publish.ps1`/`upload-releases.ps1`, `docs/`, Supabase RLS policies and the live cloud schema, and live WebView2/manual UI flows (no running instance was driven). The dashboard-web project is outside this folder.
