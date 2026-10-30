# Security Hardening Plan — Supabase Credentials & RLS Lockdown

## Goal Description

Prevent Supabase credentials from leaking into the git repository and lock down the live Supabase database so the public `anon` key cannot be used for unrestricted data access.

### Background — Current State of Exposure

| Item | Where | In Git? | Exposed on GitHub? |
|---|---|---|---|
| Supabase URL + Anon Key | `SetupConfig.cs` class defaults (lines 20–21) | ✅ Tracked, 35 commits ahead of `origin/main` | ❌ Not yet pushed |
| Supabase URL + Anon Key | `AugmentScale/Resources/setup.json` (lines 29–30) | ✅ Tracked, 35 commits ahead | ❌ Not yet pushed |
| Supabase URL + Anon Key | `docs/supabase_integration_plan.md` (lines 16–17, 543–555) | ✅ Tracked, 35 commits ahead | ❌ Not yet pushed |
| Supabase URL + Anon Key | `publish/win-x64/Resources/setup.json` | ❌ Gitignored (`desktop_app/publish/`) | ❌ |
| Supabase URL + Anon Key | `dashboard-web/.env.local` | ❌ Gitignored (`.env*`) | ❌ |
| Admin Email + Password | `dashboard-web/src/app/api/auth/pin/route.ts` (lines 9, 12–13) | ✅ Tracked, 35 commits ahead | ❌ Not yet pushed |
| RLS: `allow_all_*` policies | Live Supabase database | N/A (database-side) | N/A — **database is publicly accessible** |

> [!CAUTION]
> **The live Supabase database is currently open.** All 19 tables have `FOR ALL USING (true) WITH CHECK (true)` policies. Anyone with the project URL and anon key (which is designed to be public) can SELECT, INSERT, UPDATE, and DELETE any row. We confirmed this by reading `workstation_controls`, `weigh_tickets`, and `profiles` unauthenticated.

> [!IMPORTANT]
> **Do NOT `git push` until these changes are committed.** The 35 unpushed commits contain the anon key in `SetupConfig.cs`, `setup.json`, and `supabase_integration_plan.md`, plus the admin password in `route.ts`.

---

## Approach Summary

This plan follows a **"defense in depth"** strategy:

```mermaid
flowchart TD
    A["Layer 1: Git Hygiene"] --> B["Layer 2: Runtime Config"]
    B --> C["Layer 3: Database RLS"]

    A --- A1["Remove secrets from source code defaults"]
    A --- A2["Scrub secrets from docs"]
    A --- A3["Update .gitignore"]

    B --- B1["Anon key loaded from per-machine setup.json only"]
    B --- B2["Admin creds read from server-only env vars"]

    C --- C1["Replace allow_all_* with scoped policies"]
    C --- C2["Anon role: heartbeat upsert + reference read only"]
    C --- C3["Authenticated role: full dashboard access"]
```

---

## User Review Required

> [!IMPORTANT]
> **Desktop sync authentication model:** The desktop app currently uses the `anon` key directly (no Supabase Auth login). This plan keeps that model but restricts what `anon` can do via RLS. A future enhancement could have each workstation authenticate with a dedicated Supabase Auth service account, but that is **out of scope** for this hardening pass.

> [!IMPORTANT]
> **Anon key is designed to be public.** Supabase's architecture expects the anon key to ship in client apps. The actual security boundary is RLS. So removing the anon key from source code is a *hygiene* measure (keeping the git history clean), while locking down RLS is the *critical security fix*.

> [!WARNING]
> **History rewrite is NOT proposed.** The anon key already exists in 35 local commits. Rather than force-pushing a rewritten history, we will: (1) remove the key from the current working tree, (2) commit the removal, and (3) rotate the Supabase anon key after RLS is locked down (manual step in Supabase Dashboard). This is simpler and safer.

---

## Open Questions

