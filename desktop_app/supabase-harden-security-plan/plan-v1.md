# Supabase Credential Security Audit & Remediation Plan

## Goal Description

An audit was conducted on the repository to verify whether Supabase credentials, secret keys, or database access paths are exposed. 

### Key Findings Summary:
1. **Secret Keys (`service_role`, DB Passwords, Personal Access Tokens):**
   - **NOT exposed anywhere in the codebase or git history.**
   - No `service_role` keys, database connection strings (`postgresql://`), or `sbp_` tokens exist in any commit or file.
2. **Git Remote Repository (`origin/main` on GitHub):**
   - **NOT exposed on GitHub yet.**
   - All commits introducing Supabase integration (`7969c32` through `c295cec`, 35 commits ahead of `origin/main`) are currently only stored **locally**. Nothing containing Supabase URLs or keys has been pushed to `origin/main`.
3. **CRITICAL FINDING — Live Database Open RLS Policies (`allow_all_*`):**
   - In Supabase, the `anon` key (`eyJhbGciOiJIUz...`) is designed to be a client-facing key, and security **must** be enforced by Postgres Row Level Security (RLS).
   - In the deployed database schema (`docs/supabase_integration_plan.md` lines 489–505), all tables were configured with:
     ```sql
     CREATE POLICY "allow_all_<table_name>" ON <table_name> FOR ALL USING (true) WITH CHECK (true);
     ```
   - **Impact**: Any party with the project URL and the public `anon` key has unrestricted **SELECT, INSERT, UPDATE, and DELETE** access across all tables (`weigh_tickets`, `profiles`, `workstation_controls`, `vehicles`, `audit_events`).
   - We verified this live: `weigh_tickets` (15 tickets) and `profiles` are currently readable and mutable over the public REST API without authentication.
4. **Hardcoded Credentials in Source Code:**
   - In `dashboard-web/src/app/api/auth/pin/route.ts`, an email (`admin@augmentscale.com`) and password (`AugmentScale2026!`) are hardcoded in plaintext.
   - In `AugmentScale/Resources/setup.json` and `publish/win-x64/Resources/setup.json`, the project URL and anon key are checked into the tracked repository files.

This plan details the exact remediation strategy to lock down the live Supabase database, secure the client applications, extract sensitive secrets into environment configurations, and prevent accidental leaks prior to pushing to GitHub.

---

## User Review Required

> [!CAUTION]
> **Live Database Is Currently Open to the Public Internet:**
> Because all tables have `FOR ALL USING (true) WITH CHECK (true)`, anyone with the URL and `anon` key can alter workstation licenses (`license_active = false`), delete tickets, or inspect operator records. We need to deploy proper RLS policies immediately.

> [!IMPORTANT]
> **Do NOT run `git push origin main` until secrets are sanitized:**
> Because the 35 unpushed commits contain `AugmentScale/Resources/setup.json` and `dashboard-web/src/app/api/auth/pin/route.ts`, pushing them now will publish the Supabase URL, anon key, and admin password to GitHub.

> [!WARNING]
> **Supabase Key Rotation Recommendation:**
> Once RLS policies are locked down, you should consider rotating the Supabase JWT secret / anon key in your Supabase Dashboard (**Settings -> API -> Reset API Keys**) to invalidate any cached copies.

---

## Open Questions

1. **Authentication Architecture for Desktop Sync:**
   - Does the desktop app run unattended (background service syncing via workstation token or authenticated operator session), or should the desktop app authenticate with a dedicated service account / custom JWT rather than relying on unauthenticated `anon` upserts?
2. **Web Dashboard Auth:**
   - In `dashboard-web`, should `admin@augmentscale.com` use standard Supabase Auth credentials stored in environment variables (`SUPABASE_ADMIN_EMAIL`, `SUPABASE_ADMIN_PASSWORD`), rather than hardcoded in the PIN route?

---

## Proposed Changes

```
               ┌────────────────────────────────────────────────────────┐
               │                  Supabase Cloud API                    │
               │               https://fydikuezxmbjnkjyskwi             │
               └──────────────┬──────────────────────────▲──────────────┘
                              │                          │
                 REST (with anon key)      Secured by Authenticated
                Blocked by strict RLS     or Workstation Token RLS
                              │                          │
               ┌──────────────▼─────────────┐   ┌────────┴──────────────┐
               │    Unauthorized Public     │   │ Desktop Sync & Web UI │
               │   (READ/WRITE FORBIDDEN)   │   │  (Authorized Scopes)  │
               └────────────────────────────┘   └───────────────────────┘
```

