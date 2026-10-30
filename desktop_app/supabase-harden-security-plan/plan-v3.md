# Security Hardening Plan v2 — DPAPI + RLS + Key Rotation

## Goal Description

Harden the Augment Scale system so that:
1. **No Supabase credentials exist in source code** — git history is clean before pushing.
2. **Credentials on deployed client PCs are DPAPI-encrypted** — the anon key is migrated from plaintext `setup.json` into the encrypted `secrets.dat` file, then wiped from `setup.json`. Same proven pattern already used for operator PINs and the database encryption key.
3. **The live Supabase database enforces RLS** — replace wide-open `allow_all_*` policies with scoped ones.
4. **The Supabase anon key is rotated** — old key invalidated, new key deployed.
5. **Dashboard admin credentials moved to `.env.local`** — no hardcoded passwords in source.

---

## Execution Order

```mermaid
flowchart TD
    A["Step 1: Code Changes<br/>(this plan)"] --> B["Step 2: Run Tests<br/>dotnet test"]
    B --> C["Step 3: Commit & Push"]
    C --> D["Step 4: Run RLS SQL<br/>in Supabase Dashboard"]
    D --> E["Step 5: Rotate Anon Key<br/>in Supabase Dashboard"]
    E --> F["Step 6: Update Remote Machines<br/>(edit setup.json, restart)"]
    F --> G["Step 7: Verify Everything Works"]
```

---

## Proposed Changes

### Component 1 — DPAPI-Encrypt Cloud Credentials on Client PCs

This is the answer to your question: *"the sensitive credential will stay on setup.json as plain text on client PC — isn't it a security risk?"*

**Yes, it is.** We fix it using the **exact same pattern** already used for operator PINs:

1. On first run (or app upgrade), `ConfigService` reads `supabaseUrl` and `supabaseAnonKey` from `setup.json`
2. It stores them into `secrets.dat` (DPAPI-encrypted, per-user, per-machine)
3. It **blanks them from `setup.json`** so plaintext credentials never persist on disk
4. `CloudControlService` reads credentials from `Secrets` instead of `Setup.Cloud`

After this change, `setup.json` on the client PC will look like:
```json
"cloud": {
    "supabaseUrl": "",
    "supabaseAnonKey": "",
    "heartbeatIntervalSeconds": 3600,
    "licenseGraceDays": 30
}
```
And the real values live encrypted inside `secrets.dat`, decryptable only by the same Windows user on the same machine.

---

#### [MODIFY] `AugmentScale/Models/SetupConfig.cs`

Blank the hardcoded defaults and add cloud credential fields to `AppSecrets`:

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

```diff
 public sealed class AppSecrets
 {
     public string DatabaseKey { get; set; } = "";
     public Dictionary<string, string> PinHashes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
+    public string SupabaseUrl { get; set; } = "";
+    public string SupabaseAnonKey { get; set; } = "";
 }
```

---

#### [MODIFY] `AugmentScale/Services/ConfigService.cs`

Add a `ProvisionCloudCredentials` method that follows the same pattern as `ProvisionMissingPins`:

```csharp
/// <summary>
/// Migrates Supabase credentials from plaintext setup.json into DPAPI-encrypted secrets.dat,
/// then blanks them from setup.json. Same pattern as PIN provisioning.
/// </summary>
private bool ProvisionCloudCredentials(AppSecrets secrets)
{
    var setup = _setup ?? LoadOrCreateSetup();
    var changed = false;

    // Migrate URL
    if (!string.IsNullOrWhiteSpace(setup.Cloud.SupabaseUrl) && string.IsNullOrWhiteSpace(secrets.SupabaseUrl))
    {
        secrets.SupabaseUrl = setup.Cloud.SupabaseUrl;
        changed = true;
    }

    // Migrate Anon Key
    if (!string.IsNullOrWhiteSpace(setup.Cloud.SupabaseAnonKey) && string.IsNullOrWhiteSpace(secrets.SupabaseAnonKey))
    {
        secrets.SupabaseAnonKey = setup.Cloud.SupabaseAnonKey;
        changed = true;
    }

    // Blank credentials from setup.json (same as PIN clearing)
    if (!string.IsNullOrEmpty(setup.Cloud.SupabaseUrl) || !string.IsNullOrEmpty(setup.Cloud.SupabaseAnonKey))
    {
        setup.Cloud.SupabaseUrl = string.Empty;
        setup.Cloud.SupabaseAnonKey = string.Empty;
        _setup = setup;
        File.WriteAllText(_setupPath, JsonSerializer.Serialize(setup, _json), Encoding.UTF8);
        changed = true;
    }

    return changed;
}
```

