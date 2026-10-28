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