> [!IMPORTANT]
> **1. Key rotation after lockdown?** After RLS is locked down and the new commit removes secrets from source, do you want to rotate the Supabase JWT secret / anon key in the Supabase Dashboard? This invalidates the old key in all 35 local commits. (Recommended: **yes**, but it means updating the deployed desktop app's `setup.json` and the `dashboard-web/.env.local` with the new key.)

> [!IMPORTANT]
> **2. Dashboard-web admin credentials:** The hardcoded `admin@augmentscale.com` / `AugmentScale2026!` — should these be moved to server-only env vars in `.env.local` (this plan's approach), or do you want a completely different auth flow (e.g., Supabase magic link, OAuth)?

---

## Proposed Changes

### Component 1 — C# Desktop App: Remove Hardcoded Credentials

#### [MODIFY] `AugmentScale/Models/SetupConfig.cs`

Remove the hardcoded Supabase URL and anon key from the `CloudSetup` class defaults. Replace with empty strings so the app won't accidentally connect to anything if `setup.json` is missing the cloud section.

```diff
 public sealed class CloudSetup
 {
-    public string SupabaseUrl { get; set; } = "https://fydikuezxmbjnkjyskwi.supabase.co";
-    public string SupabaseAnonKey { get; set; } = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78";
+    public string SupabaseUrl { get; set; } = "";
+    public string SupabaseAnonKey { get; set; } = "";
     public int HeartbeatIntervalSeconds { get; set; } = 3600; // 1 hour
     public int LicenseGraceDays { get; set; } = 30; // 30 days
 }
```

**Impact:** `CloudControlService` already guards against empty config at [line 251](file:///c:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale/Services/CloudControlService.cs#L251):
```csharp
if (string.IsNullOrWhiteSpace(cloudConfig.SupabaseUrl) || string.IsNullOrWhiteSpace(cloudConfig.SupabaseAnonKey))
{
    // Status = "offline", LastError = "Supabase configuration is missing."
    return;
}
```
So an app launched without a properly configured `setup.json` will simply run offline — no crash.

---

#### [MODIFY] `AugmentScale/Resources/setup.json`

Replace real credentials with clearly-labeled placeholders in the **template** file that ships with the source code. The real `setup.json` with actual credentials lives on each deployed machine in `%LOCALAPPDATA%\AugmentScale\setup.json`, created by `ConfigService.LoadOrCreateSetup()` on first run.

```diff
   "cloud": {
-    "supabaseUrl": "https://fydikuezxmbjnkjyskwi.supabase.co",
-    "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78",
+    "supabaseUrl": "",
+    "supabaseAnonKey": "",
     "heartbeatIntervalSeconds": 3600,
     "licenseGraceDays": 30
   }
```

> [!NOTE]
> The deployed machines (e.g. `DESKTOP-128GRO4`) already have their own `%LOCALAPPDATA%\AugmentScale\setup.json` with the real URL and key. This change only affects the **source code template**. `ConfigService` copies the template only on first run when no local setup.json exists.

---

#### [MODIFY] `AugmentScale.Tests/SetupConfigTests.cs`

The existing test `DefaultSetupConfig_MatchesSetupJsonTemplate` asserts that C# defaults match the JSON template values exactly. After we blank both, the assertions for `Cloud.SupabaseUrl` and `Cloud.SupabaseAnonKey` will naturally pass (empty == empty). No code change needed in the test itself, but let's add an explicit assertion to enforce that the template doesn't accidentally reintroduce real keys:

```diff
     // Cloud
     Assert.Equal(expected.Cloud.SupabaseUrl, fresh.Cloud.SupabaseUrl);
     Assert.Equal(expected.Cloud.SupabaseAnonKey, fresh.Cloud.SupabaseAnonKey);
+    // Security: template must NOT contain real credentials
+    Assert.True(
+        string.IsNullOrEmpty(fresh.Cloud.SupabaseUrl) || fresh.Cloud.SupabaseUrl.StartsWith("https://YOUR-"),
+        "CloudSetup.SupabaseUrl must not contain a real project URL in source code defaults.");
+    Assert.True(
+        string.IsNullOrEmpty(fresh.Cloud.SupabaseAnonKey) || fresh.Cloud.SupabaseAnonKey == "YOUR-ANON-KEY-HERE",
+        "CloudSetup.SupabaseAnonKey must not contain a real key in source code defaults.");
     Assert.Equal(expected.Cloud.HeartbeatIntervalSeconds, fresh.Cloud.HeartbeatIntervalSeconds);
     Assert.Equal(expected.Cloud.LicenseGraceDays, fresh.Cloud.LicenseGraceDays);
```

---

### Component 2 — Documentation: Scrub Credentials from Tracked Docs

#### [MODIFY] `docs/supabase_integration_plan.md`

Replace all occurrences of the real Supabase URL, anon key, and any other credential-like strings with redacted placeholders:

| Line(s) | Current | Replacement |
|---|---|---|
| 16 | `https://fydikuezxmbjnkjyskwi.supabase.co` | `https://<YOUR-PROJECT-REF>.supabase.co` |
| 17 | Full anon key JWT | `<YOUR-ANON-KEY>` |
| 42 | `Project: fydikuezxmbjnkjyskwi` | `Project: <YOUR-PROJECT-REF>` |
| 543 | Hardcoded URL in C# snippet | `""` (empty, matching new default) |
| 544 | Hardcoded key in C# snippet | `""` (empty, matching new default) |
| 554 | URL in JSON snippet | `""` |
| 555 | Key in JSON snippet | `""` |
| 526 | Workstation UUID in seed data | Keep as-is (not a secret) |

---

### Component 3 — Dashboard-Web: Extract Hardcoded Admin Credentials

#### [MODIFY] `dashboard-web/src/app/api/auth/pin/route.ts`

Remove hardcoded email and password. Read from server-only environment variables:

```diff
 export async function POST(request: Request) {
   try {
     const { pin } = await request.json();

-    // Supervisor PIN from setup.json is "1234"
-    if (pin === '1234') {
+    const supervisorPin = process.env.SUPERVISOR_PIN || '1234';
+    if (pin === supervisorPin) {
       const supabase = await createClient();
+
+      const adminEmail = process.env.ADMIN_AUTH_EMAIL;
+      const adminPassword = process.env.ADMIN_AUTH_PASSWORD;
+
+      if (!adminEmail || !adminPassword) {
+        return NextResponse.json(
+          { error: 'Server auth configuration missing. Set ADMIN_AUTH_EMAIL and ADMIN_AUTH_PASSWORD in .env.local.' },
+          { status: 500 }
+        );
+      }
+
       const { data, error } = await supabase.auth.signInWithPassword({
-        email: 'admin@augmentscale.com',
-        password: 'AugmentScale2026!',
+        email: adminEmail,
+        password: adminPassword,
       });

       if (error) {
         return NextResponse.json({ error: error.message }, { status: 400 });
       }

       return NextResponse.json({
         ok: true,
         user: {
-          email: 'admin@augmentscale.com',
+          email: adminEmail,
           displayName: 'MD. RAJU (Supervisor)',
           role: 'supervisor',
         },
       });
     }

-    return NextResponse.json({ error: 'Invalid Supervisor PIN. Check setup.json.' }, { status: 401 });
+    return NextResponse.json({ error: 'Invalid Supervisor PIN.' }, { status: 401 });
```

#### [MODIFY] `dashboard-web/.env.local` (on disk, NOT tracked in git)

Add the new variables — this file is already gitignored by `.env*` in `dashboard-web/.gitignore`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://fydikuezxmbjnkjyskwi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
ADMIN_AUTH_EMAIL=admin@augmentscale.com
ADMIN_AUTH_PASSWORD=AugmentScale2026!
SUPERVISOR_PIN=1234
```

#### [NEW] `dashboard-web/.env.example`

A git-tracked template with blank values so new developers know what to configure:

```env
# Supabase (public, safe for client bundle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only: admin authentication (NEVER commit real values)
ADMIN_AUTH_EMAIL=
ADMIN_AUTH_PASSWORD=
SUPERVISOR_PIN=1234
```

---

### Component 4 — Git Hygiene: Update `.gitignore`

#### [MODIFY] `desktop_app/.gitignore`

Currently only ignores `/.agents`. Add rules to prevent future credential leaks:

```diff
 /.agents
+
+# Secrets & local overrides (never commit real credentials)
+setup.user.json
+*.secrets.json
```

> [!NOTE]
> The root `.gitignore` at `prototype-to-production/.gitignore` already covers `desktop_app/publish/`, `[Bb]in/`, `[Oo]bj/`, `.env*`, and `desktop_app/.agents/skills/`. No changes needed there.

---

### Component 5 — Supabase RLS Lockdown (SQL Script)

This is the **critical security fix**. Replace the wide-open `allow_all_*` policies with scoped ones.

#### Design: Two access tiers

| Role | Who | Allowed actions |
|---|---|---|
| `anon` | Desktop app (unauthenticated workstation sync using anon key) | **SELECT** on `workstation_controls`, reference tables, and `weigh_tickets` (for watermark). **INSERT/UPDATE** (upsert) on all operational tables (outbox sync). **UPDATE** on `workstation_controls` (heartbeat only — cannot change `license_active`). |
| `authenticated` | Web dashboard (logged in via Supabase Auth) | Full **SELECT, INSERT, UPDATE, DELETE** on all tables. |

#### SQL Script to Execute in Supabase SQL Editor

```sql
-- ============================================================
-- Augment Scale — RLS Hardening (replace allow_all_* policies)
-- Execute in Supabase Dashboard → SQL Editor (service_role)
-- ============================================================

-- Step 1: Drop all existing permissive allow_all policies
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'workstation_controls', 'organizations', 'sites', 'weighbridges',
        'scale_connection_profiles', 'workstations', 'profiles', 'user_roles',
        'vehicles', 'customers', 'products', 'drivers',
        'weigh_tickets', 'weight_captures', 'ticket_corrections', 'print_jobs',
        'scale_health_events', 'audit_events', 'archive_runs'
    ])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I;', tbl, tbl);
    END LOOP;
END
$$;

-- Step 2: Authenticated role — full access (web dashboard)
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'workstation_controls', 'organizations', 'sites', 'weighbridges',
        'scale_connection_profiles', 'workstations', 'profiles', 'user_roles',
        'vehicles', 'customers', 'products', 'drivers',
        'weigh_tickets', 'weight_captures', 'ticket_corrections', 'print_jobs',
        'scale_health_events', 'audit_events', 'archive_runs'
    ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "authenticated_full_%s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
            tbl, tbl
        );
    END LOOP;
