# Ponytail Audit — Augment Scale Desktop App

**What this repo does:** A WPF desktop weighbridge application that reads a physical scale (XK3190-D10 via RS-232/TCP), manages weigh tickets (first weigh → second weigh → net payload), and syncs data to Supabase Cloud. It runs at one scale station with a handful of operators authenticating by PIN. The encrypted SQLite database stores tickets, vehicles, operators and audit events. PDF archive reports are generated daily for compliance.

**Assumed load:** Single workstation, 1–5 operators, one concurrent serial connection, syncing to one Supabase project. Not multi-tenant, not multi-process.

---

## Must fix

### 1. **SQL injection in `ReadAllRowsFromTable`** ([CloudControlService.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L982))
- **What this is:** The cloud bootstrap reads entire reference tables via `$"SELECT * FROM {table};"` — the table name is string-interpolated, not parameterized.
- **Problem:** The table names come from a hardcoded array on L638–652, so today there is no user-controlled injection path. But `ReadRowById` on L1004 does the same: `$"SELECT * FROM {table} WHERE id = $id LIMIT 1;"` — the `table` parameter there comes from `entityType`, which is read from the outbox `entity_type` column. If a malformed outbox row gets inserted (via a bug or a future code change), this becomes an injection vector. The same pattern appears in `DatabaseMaintenance.Prune` (L64).
- **Fix:** Validate table names against a static allowlist before interpolation:
  ```csharp
  private static readonly HashSet<string> KnownTables = new(StringComparer.OrdinalIgnoreCase)
  { "weigh_tickets", "vehicles", "profiles", "ticket_corrections", /* ... */ };
  if (!KnownTables.Contains(table)) throw new ArgumentException($"Unknown table '{table}'.");
  ```
  One check, shared by `ReadAllRowsFromTable`, `ReadRowById`, and `Prune`.
- **If we skip it:** Today safe because all inputs are hardcoded. Tomorrow a bug or refactor could turn this into a data-exfiltration path in the local database. Defense-in-depth for a production app handling weighbridge compliance data.

---

### 2. **Supabase anon key and URL hardcoded as defaults** ([SetupConfig.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L24-L25))
- **What this is:** `CloudSetup` class has a real Supabase URL and anon JWT baked in as C# property defaults.
- **Problem:** This key is compiled into every build and published binary. Anyone who decompiles the DLL or reads the setup.json file (which is world-readable on disk) gets your Supabase anon key. The anon key grants whatever RLS policies allow for the `anon` role. If your RLS isn't airtight, this is a direct read/write path to production data for anyone with the binary.
- **Fix:** Remove the defaults. Make `SupabaseUrl` and `SupabaseAnonKey` default to `""`. The app already handles missing config (L223–231 in CloudControlService returns `"offline"`). Ship the actual values only in each customer's `setup.json`.
- **If we skip it:** Every binary on every customer machine carries credentials that might allow reading or writing to your cloud tables, depending on your RLS rules.

---

### 3. **All default operator PINs are "1234"** ([SetupConfig.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Models/SetupConfig.cs#L14-L18))
- **What this is:** The five seeded operators (MR, AK, SH, RH, KH) all have PIN "1234" as their default.
- **Problem:** After first-run provisioning, the PINs are hashed and removed from `setup.json`. But until the admin changes them, every operator shares the same 4-digit PIN. If the machine is shared or accessible, any person who knows to try "1234" can log in as any operator, including the Supervisor (who can create/modify profiles, void tickets).
- **Fix:** Force a PIN-change flow on first login per operator, or generate random PINs and print them during provisioning.
- **If we skip it:** Every fresh install has effectively no authentication until someone manually changes all five PINs.

---

### 4. **`ResetPin` method is incomplete — never actually resets the PIN** ([App.xaml.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/App.xaml.cs#L145-L178))
- **What this is:** The `--reset-pin` CLI command constructs `PasswordBox` and `Button` UI elements but never shows a window, never wires up the button click, and never calls `ConfigService.SetPin()`.
- **Problem:** The function just creates widgets on the stack and returns. The user sees nothing. If an operator is locked out, this recovery path is broken.
- **Fix:** Complete the method: show a dialog window, wire the button to validate the two password boxes match and call `_config.SetPin(profile.Id, pinBox.Password)`, or strip it and document the manual `setup.json` recovery path.
- **If we skip it:** The advertised `--reset-pin` command silently does nothing. A locked-out operator has no CLI recovery path.

---

## Should fix

### 5. **Outbox events never expire from `pending` status** ([CloudControlService.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L806-L814), [DatabaseMaintenance.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseMaintenance.cs#L41-L55))
- **What this is:** If a sync event fails, the outbox loop breaks on the first failure (L814: `break;`). The failed event stays `pending` forever. Maintenance only prunes `accepted`, `rejected`, and `conflict` rows.
- **Problem:** A single permanently failing event blocks all subsequent events. The `attempts` counter increments but nothing ever moves the event to a dead-letter state. Over time, this prevents all cloud sync.
- **Fix:** After N attempts (e.g. 10), mark the event `rejected` or `dead_letter` so subsequent events can flow. Log it for manual investigation.
- **If we skip it:** One bad outbox event can permanently block cloud sync with no automatic recovery.

