-- Add 'dead_letter' status to outbox_events check constraint.
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS outbox_events_new (
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
                    CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'conflict', 'dead_letter')),
    server_response TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO outbox_events_new (
    id, sequence, entity_type, entity_id, operation, base_row_version,
    payload, workstation_id, operator_id, reason, device_signature,
    status, server_response, attempts, last_attempt_at, created_at
)
SELECT
    id, sequence, entity_type, entity_id, operation, base_row_version,
    payload, workstation_id, operator_id, reason, device_signature,
    status, server_response, attempts, last_attempt_at, created_at
FROM outbox_events;

DROP TABLE outbox_events;

ALTER TABLE outbox_events_new RENAME TO outbox_events;

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status) WHERE status = 'pending';

PRAGMA foreign_keys=ON;
