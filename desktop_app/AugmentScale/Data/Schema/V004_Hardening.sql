-- Phase 1 hardening.
--
-- idx_outbox_entity backs the "has this entity been queued yet?" lookups used
-- when CloudControlService backfills un-queued ticket_corrections.
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox_events(entity_type, entity_id);

-- Sequence numbers are handed out from max(queued, allocated), so retention
-- pruning can never restart them. Written by DatabaseContext.InsertOutbox.
ALTER TABLE sync_cursors ADD COLUMN last_allocated_sequence INTEGER NOT NULL DEFAULT 0;