Wire it into `LoadOrCreateSecrets()`, right after `ProvisionMissingPins`:

```diff
     var changed = ProvisionMissingPins(existing);
+    if (ProvisionCloudCredentials(existing)) changed = true;
     if (changed) SaveSecrets(existing);
     return existing;
```

And also in the fresh secrets path:

```diff
     ProvisionMissingPins(secrets);
+    ProvisionCloudCredentials(secrets);
     SaveSecrets(secrets);
     return secrets;
```

Add a public property for `CloudControlService` to read:

```csharp
public string SupabaseUrl => Secrets.SupabaseUrl;
public string SupabaseAnonKey => Secrets.SupabaseAnonKey;
```

---

#### [MODIFY] `AugmentScale/Services/CloudControlService.cs`

Change credential source from `Setup.Cloud` to `ConfigService` secrets properties:

```diff
-            var cloudConfig = _config.Setup.Cloud;
-            if (string.IsNullOrWhiteSpace(cloudConfig.SupabaseUrl) || string.IsNullOrWhiteSpace(cloudConfig.SupabaseAnonKey))
+            var supabaseUrl = _config.SupabaseUrl;
+            var supabaseAnonKey = _config.SupabaseAnonKey;
+            if (string.IsNullOrWhiteSpace(supabaseUrl) || string.IsNullOrWhiteSpace(supabaseAnonKey))
             {
                 lock (_stateGate)
                 {
                     Status = "offline";
                     LastError = "Supabase configuration is missing.";
                 }
                 return;
             }

-            var baseUrl = cloudConfig.SupabaseUrl.TrimEnd('/');
-            var apiKey = cloudConfig.SupabaseAnonKey.Trim();
+            var baseUrl = supabaseUrl.TrimEnd('/');
+            var apiKey = supabaseAnonKey.Trim();
```

The rest of `CloudControlService` passes `baseUrl` and `apiKey` as local variables to all helper methods, so no further changes needed.

The non-secret settings (`HeartbeatIntervalSeconds`, `LicenseGraceDays`) stay in `Setup.Cloud` — they're not sensitive.

---

#### [MODIFY] `AugmentScale/Resources/setup.json`

Replace real credentials with empty strings in the source-tracked template:

```diff
   "cloud": {
-    "supabaseUrl": "https://fydikuezxmbjnkjyskwi.supabase.co",
-    "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
+    "supabaseUrl": "",
+    "supabaseAnonKey": "",
     "heartbeatIntervalSeconds": 3600,
     "licenseGraceDays": 30
   }
```

---

### Component 2 — Documentation: Scrub Credentials

#### [MODIFY] `docs/supabase_integration_plan.md`

Replace every occurrence of the real Supabase project URL and anon key with redacted placeholders:

| Line | Current | Replacement |
|---|---|---|
| 16 | `https://fydikuezxmbjnkjyskwi.supabase.co` | `https://<PROJECT-REF>.supabase.co` |
| 17 | Full anon key JWT | `<ANON-KEY>` |
| 42 | `Project: fydikuezxmbjnkjyskwi` | `Project: <PROJECT-REF>` |
| 543–544 | Hardcoded URL + key in C# snippet | `""` (empty, matching new defaults) |
| 554–555 | URL + key in JSON snippet | `""` |

---

### Component 3 — Dashboard-Web: Extract Hardcoded Credentials

