-- Augment Scale — automatic PDF archive run log (local only)
-- One row per baseline or daily report period. The row is the source of
-- truth for pending/succeeded/skipped/failed archive work; PDF files live
-- under the configured data directory in archives/.

CREATE TABLE IF NOT EXISTS archive_runs (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    kind            TEXT NOT NULL CHECK (kind IN ('baseline', 'daily')),
    period_start    TEXT NOT NULL,
    period_end      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'succeeded', 'skipped', 'failed')),
    file_path       TEXT,
    report_id       TEXT,
    integrity_hash  TEXT,
    error_message   TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_runs_period
    ON archive_runs(organization_id, kind, period_start, period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_runs_baseline
    ON archive_runs(organization_id) WHERE kind = 'baseline';
CREATE INDEX IF NOT EXISTS idx_archive_runs_due
    ON archive_runs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_archive_runs_recent
    ON archive_runs(organization_id, period_end DESC, created_at DESC);
