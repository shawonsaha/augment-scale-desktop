# Supabase Cloud Sync & Workstation Controls — Implementation Plan (Finalized)

## Goal Description

Integrate **Supabase Cloud** into the **Augment Scale** WPF desktop app to establish:

1. **Always-On Remote Control Channel (Cloud $\to$ Local)**: On startup and on an hourly heartbeat, query `workstation_controls` to check license validity, software requirements, and remote commands.
2. **Offline-First License Grace**: Seamless 30-day offline grace period backed by local encrypted SQLite cache (`license_cache`).
3. **One-Way Operational Sync (Local $\to$ Cloud)**: Automatically push all 17 operational tables from local SQLite outbox to Supabase PostgreSQL, laying the foundation for a future live web **Admin Dashboard** and disaster recovery **DB Export/Import**.
4. **Non-Blocking Startup**: Desktop app launches instantly without waiting for network or Supabase.

---

## Confirmed Project Configuration

* **Supabase Project URL**: `https://fydikuezxmbjnkjyskwi.supabase.co`
* **Anon Public Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78`
* **Heartbeat Cadence**: `3600` seconds (1 hour)
* **License Grace Period**: `30` days

---

## User Review Required

> [!IMPORTANT]
> **Supabase SQL Setup**: You must execute the SQL script in **Phase 0** below inside your **Supabase Dashboard $\to$ SQL Editor** before running the app with sync enabled.

> [!IMPORTANT]
> **Local Database Migration**: The local encrypted SQLite database will auto-apply migration `V003_CloudSync.sql` on startup. No existing tables or data are deleted or modified destructively.

---

## Proposed Changes

### Phase 0 — Supabase Cloud Database Setup (SQL Script)

Run this complete script in your **Supabase SQL Editor** (`service_role`):

```sql
-- =====================================================
-- Augment Scale — Supabase Cloud Schema (Full Mirror)
-- Project: fydikuezxmbjnkjyskwi
-- =====================================================

