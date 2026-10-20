-- Augment Scale — local SQLite schema (Phase 1)
-- Mirrors Database_Design.md §Table Definitions. Cloud-only tables
-- (sync_changes, device_events) are intentionally excluded.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT,
    phone       TEXT,
    email       TEXT,
    logo_url    TEXT,
    settings    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    address         TEXT,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
);

CREATE TABLE IF NOT EXISTS weighbridges (
    id              TEXT PRIMARY KEY,
    site_id         TEXT NOT NULL REFERENCES sites(id),
    name            TEXT NOT NULL,
    max_capacity_kg INTEGER,
    min_division_kg INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
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
    stability_tolerance_kg  REAL NOT NULL,
    effective_from          TEXT NOT NULL,
    effective_to            TEXT,
    version                 INTEGER NOT NULL,
    approved_by             TEXT,
    change_reason           TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workstations (
    id                      TEXT PRIMARY KEY,
    organization_id         TEXT NOT NULL REFERENCES organizations(id),
    site_id                 TEXT NOT NULL REFERENCES sites(id),
    weighbridge_id          TEXT NOT NULL REFERENCES weighbridges(id),
    hostname                TEXT,
    device_key_thumbprint   TEXT,
    registered_at           TEXT NOT NULL,
    last_seen_at            TEXT,
    settings                TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    display_name    TEXT NOT NULL,
    first_name      TEXT,
    initials        TEXT,
    avatar_url      TEXT,
    color           TEXT,
    shift           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL REFERENCES profiles(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    site_id         TEXT REFERENCES sites(id),
    role            TEXT NOT NULL,
    granted_at      TEXT NOT NULL,
    granted_by      TEXT,
    revoked_at      TEXT,
    revoked_by      TEXT
);

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
    last_weighed_at         TEXT,
    last_tare_kg            REAL,
    registered_by           TEXT,
    updated_by              TEXT,
    row_version             INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at              TEXT,
    deleted_by              TEXT,
    deleted_reason          TEXT
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
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    code            TEXT,
    name            TEXT NOT NULL,
    description     TEXT,
    display_order   INTEGER,
    is_quick_pick   INTEGER NOT NULL DEFAULT 0,
    row_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    phone           TEXT,
    license_number  TEXT,
    row_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    deleted_by      TEXT
);

CREATE TABLE IF NOT EXISTS weigh_tickets (
    id                          TEXT PRIMARY KEY,
    organization_id             TEXT NOT NULL REFERENCES organizations(id),
    site_id                     TEXT NOT NULL REFERENCES sites(id),
    weighbridge_id              TEXT NOT NULL REFERENCES weighbridges(id),
    workstation_id              TEXT NOT NULL REFERENCES workstations(id),
    ticket_number               INTEGER NOT NULL,
    ticket_display_id           TEXT NOT NULL,
    direction                   TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'completed', 'voided')),
    vehicle_id                  TEXT REFERENCES vehicles(id),
    plate_number                TEXT NOT NULL,
    product_id                  TEXT REFERENCES products(id),
    product_name                TEXT,
    customer_id                 TEXT REFERENCES customers(id),
    customer_name               TEXT,
    driver_id                   TEXT REFERENCES drivers(id),
    driver_name                 TEXT,
    driver_phone                TEXT,
    challan                     TEXT,
    remarks                     TEXT,
    first_weight_kg             REAL,
    first_weight_type           TEXT CHECK (first_weight_type IN ('gross', 'tare')),
    first_weight_at             TEXT,
    first_weight_capture_id     TEXT,
    first_operator_id           TEXT REFERENCES profiles(id),
    first_operator_name         TEXT,
    second_weight_kg            REAL,
    second_weight_type          TEXT CHECK (second_weight_type IN ('gross', 'tare')),
    second_weight_at            TEXT,
    second_weight_capture_id    TEXT,
    second_operator_id          TEXT REFERENCES profiles(id),
    second_operator_name        TEXT,
    gross_weight_kg             REAL,
    tare_weight_kg              REAL,
    net_weight_kg               REAL,
    is_overridden               INTEGER NOT NULL DEFAULT 0,
    override_reason             TEXT,
    override_operator_id        TEXT,
    override_operator_name      TEXT,
    override_anomaly_details    TEXT,
    override_at                 TEXT,
    completed_at                TEXT,
    voided_at                   TEXT,
    voided_by                   TEXT,
    voided_reason               TEXT,
    row_version                 INTEGER NOT NULL DEFAULT 1,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    created_by                  TEXT NOT NULL,
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by                  TEXT NOT NULL,
    deleted_at                  TEXT,
    deleted_by                  TEXT,
    deleted_reason              TEXT,
    CHECK (deleted_at IS NULL OR status = 'pending')
);

