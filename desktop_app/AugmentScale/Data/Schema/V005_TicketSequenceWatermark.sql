-- Track the highest known ticket number (local or cloud) to prevent conflicts across workstations.
ALTER TABLE sync_cursors ADD COLUMN last_allocated_ticket_number INTEGER NOT NULL DEFAULT 0;