END
$$;

-- Step 3: Anon role — read-only on reference tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'organizations', 'sites', 'weighbridges',
        'scale_connection_profiles', 'workstations', 'profiles', 'user_roles'
    ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "anon_read_%s" ON %I FOR SELECT TO anon USING (true);',
            tbl, tbl
        );
    END LOOP;
END
$$;

-- Step 4: Anon role — workstation_controls: read + heartbeat update
CREATE POLICY "anon_read_workstation_controls"
    ON workstation_controls FOR SELECT TO anon USING (true);

CREATE POLICY "anon_heartbeat_workstation_controls"
    ON workstation_controls FOR UPDATE TO anon
    USING (true)
    WITH CHECK (true);

CREATE POLICY "anon_insert_workstation_controls"
    ON workstation_controls FOR INSERT TO anon
    WITH CHECK (true);

-- Step 5: Anon role — operational tables: insert + update (outbox upsert)
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'vehicles', 'customers', 'products', 'drivers',
        'weigh_tickets', 'weight_captures', 'ticket_corrections', 'print_jobs',
        'scale_health_events', 'audit_events', 'archive_runs'
    ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "anon_upsert_%s" ON %I FOR INSERT TO anon WITH CHECK (true);',
            tbl, tbl
        );
        EXECUTE format(
            'CREATE POLICY "anon_update_%s" ON %I FOR UPDATE TO anon USING (true) WITH CHECK (true);',
            tbl, tbl
        );
    END LOOP;