CREATE TABLE IF NOT EXISTS weight_captures (
    id                          TEXT PRIMARY KEY,
    ticket_id                   TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id             TEXT NOT NULL REFERENCES organizations(id),
    capture_sequence            INTEGER NOT NULL,
    is_final                    INTEGER NOT NULL,
    weight_kg                   REAL NOT NULL,
    weight_raw_digits           TEXT NOT NULL,
    weight_sign                 TEXT NOT NULL,
    decimal_count               INTEGER NOT NULL,
    unit                        TEXT NOT NULL DEFAULT 'kg',
    raw_frame_hex               TEXT,
    checksum_valid              INTEGER NOT NULL,
    checksum_expected           TEXT,
    checksum_actual             TEXT,
    is_stable                   INTEGER NOT NULL,
    stability_variance          REAL,
    stability_window_ms         INTEGER,
    stability_sample_count      INTEGER,
    connection_profile_id       TEXT REFERENCES scale_connection_profiles(id),
    connection_profile_version  INTEGER,
    source                      TEXT NOT NULL,
    workstation_id              TEXT REFERENCES workstations(id),
    operator_id                 TEXT NOT NULL REFERENCES profiles(id),
    captured_at                 TEXT NOT NULL,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_corrections (
    id              TEXT PRIMARY KEY,
    ticket_id       TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    correction_type TEXT NOT NULL
                    CHECK (correction_type IN ('metadata_change', 'weight_reversal', 'void', 'reinstate')),
    field_changed   TEXT,
    old_value       TEXT,
    new_value       TEXT,
    reason          TEXT NOT NULL,
    requested_by    TEXT NOT NULL REFERENCES profiles(id),
    requested_at    TEXT NOT NULL,
    approved_by     TEXT,
    approved_at     TEXT,
    approval_status TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id                  TEXT PRIMARY KEY,
    ticket_id           TEXT NOT NULL REFERENCES weigh_tickets(id),
    organization_id     TEXT NOT NULL REFERENCES organizations(id),
    document_type       TEXT NOT NULL
                        CHECK (document_type IN ('first_weigh_slip', 'weighbridge_certificate')),
    is_reprint          INTEGER NOT NULL DEFAULT 0,
    copy_number         INTEGER NOT NULL DEFAULT 1,
    reprint_reason      TEXT,
    template_version    TEXT,
    printed_by          TEXT NOT NULL REFERENCES profiles(id),
    printed_at          TEXT NOT NULL,
    workstation_id      TEXT REFERENCES workstations(id),
    pdf_storage_path    TEXT,
    pdf_hash            TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scale_health_events (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    workstation_id  TEXT NOT NULL REFERENCES workstations(id),
    weighbridge_id  TEXT NOT NULL REFERENCES weighbridges(id),
    event_type      TEXT NOT NULL,
    details         TEXT,
    occurred_at     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
    id                    TEXT PRIMARY KEY,
    organization_id       TEXT NOT NULL REFERENCES organizations(id),
    entity_type           TEXT NOT NULL,
    entity_id             TEXT NOT NULL,
    action                TEXT NOT NULL,
    before_values         TEXT,
    after_values          TEXT,
    changed_fields        TEXT,
    actor_user_id         TEXT,
    actor_role            TEXT,
    actor_display_name    TEXT,
    source                TEXT NOT NULL DEFAULT 'workstation',
    workstation_id        TEXT,
    device_id             TEXT,
    client_event_id       TEXT,
    correlation_id        TEXT,
    client_captured_at    TEXT,
    server_recorded_at    TEXT,
    change_reason         TEXT,
    previous_event_hash   TEXT,
    event_hash            TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id              TEXT PRIMARY KEY,
    sequence        INTEGER NOT NULL UNIQUE,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
    base_row_version INTEGER,
    payload         TEXT NOT NULL,
    workstation_id  TEXT NOT NULL,
    operator_id     TEXT NOT NULL,
    reason          TEXT,
    device_signature TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'conflict')),
    server_response TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_cursors (
    id                    TEXT PRIMARY KEY,
    last_sync_change_id   INTEGER NOT NULL DEFAULT 0,
    last_synced_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offline_leases (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL REFERENCES profiles(id),
    workstation_id  TEXT NOT NULL REFERENCES workstations(id),
    role            TEXT NOT NULL,
    granted_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    revoked         INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Derived read model (identical in SQLite and PostgreSQL).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS ticket_history;
CREATE VIEW ticket_history AS
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
    (SELECT COUNT(*) FROM print_jobs p
     WHERE p.ticket_id = t.id
       AND p.document_type = CASE
           WHEN t.status IN ('completed', 'voided') THEN 'weighbridge_certificate'
           ELSE 'first_weigh_slip'
       END) AS print_count,
    (SELECT p.avatar_url FROM profiles p WHERE p.id = t.first_operator_id) AS first_operator_avatar,
    (SELECT p.avatar_url FROM profiles p WHERE p.id = t.second_operator_id) AS second_operator_avatar
FROM weigh_tickets t;

-- ---------------------------------------------------------------------------
-- Indexes (Database_Design.md §Indexes).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_status ON weigh_tickets(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_plate ON weigh_tickets(plate_number, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_vehicle ON weigh_tickets(vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON weigh_tickets(organization_id, ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON weigh_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_org_site ON weigh_tickets(organization_id, site_id);
CREATE INDEX IF NOT EXISTS idx_tickets_completed ON weigh_tickets(organization_id, completed_at)
    WHERE status = 'completed' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_voided ON weigh_tickets(organization_id, voided_at)
    WHERE status = 'voided';
CREATE INDEX IF NOT EXISTS idx_tickets_deleted ON weigh_tickets(organization_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_business_at
    ON weigh_tickets((COALESCE(completed_at, voided_at, deleted_at, created_at)));
CREATE INDEX IF NOT EXISTS idx_tickets_first_operator ON weigh_tickets(organization_id, first_operator_id);
CREATE INDEX IF NOT EXISTS idx_tickets_second_operator ON weigh_tickets(organization_id, second_operator_id);
CREATE INDEX IF NOT EXISTS idx_tickets_product ON weigh_tickets(organization_id, product_id)
    WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON weigh_tickets(organization_id, customer_id)
    WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate_unique
    ON vehicles(organization_id, plate_normalized);
CREATE INDEX IF NOT EXISTS idx_vehicles_active_last_weighed
    ON vehicles(organization_id, last_weighed_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_ticket ON print_jobs(ticket_id, printed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_copy
    ON print_jobs(ticket_id, document_type, copy_number);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at);

CREATE INDEX IF NOT EXISTS idx_captures_ticket ON weight_captures(ticket_id);