### 6. **No test coverage for ticket creation / completion / void / delete** ([DatabaseTests.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/DatabaseTests.cs))
- **What this is:** The test suite covers protocol decoding, scale stability, config/secrets, PDF archiving, cloud sync, and simulator. But `TicketRepository` — the core business logic (create, complete, void, soft-delete, reprint, ticket-number allocation) — has no unit tests.
- **Problem:** The ticket lifecycle is the most critical code path (money, compliance, audit trail). Net-weight calculation, override logic, concurrent plate checks, and ticket numbering are all untested.
- **Fix:** Add tests for: creating a ticket, completing it (normal + override), voiding, soft-deleting, and the duplicate-plate guard. The existing test infrastructure (in-memory SQLCipher + seeded setup) supports this.
- **If we skip it:** Regressions in the core business flow won't be caught before production.

### 7. **New connection opened per every database operation** ([DatabaseContext.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseContext.cs#L63-L101))
- **What this is:** `OpenConnection()` creates a brand-new `SqliteConnection`, sets WAL/pragma, and returns it. Every repository method, every outbox check, every maintenance run opens and closes its own connection.
- **Problem:** At this load (single workstation), it works. But each `OpenConnection` runs 3 PRAGMA statements, and the `CloudControlService.RunCycleAsync` opens 8+ connections in one cycle (controls read, heartbeat, backfill scan, cursor updates, outbox batch, mark accepted). SQLCipher key derivation on every open adds measurable latency.
- **Fix:** Pool or reuse a single connection for the cloud sync cycle. Pass the existing `conn` down instead of opening new ones. The ticket/vehicle repos already do this internally.
- **If we skip it:** Slightly slower cloud sync cycles due to redundant key derivation. Not a correctness bug, but a drag on the hourly heartbeat.

### 8. **`DatabaseMaintenance` uses a static `_lastRun` — shared across all instances** ([DatabaseMaintenance.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/DatabaseMaintenance.cs#L24))
- **What this is:** `_lastRun` is `static`. In tests, multiple `DatabaseContext` instances share the same throttle state.
- **Problem:** In production this is fine (single process). In tests, the first test that calls `EnsureInitialized()` sets the static clock, and subsequent tests within the same hour skip maintenance. This can cause flaky tests if a test relies on maintenance having run.
- **Fix:** Make `_lastRun` an instance field on `DatabaseContext`, or accept `force: true` in test setups (which is already done on L58).
- **If we skip it:** Potential test flakiness, not a production bug.

### 9. **`MarkOutboxFailed` does not update `status` to `failed`** ([CloudControlService.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L1125-L1138))
- **What this is:** When an outbox event fails to sync, `MarkOutboxFailed` increments `attempts` and records the error — but never changes `status` from `'pending'`.
- **Problem:** Combined with finding #5: failed events remain `pending` indefinitely. The sync loop fetches the same batch on every cycle, hits the same failure, and breaks. The UI says "syncing" but nothing ever moves forward.
- **Fix:** After a threshold (e.g. `attempts >= 10`), set `status = 'dead_letter'`. Or at minimum, skip events with high attempt counts in `FetchPendingOutboxBatch`.
- **If we skip it:** Same as #5 — one persistent failure blocks all sync.

---

## Nice to have

### 10. **`ReadPrintLog` single-ticket overload is unused** ([TicketRepository.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Repositories/TicketRepository.cs#L966-L971))
- **What this is:** `ReadPrintLog(connection, txn, ticketUuid)` wraps `ReadPrintLogs` for a single UUID.
- **Problem:** No caller uses it. The batched version is called everywhere.
- **Fix:** Delete it (4 lines).
- **If we skip it:** Dead code — read and maintained for nothing.

### 11. **`HistoryOrderBy` column names could use an allowlist** ([TicketRepository.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/Repositories/TicketRepository.cs#L341-L367))
- **What this is:** `HistoryOrderBy` switches on a user-provided `sortKey` string to produce SQL ORDER BY clauses.
- **Problem:** The switch has a `default` case that returns a safe fallback, so unknown keys don't inject SQL. But the switch also interpolates `direction`, which is validated to only `ASC` or `DESC` (L343–345). No real risk today, but converting the direction to an enum would make it impossible to pass through unexpected values.
- **Fix:** No action needed. The current code is correct. Minor: use `StringComparison.OrdinalIgnoreCase` on the direction check instead of `Equals` for clarity — already done.
- **If we skip it:** Fine. Already safe.

### 12. **Schema migration V001 runs without a transaction** ([SchemaMigrator.cs](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Data/SchemaMigrator.cs#L36-L45))
- **What this is:** Migration V001 (the initial schema) executes the SQL directly on the connection with no explicit transaction. V002–V005 wrap their work in transactions.
- **Problem:** If the initial schema creation fails partway through (e.g., power loss), the database ends up in a partial state. The migration version won't be recorded, so it would re-run, but DDL statements like `CREATE TABLE` are not idempotent without `IF NOT EXISTS`.
- **Fix:** Wrap V001 in a transaction like V002+. Since V001 creates many tables, `IF NOT EXISTS` already protects the DDL, but a transaction makes the version-recording atomic.
- **If we skip it:** Extremely unlikely to hit — only on first-ever run with a power failure during schema creation.

---

## Verdict

Fix #1–#4 first: the SQL injection defense, the hardcoded Supabase key, the default PINs, and the broken reset-pin command. Then fix the outbox dead-letter gap (#5 + #9) — it will silently block all cloud sync after the first permanent failure.

**Lean:** ~4 lines deletable (finding #10). No unnecessary dependencies.

**Not checked:** The HTML partial files in `WebUI/partials/` (screen templates), the `AugmentScale.ScaleSimulator` project, the `tools/` scripts, the `docs/` directory, `USER_MANUAL.md`, and the `supabase_integration_plan.md`. The frontend JS was spot-checked for `innerHTML`/XSS — all dynamic user data goes through `escapeHtml()`, which is correct.