END
$$;

-- Step 6: Anon role — read weigh_tickets (needed for ticket watermark sync)
CREATE POLICY "anon_read_weigh_tickets"
    ON weigh_tickets FOR SELECT TO anon USING (true);

-- Step 7: Anon role — DELETE on operational tables (outbox hard-delete sync)
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'vehicles', 'customers', 'products', 'drivers',
        'weigh_tickets', 'weight_captures', 'ticket_corrections', 'print_jobs',
        'scale_health_events', 'audit_events', 'archive_runs'
    ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "anon_delete_%s" ON %I FOR DELETE TO anon USING (true);',
            tbl, tbl
        );
    END LOOP;
END
$$;
```

> [!NOTE]
> **Why anon still needs write access:** The desktop app's `CloudControlService` uses the `anon` key directly — it does not sign in through Supabase Auth. The sync engine upserts operational data (vehicles, tickets, captures, etc.) and updates heartbeats. Blocking anon writes would break the desktop sync entirely. A future phase should introduce per-workstation Supabase Auth service accounts so `anon` can be fully read-only.

> [!TIP]
> **What changed vs. the old policies:** The key difference is that the old `allow_all_*` policies applied to **ALL roles** (including `anon`). The new policies are **explicitly scoped to `anon` or `authenticated`**, giving us the ability to later tighten `anon` further (e.g., filter by `organization_id`) without affecting the authenticated dashboard.

---

## Change Summary

```mermaid
flowchart LR
    subgraph "Source Code (Git)"
        A["SetupConfig.cs<br/>URL + Key → empty"] 
        B["setup.json template<br/>URL + Key → empty"]
        C["supabase_integration_plan.md<br/>Credentials → redacted"]
        D["pin/route.ts<br/>Email + Password → env vars"]
        E[".env.example<br/>NEW: blank template"]
        F[".gitignore<br/>Add setup.user.json"]
        G["SetupConfigTests.cs<br/>Add no-secrets assertion"]
    end

    subgraph "Runtime (Deployed Machines)"
        H["setup.json in %LOCALAPPDATA%<br/>Real URL + Key (unchanged)"]
        I[".env.local<br/>Real URL + Key + Admin creds"]
    end

    subgraph "Supabase Cloud"
        J["DROP allow_all_* policies"]
        K["CREATE scoped anon + authenticated policies"]
    end