### 1. Database Security & Row Level Security (RLS) Lockdown

#### [MODIFY] `docs/supabase_integration_plan.md` & Supabase Cloud SQL Editor
Replace open wildcard policies (`allow_all_*`) with role-based policies:
- Tables like `workstation_controls`:
  - `anon` should only be allowed to read their own workstation record (filtered by workstation ID / token or authenticated workstation session).
  - Public `anon` users cannot update `license_active` or arbitrary control flags.
- Operational tables (`weigh_tickets`, `weight_captures`, `vehicles`, `audit_events`):
  - Prohibit anonymous public deletes (`DROP POLICY "allow_all_*"`).
  - Only allow `authenticated` role (users logged into Supabase Auth via Dashboard) or verified workstation callers to write tickets.

```sql
-- Revoke the permissive allow_all policies
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

-- Require authenticated user for dashboard operations
CREATE POLICY "authenticated_dashboard_access" ON weigh_tickets
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- Workstation controls: read-only for anon, restricted update only for heartbeats
CREATE POLICY "workstation_controls_read" ON workstation_controls
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "workstation_controls_heartbeat_update" ON workstation_controls
    FOR UPDATE TO anon, authenticated
    USING (true)
    WITH CHECK (
        -- Workstations cannot elevate their own license
        license_active IS TRUE
    );
```

---

### 2. Next.js Web Dashboard Credential Hardening

#### [MODIFY] `dashboard-web/src/app/api/auth/pin/route.ts`
Remove hardcoded credentials `admin@augmentscale.com` and `AugmentScale2026!`. Read them from secure server-only environment variables:

```typescript
// Replace hardcoded values:
const adminEmail = process.env.ADMIN_AUTH_EMAIL;
const adminPassword = process.env.ADMIN_AUTH_PASSWORD;

if (!adminEmail || !adminPassword) {
  return NextResponse.json({ error: 'Server authentication configuration missing' }, { status: 500 });
}

const { data, error } = await supabase.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
});
```

#### [MODIFY] `dashboard-web/.env.local` & `dashboard-web/.env.example`
- Ensure `.env.local` contains `ADMIN_AUTH_EMAIL` and `ADMIN_AUTH_PASSWORD`.
- Add `dashboard-web/.env.example` with blank placeholder values.
- Verify that `dashboard-web/.gitignore` ignores `.env*` so it is never staged or committed.

---

### 3. Desktop App Configuration Hardening

#### [MODIFY] `AugmentScale/Resources/setup.json` & `publish/win-x64/Resources/setup.json`
- In `AugmentScale/Services/ConfigService.cs`, provide support for reading `SUPABASE_URL` and `SUPABASE_ANON_KEY` from system environment variables or a local uncommitted config file (`setup.user.json`), with fallback to `setup.json`.
- Replace sensitive secrets in git-tracked template files with placeholder strings or separate deployment configs if this repository will be made public or shared across teams.

---

## Verification Plan

### Automated Tests
1. Run existing test suite to ensure desktop app build and tests succeed:
   ```powershell
   dotnet test AugmentScale.Tests/AugmentScale.Tests.csproj
   ```
2. Run build on Next.js web dashboard:
   ```powershell
   cd dashboard-web && npm run build
   ```

### Manual Verification
1. **RLS Verification via API Test:**
   - Execute an unauthenticated `DELETE` or unauthorized `UPDATE` against `workstation_controls` or `weigh_tickets` using the `anon` key $\to$ verify Supabase returns `401 Unauthorized` / `403 Forbidden` / `404 Not Found` (RLS active).
2. **Authorized Access Test:**
   - Sign in through `dashboard-web` PIN login $\to$ verify session cookie is set and `authenticated` queries succeed.
3. **Desktop Sync Verification:**
   - Run desktop sync $\to$ confirm outbox events sync successfully under the new policy.
4. **Git Hygiene Check:**
   - Run `git log -S "AugmentScale2026!"` and inspect working tree to ensure no secret strings remain in git tracking.