-- ─── 1. SUPERADMIN CONTROL TABLE (Cloud → Workstation) ───────
CREATE TABLE IF NOT EXISTS workstation_controls (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workstation_id           TEXT NOT NULL UNIQUE,
    organization_id          TEXT NOT NULL,
    hostname                 TEXT,

    -- License & version enforcement
    license_active           BOOLEAN NOT NULL DEFAULT TRUE,
    license_expires_at       TIMESTAMPTZ,
    min_app_version          TEXT DEFAULT '1.0.0',

    -- Remote feature switches
    enable_cloud_sync        BOOLEAN NOT NULL DEFAULT TRUE,
    enable_cloud_backup      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Remote commands
    trigger_immediate_backup BOOLEAN NOT NULL DEFAULT FALSE,

    -- Heartbeat reported by workstation
    last_startup_at          TIMESTAMPTZ,
    last_heartbeat_at        TIMESTAMPTZ,
    app_version              TEXT,
    outbox_pending_count     INTEGER DEFAULT 0,

    -- Metadata
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. REFERENCE TABLES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT,
    phone       TEXT,
    email       TEXT,
    logo_url    TEXT,
    settings    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    address         TEXT,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weighbridges (
    id              TEXT PRIMARY KEY,
    site_id         TEXT NOT NULL REFERENCES sites(id),
    name            TEXT NOT NULL,
    max_capacity_kg INTEGER,
    min_division_kg INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scale_connection_profiles (
    id                      TEXT PRIMARY KEY,
    weighbridge_id          TEXT NOT NULL REFERENCES weighbridges(id),
    port_name               TEXT NOT NULL,
    baud_rate               INTEGER NOT NULL,
    data_bits               INTEGER NOT NULL,
    parity                  TEXT NOT NULL,
    stop_bits               INTEGER NOT NULL,
    protocol_format         TEXT NOT NULL,
    stability_window_ms     INTEGER NOT NULL,
    stability_tolerance_kg  DOUBLE PRECISION NOT NULL,
    effective_from          TIMESTAMPTZ NOT NULL,
    effective_to            TIMESTAMPTZ,
    version                 INTEGER NOT NULL,
    approved_by             TEXT,
    change_reason           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workstations (
    id                      TEXT PRIMARY KEY,
    organization_id         TEXT NOT NULL REFERENCES organizations(id),
    site_id                 TEXT NOT NULL REFERENCES sites(id),
    weighbridge_id          TEXT NOT NULL REFERENCES weighbridges(id),
    hostname                TEXT,
    device_key_thumbprint   TEXT,
    registered_at           TIMESTAMPTZ NOT NULL,
    last_seen_at            TIMESTAMPTZ,
    settings                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. USERS & ROLES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    display_name    TEXT NOT NULL,
    first_name      TEXT,
    initials        TEXT,
    avatar_url      TEXT,
    color           TEXT,
    shift           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL REFERENCES profiles(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    site_id         TEXT REFERENCES sites(id),
    role            TEXT NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL,
    granted_by      TEXT,
    revoked_at      TIMESTAMPTZ,
    revoked_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 4. ENTITIES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
    id                      TEXT PRIMARY KEY,
    organization_id         TEXT NOT NULL REFERENCES organizations(id),
    plate_number            TEXT NOT NULL,
    plate_normalized        TEXT NOT NULL,
    default_driver_name     TEXT,
    default_driver_phone    TEXT,
    default_client          TEXT,
    default_material        TEXT,
    notes                   TEXT,
    trip_count              INTEGER NOT NULL DEFAULT 0,
    last_weighed_at         TIMESTAMPTZ,
    last_tare_kg            DOUBLE PRECISION,
    registered_by           TEXT,
    updated_by              TEXT,
    row_version             INTEGER NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    deleted_by              TEXT,
    deleted_reason          TEXT,
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    customer_type   TEXT,
    row_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT,
    name            TEXT NOT NULL,
    description     TEXT,
    display_order   INTEGER,
    is_quick_pick   BOOLEAN NOT NULL DEFAULT FALSE,
    row_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drivers (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    phone           TEXT,
    license_number  TEXT,
    row_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 5. TICKETS & OPERATIONS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS weigh_tickets (
    id                          TEXT PRIMARY KEY,
    organization_id             TEXT NOT NULL REFERENCES organizations(id),
    site_id                     TEXT NOT NULL REFERENCES sites(id),
    weighbridge_id              TEXT NOT NULL REFERENCES weighbridges(id),
    workstation_id              TEXT NOT NULL REFERENCES workstations(id),
    ticket_number               INTEGER NOT NULL,
    ticket_display_id           TEXT NOT NULL,
    direction                   TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending',
    vehicle_id                  TEXT,
    plate_number                TEXT NOT NULL,
    product_id                  TEXT,
    product_name                TEXT,
    customer_id                 TEXT,
    customer_name               TEXT,
    driver_id                   TEXT,
    driver_name                 TEXT,
    driver_phone                TEXT,
    challan                     TEXT,
    remarks                     TEXT,
    first_weight_kg             DOUBLE PRECISION,
    first_weight_type           TEXT,
    first_weight_at             TIMESTAMPTZ,
    first_weight_capture_id     TEXT,
    first_operator_id           TEXT,
    first_operator_name         TEXT,
    second_weight_kg            DOUBLE PRECISION,
    second_weight_type          TEXT,
    second_weight_at            TIMESTAMPTZ,
    second_weight_capture_id    TEXT,
    second_operator_id          TEXT,
    second_operator_name        TEXT,
    gross_weight_kg             DOUBLE PRECISION,
    tare_weight_kg              DOUBLE PRECISION,
    net_weight_kg               DOUBLE PRECISION,
    is_overridden               BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason             TEXT,
    override_operator_id        TEXT,
    override_operator_name      TEXT,
    override_anomaly_details    TEXT,
    override_at                 TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    voided_at                   TIMESTAMPTZ,
    voided_by                   TEXT,
    voided_reason               TEXT,
    row_version                 INTEGER NOT NULL DEFAULT 1,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  TEXT NOT NULL,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                  TEXT NOT NULL,
    deleted_at                  TIMESTAMPTZ,
    deleted_by                  TEXT,
    deleted_reason              TEXT,
    synced_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weight_captures (
    id                          TEXT PRIMARY KEY,
    ticket_id                   TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id             TEXT NOT NULL REFERENCES organizations(id),
    capture_sequence            INTEGER NOT NULL,
    is_final                    BOOLEAN NOT NULL,
    weight_kg                   DOUBLE PRECISION NOT NULL,
    weight_raw_digits           TEXT NOT NULL,
    weight_sign                 TEXT NOT NULL,
    decimal_count               INTEGER NOT NULL,
    unit                        TEXT NOT NULL DEFAULT 'kg',
    raw_frame_hex               TEXT,
    checksum_valid              BOOLEAN NOT NULL,
    checksum_expected           TEXT,
    checksum_actual             TEXT,
    is_stable                   BOOLEAN NOT NULL,
    stability_variance          DOUBLE PRECISION,
    stability_window_ms         INTEGER,
    stability_sample_count      INTEGER,
    connection_profile_id       TEXT,
    connection_profile_version  INTEGER,
    source                      TEXT NOT NULL,
    workstation_id              TEXT,
    operator_id                 TEXT NOT NULL,
    captured_at                 TIMESTAMPTZ NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_corrections (
    id              TEXT PRIMARY KEY,
    ticket_id       TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    correction_type TEXT NOT NULL,
    field_changed   TEXT,
    old_value       TEXT,
    new_value       TEXT,
    reason          TEXT NOT NULL,
    requested_by    TEXT NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL,
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    approval_status TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id                  TEXT PRIMARY KEY,
    ticket_id           TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id     TEXT NOT NULL REFERENCES organizations(id),
    document_type       TEXT NOT NULL,
    is_reprint          BOOLEAN NOT NULL DEFAULT FALSE,
    copy_number         INTEGER NOT NULL DEFAULT 1,
    reprint_reason      TEXT,
    template_version    TEXT,
    printed_by          TEXT NOT NULL,
    printed_at          TIMESTAMPTZ NOT NULL,
    workstation_id      TEXT,
    pdf_storage_path    TEXT,
    pdf_hash            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scale_health_events (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    workstation_id  TEXT NOT NULL REFERENCES workstations(id),
    weighbridge_id  TEXT NOT NULL REFERENCES weighbridges(id),
    event_type      TEXT NOT NULL,
    details         TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
    id                    TEXT PRIMARY KEY,
    organization_id       TEXT NOT NULL REFERENCES organizations(id),
    entity_type           TEXT NOT NULL,
    entity_id             TEXT NOT NULL,
    action                TEXT NOT NULL,
    before_values         JSONB,
    after_values          JSONB,
    changed_fields        TEXT,
    actor_user_id         TEXT,
    actor_role            TEXT,
    actor_display_name    TEXT,
    source                TEXT NOT NULL DEFAULT 'workstation',
    workstation_id        TEXT,
    device_id             TEXT,
    client_event_id       TEXT,
    correlation_id        TEXT,
    client_captured_at    TIMESTAMPTZ,
    server_recorded_at    TIMESTAMPTZ,
    change_reason         TEXT,
    previous_event_hash   TEXT,
    event_hash            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archive_runs (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    kind            TEXT NOT NULL,
    period_start    TEXT NOT NULL,
    period_end      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    file_path       TEXT,
    report_id       TEXT,
    integrity_hash  TEXT,
    error_message   TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 6. DASHBOARD DERIVED VIEW ───────────────────────────────
CREATE OR REPLACE VIEW ticket_history AS
SELECT
    t.*,
    CASE
        WHEN t.deleted_at IS NOT NULL THEN 'deleted'
        WHEN t.status = 'voided' THEN 'voided'
        WHEN t.status = 'completed' THEN 'completed'
        ELSE 'pending'
    END AS status_display,
    CASE
        WHEN t.second_weight_capture_id IS NOT NULL OR t.second_weight_kg IS NOT NULL
            THEN 'complete'
        ELSE 'first'
    END AS stage,
    COALESCE(t.completed_at, t.voided_at, t.deleted_at, t.created_at) AS business_at,
    COALESCE(t.voided_at, t.deleted_at, t.completed_at, t.created_at) AS last_status_at,
    (SELECT COUNT(*) FROM print_jobs p WHERE p.ticket_id = t.id) AS print_count,
    (SELECT p.avatar_url FROM profiles p WHERE p.id = t.first_operator_id) AS first_operator_avatar,
    (SELECT p.avatar_url FROM profiles p WHERE p.id = t.second_operator_id) AS second_operator_avatar
FROM weigh_tickets t;

-- ─── 7. INDEXES ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_org ON weigh_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON weigh_tickets(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_plate ON weigh_tickets(plate_number, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON weigh_tickets(organization_id, ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON weigh_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_captures_ticket ON weight_captures(ticket_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(organization_id, plate_normalized);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at);

-- ─── 8. ROW LEVEL SECURITY (RLS) ─────────────────────────────
ALTER TABLE workstation_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE weighbridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_connection_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workstations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE weigh_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_runs ENABLE ROW LEVEL SECURITY;

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
        EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL USING (true) WITH CHECK (true);', tbl, tbl);
    END LOOP;
END
$$;

-- ─── 9. AUTO-UPDATE TIMESTAMP TRIGGER ────────────────────────
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON workstation_controls;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON workstation_controls
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ─── 10. SEED WORKSTATION CONTROL RECORD ─────────────────────
INSERT INTO workstation_controls (
    workstation_id, organization_id, hostname,
    license_active, enable_cloud_sync, enable_cloud_backup
) VALUES (
    '8dec0dd3-e2e6-f2a8-c200-85d144127b7f',
    'ef3b13c5-5c1f-9720-df3f-7f1c7951e755',
    'DESKTOP-128GRO4',
    TRUE, TRUE, FALSE
)
ON CONFLICT (workstation_id) DO NOTHING;
```

---

### Phase 1 — Configuration (`SetupConfig.cs` & `setup.json`)

#### [MODIFY] `AugmentScale/Models/SetupConfig.cs`
Add `CloudSetup` to `SetupConfig`:
```csharp
public sealed class CloudSetup
{
    public string SupabaseUrl { get; set; } = "https://fydikuezxmbjnkjyskwi.supabase.co";
    public string SupabaseAnonKey { get; set; } = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78";
    public int HeartbeatIntervalSeconds { get; set; } = 3600; // 1 hour
    public int LicenseGraceDays { get; set; } = 30; // 30 days
}
```

#### [MODIFY] `AugmentScale/Resources/setup.json`
Update template with real credentials:
```json
"cloud": {
  "supabaseUrl": "https://fydikuezxmbjnkjyskwi.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78",
  "heartbeatIntervalSeconds": 3600,
  "licenseGraceDays": 30
}
```

---

### Phase 2 — Local SQLite Schema Migration V003

#### [NEW] `AugmentScale/Data/Schema/V003_CloudSync.sql`
```sql
CREATE TABLE IF NOT EXISTS license_cache (
    id                       TEXT PRIMARY KEY DEFAULT 'current',
    license_active           INTEGER NOT NULL DEFAULT 1,
    license_expires_at       TEXT,
    min_app_version          TEXT DEFAULT '1.0.0',
    enable_cloud_sync        INTEGER NOT NULL DEFAULT 0,
    enable_cloud_backup      INTEGER NOT NULL DEFAULT 0,
    trigger_immediate_backup INTEGER NOT NULL DEFAULT 0,
    bootstrap_completed      INTEGER NOT NULL DEFAULT 0,
    last_cloud_check_at      TEXT,
    last_cloud_success_at    TEXT,
    cached_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE sync_cursors ADD COLUMN last_cloud_sync_at TEXT;
ALTER TABLE sync_cursors ADD COLUMN last_cloud_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_cursors ADD COLUMN cloud_status TEXT NOT NULL DEFAULT 'offline';
```

#### [MODIFY] `AugmentScale/Data/SchemaMigrator.cs`
Execute `V003_CloudSync.sql` when version < 3.

---

### Phase 3 — Core Engine (`CloudControlService.cs`)

#### [NEW] `AugmentScale/Services/CloudControlService.cs`
Implement:
* **Always-on heartbeat & control read** (runs every 3600 seconds, never dies).
* **Local license caching & 30-day grace period enforcement**.
* **One-way outbox streaming** (reads `outbox_events` and upserts to Supabase).
* **One-time reference bootstrap**: uploads initial `organizations`, `sites`, `weighbridges`, `scale_connection_profiles`, `workstations`, `profiles`, and `user_roles` so foreign keys in Supabase are satisfied.

---

### Phase 4 — Desktop App Wiring & Bridge

* **`App.xaml.cs`**: Instantiate `CloudControlService`, assign to `BridgeService.Cloud`, call `Start()` non-blockingly, and safely dispose on exit.
* **`BridgeService.cs`**: Add commands `getCloudStatus` and `syncNow`.
* **`SyncStatusService.cs`**: Return `CloudStatus`, `CloudSyncEnabled`, and `LicenseActive` in `SyncStatusDto`.
* **`WebUI/js/sync.js`**: Update UI telemetry badge to show `"Cloud syncing"`, `"Sync paused"`, or `"Cloud offline"`.

---

## Verification Plan

### Automated Build & Unit Tests
```powershell
dotnet test AugmentScale.Tests
dotnet build AugmentScale
```

### Manual Cloud Channel & Sync Verification
1. Run Phase 0 SQL script in Supabase Dashboard.
2. Launch desktop app with internet active:
   * Verify app loads instantly.
   * Check app log: `"Cloud: Controls read OK — license=True, sync=True"`.
   * Check Supabase `workstation_controls`: Verify `last_heartbeat_at`, `app_version`, and `hostname` are updated.
   * Check Supabase tables: Verify reference rows (org, site, profiles, vehicles, tickets) appear in Supabase.
3. Superadmin Remote Toggles:
   * In Supabase: Change `enable_cloud_sync = false`. Click "Sync Now" in desktop app $\to$ confirm sync pauses.
   * Change `enable_cloud_sync = true` $\to$ confirm outbox resumes uploading.
   * Change `trigger_immediate_backup = true` $\to$ confirm workstation detects and clears flag.
4. Offline Test:
   * Disconnect network $\to$ launch desktop app $\to$ verify launches instantly within 30-day grace period without crashing.