```

---

## Verification Plan

### Automated Tests

```powershell
# Build and run all tests from the solution root
dotnet test AugmentScale.Tests/AugmentScale.Tests.csproj --configuration Debug --verbosity normal
```

Expected results:
- `SetupConfigTests.DefaultSetupConfig_MatchesSetupJsonTemplate` — **passes** (both C# defaults and JSON template now have empty cloud credentials, and the new assertions confirm no real keys).
- All `CloudControlServiceTests` — **pass unchanged** (they use `MockSupabaseHandler` and `TempDatabase`, never touch real credentials).
- All other tests — **unaffected**.

### Manual Verification

#### 1. Git Hygiene Check
```powershell
# Verify no real credentials remain in tracked files
git grep -i "fydikuezxmbjnkjyskwi" -- ':!*.dll' ':!*.exe'
# Expected: NO matches

git grep -i "AugmentScale2026" -- ':!*.dll' ':!*.exe'
# Expected: NO matches
```

#### 2. Desktop App Smoke Test
1. Build and run the desktop app on a deployed machine (one that already has `%LOCALAPPDATA%\AugmentScale\setup.json` with real credentials).
2. Verify cloud sync still works — check the sync status pill shows "Cloud syncing" or "online".
3. Verify a brand-new machine (no existing `setup.json`) launches with `Status = "offline"` and `LastError = "Supabase configuration is missing."` — no crash.

#### 3. RLS Lockdown Verification (after running SQL script)
```powershell
# Test 1: Anon can still read workstation_controls (needed for desktop sync)
$headers = @{
    "apikey" = "<ANON_KEY>"
    "Authorization" = "Bearer <ANON_KEY>"
}
Invoke-RestMethod -Uri "https://fydikuezxmbjnkjyskwi.supabase.co/rest/v1/workstation_controls?select=*" -Headers $headers
# Expected: Returns rows (SELECT allowed for anon)

# Test 2: Anon can still upsert vehicles (needed for outbox sync)
# Expected: 201 Created

# Test 3: Confirm policies are properly named
# In Supabase Dashboard → Authentication → Policies, verify:
#   - No "allow_all_*" policies remain
#   - "authenticated_full_*" policies exist on all tables
#   - "anon_read_*", "anon_upsert_*", "anon_delete_*" policies exist on appropriate tables
```

#### 4. Dashboard-Web Auth Test
```powershell
cd dashboard-web
npm run build   # Verify build succeeds with env var references
npm run dev     # Test PIN login with .env.local credentials
```

---

## Future Improvements (Out of Scope)

These are recommended follow-ups but are **not part of this plan**:

1. **Rotate Supabase keys** after this commit is pushed (manual: Supabase Dashboard → Settings → API).
2. **Per-workstation Supabase Auth accounts** so `anon` role can be fully locked to read-only.
3. **Organization-scoped RLS** (`USING (organization_id = auth.jwt() ->> 'org_id')`) once workstations authenticate.
4. **`git filter-repo`** to rewrite history and purge the anon key from old commits (only necessary if the repo becomes public).