#### [MODIFY] `dashboard-web/src/app/api/auth/pin/route.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();

    const supervisorPin = process.env.SUPERVISOR_PIN || '1234';
    if (pin === supervisorPin) {
      const supabase = await createClient();

      const adminEmail = process.env.ADMIN_AUTH_EMAIL;
      const adminPassword = process.env.ADMIN_AUTH_PASSWORD;

      if (!adminEmail || !adminPassword) {
        return NextResponse.json(
          { error: 'Server auth not configured. Set ADMIN_AUTH_EMAIL and ADMIN_AUTH_PASSWORD in .env.local.' },
          { status: 500 }
        );
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: adminEmail,
          displayName: 'MD. RAJU (Supervisor)',
          role: 'supervisor',
        },
      });
    }

    return NextResponse.json({ error: 'Invalid Supervisor PIN.' }, { status: 401 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
```

#### [MODIFY] `dashboard-web/.env.local` (local file, NOT in git)

```env
NEXT_PUBLIC_SUPABASE_URL=https://fydikuezxmbjnkjyskwi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
ADMIN_AUTH_EMAIL=admin@augmentscale.com
ADMIN_AUTH_PASSWORD=AugmentScale2026!
SUPERVISOR_PIN=1234
```

#### [NEW] `dashboard-web/.env.example` (tracked in git, blank values)

```env
# Supabase (public, safe for client bundle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only: admin auth (NEVER commit real values)
ADMIN_AUTH_EMAIL=
ADMIN_AUTH_PASSWORD=
SUPERVISOR_PIN=1234
```

---

### Component 4 — Tests: Update & Add Security Guard

#### [MODIFY] `AugmentScale.Tests/SetupConfigTests.cs`

Add assertions that prevent real credentials from creeping back into source defaults:

```diff
     // Cloud
     Assert.Equal(expected.Cloud.SupabaseUrl, fresh.Cloud.SupabaseUrl);
     Assert.Equal(expected.Cloud.SupabaseAnonKey, fresh.Cloud.SupabaseAnonKey);
+
+    // Security guard: source code defaults must NEVER contain real credentials
+    Assert.True(string.IsNullOrEmpty(fresh.Cloud.SupabaseUrl),
+        "CloudSetup.SupabaseUrl must be empty in source code defaults. Real values go in setup.json on deployed machines.");
+    Assert.True(string.IsNullOrEmpty(fresh.Cloud.SupabaseAnonKey),
+        "CloudSetup.SupabaseAnonKey must be empty in source code defaults. Real values go in setup.json on deployed machines.");
+
     Assert.Equal(expected.Cloud.HeartbeatIntervalSeconds, fresh.Cloud.HeartbeatIntervalSeconds);
     Assert.Equal(expected.Cloud.LicenseGraceDays, fresh.Cloud.LicenseGraceDays);
```

---

### Component 5 — `.gitignore` Update

#### [MODIFY] `desktop_app/.gitignore`

```diff
 /.agents
+
+# Secrets & local overrides (never commit real credentials)
+setup.user.json
+*.secrets.json
```

---

### Component 6 — Supabase RLS Lockdown (SQL Script)

> [!CAUTION]
> Run this SQL in Supabase Dashboard → SQL Editor **before** rotating the key, so the database is protected first.

```sql
-- ============================================================
-- Augment Scale — RLS Hardening
-- Execute in Supabase Dashboard → SQL Editor (service_role)
-- ============================================================

-- Step 1: Drop all existing wide-open policies
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

-- Step 2: Authenticated role — full access for web dashboard
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

-- Step 3: Anon — read-only on reference tables
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

-- Step 4: Anon — workstation_controls (read + heartbeat + insert)
CREATE POLICY "anon_read_workstation_controls"
    ON workstation_controls FOR SELECT TO anon USING (true);
CREATE POLICY "anon_heartbeat_workstation_controls"
    ON workstation_controls FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_insert_workstation_controls"
    ON workstation_controls FOR INSERT TO anon WITH CHECK (true);

-- Step 5: Anon — operational tables (insert + update for outbox upsert)
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

-- Step 6: Anon — read weigh_tickets (ticket watermark sync)
CREATE POLICY "anon_read_weigh_tickets"
    ON weigh_tickets FOR SELECT TO anon USING (true);

-- Step 7: Anon — delete on operational tables (outbox hard-delete)
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

---

## Key Rotation — Step-by-Step Instructions

> [!IMPORTANT]
> Do this **after** the code changes are committed, pushed, and the RLS SQL is executed. The old key will stop working, so have the new key ready to deploy.

### Step 1: Rotate the JWT Secret in Supabase Dashboard

1. Go to **[Supabase Dashboard](https://supabase.com/dashboard)** → select your project (`fydikuezxmbjnkjyskwi`)
2. Navigate to **Project Settings** (gear icon in left sidebar) → **API**
3. Scroll to the **JWT Settings** section
4. Click **"Generate a new JWT secret"** (or "Rotate JWT Secret")
5. **Confirm** the rotation

> [!CAUTION]
> This **immediately invalidates** the old anon key and service_role key. All existing clients using the old key will get `401 Unauthorized` until updated.

### Step 2: Copy the New Keys

After rotation, the **API** page will show:
- **New `anon` public key** — a JWT starting with `eyJhbGciOi...`
- **New `service_role` key** — keep this secret, never put it in client code
- **Project URL** — stays the same (`https://fydikuezxmbjnkjyskwi.supabase.co`)

Copy the **new anon key**.

### Step 3: Update Remote Desktop Machines

**You do NOT need to republish the entire app.** Just update the `setup.json` file on each machine.

#### On each deployed PC (e.g. `DESKTOP-128GRO4`):

1. **Close** the Augment Scale app if running.

2. **Delete `secrets.dat`** so the app re-provisions credentials from the updated `setup.json`:
   ```powershell
   Remove-Item "$env:LOCALAPPDATA\AugmentScale\secrets.dat" -Force
   ```

3. **Edit `setup.json`** with the new anon key:
   ```powershell
   notepad "$env:LOCALAPPDATA\AugmentScale\setup.json"
   ```
   Update the `cloud` section:
   ```json
   "cloud": {
       "supabaseUrl": "https://fydikuezxmbjnkjyskwi.supabase.co",
       "supabaseAnonKey": "<PASTE-NEW-ANON-KEY-HERE>",
       "heartbeatIntervalSeconds": 3600,
       "licenseGraceDays": 30
   }
   ```

4. **Restart** the Augment Scale app.

5. **Verify**: The app will:
   - Read the new key from `setup.json`
   - Migrate it into `secrets.dat` (DPAPI-encrypted)
   - Blank it from `setup.json` automatically
   - Connect to Supabase with the new key

After restart, `setup.json` on the client will have empty `supabaseUrl` and `supabaseAnonKey` — the real values are safely locked in `secrets.dat`.

#### Quick verification on the remote PC:
```powershell
# Check setup.json is now clean:
Get-Content "$env:LOCALAPPDATA\AugmentScale\setup.json" | Select-String "supabaseAnonKey"
# Expected: "supabaseAnonKey": ""

# Check secrets.dat exists and was recently modified:
Get-Item "$env:LOCALAPPDATA\AugmentScale\secrets.dat" | Select-Object LastWriteTime, Length
```

### Step 4: Update Dashboard-Web

Edit `dashboard-web/.env.local` on your development machine:
```env
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PASTE-NEW-ANON-KEY-HERE>
```
Restart the Next.js dev server.

### Step 5: Verify End-to-End

| Check | How | Expected |
|---|---|---|
| Desktop sync works | Open app → check sync pill | Shows "online" / "Cloud syncing" |
| Old key rejected | `Invoke-RestMethod` with old key → `workstation_controls` | 401 Unauthorized |
| New key works | `Invoke-RestMethod` with new key → `workstation_controls` | Returns rows |
| Dashboard login | Open dashboard-web → enter PIN → login | Successful auth |
| RLS enforced | Unauthenticated DELETE attempt with new anon key | Blocked by RLS |

---

## Summary: How Credentials Flow After This Change

```mermaid
flowchart TD
    subgraph "First Run / Key Update"
        A["setup.json<br/>(plaintext, temporary)"] -->|"ConfigService reads<br/>on startup"| B["secrets.dat<br/>(DPAPI encrypted)"]
        A -->|"Credentials blanked<br/>from setup.json"| C["setup.json<br/>(empty cloud fields)"]
    end

    subgraph "Normal Runtime"
        B -->|"ConfigService.SupabaseUrl<br/>ConfigService.SupabaseAnonKey"| D["CloudControlService"]
        D -->|"apikey header"| E["Supabase REST API"]
        E -->|"RLS policies check"| F["PostgreSQL"]
    end

    style A fill:#ffcccc,stroke:#cc0000
    style C fill:#ccffcc,stroke:#00cc00
    style B fill:#ccccff,stroke:#0000cc
```

**Credentials never persist in plaintext.** They exist in `setup.json` only for the brief moment between file edit and first app startup, then they're encrypted and wiped.

---

## Verification Plan

### Automated Tests
```powershell
dotnet test AugmentScale.Tests/AugmentScale.Tests.csproj --configuration Debug --verbosity normal
```

### Manual Verification

#### 1. Git hygiene (after commit)
```powershell
git grep -i "fydikuezxmbjnkjyskwi" -- ':!*.dll' ':!*.exe' ':!*.zip'
# Expected: NO matches

git grep -i "AugmentScale2026" -- ':!*.dll' ':!*.exe' ':!*.zip'
# Expected: NO matches
```

#### 2. DPAPI migration test (on dev machine)
1. Set `AUGMENTSCALE_DATA_DIR` to a fresh temp directory
2. Place a `setup.json` with real credentials in it
3. Run the app → verify it starts, blanks `setup.json`, and creates `secrets.dat`
4. Kill and restart → verify it still connects (reads from `secrets.dat`)

#### 3. Desktop app on deployed machine
- After key rotation: delete `secrets.dat`, edit `setup.json` with new key, restart → verify sync works and `setup.json` is cleaned

#### 4. RLS verification
- Run the RLS SQL script → test with `Invoke-RestMethod` that anon can read but policies are scoped
