/**
 * Cloud Sync Engine & Health Telemetry
 * Simulates real-time outbox synchronization with Supabase Cloud.
 */
import { state } from './state.js';
import { showToast } from './toast.js';
import { IS_PRODUCTION, sendCommand } from './runtime.js';

export function initSyncEngine() {
  const syncPill = document.getElementById('sync-status-pill');
  const syncPopover = document.getElementById('sync-popover');
  const btnSyncNow = document.getElementById('btn-sync-now');

  if (syncPill && syncPopover) {
    syncPill.addEventListener('click', (e) => {
      e.stopPropagation();
      syncPopover.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!syncPopover.contains(e.target) && !syncPill.contains(e.target)) {
        syncPopover.classList.remove('open');
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && syncPopover.classList.contains('open')) {
        syncPopover.classList.remove('open');
      }
    });
  }

  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerSync(true);
    });
  }

  // Update relative time elapsed every second
  setInterval(updateSyncUI, 1000);

  // Background sync heartbeat every 30 seconds if healthy
  setInterval(() => {
    if (state.sync.isHealthy && !state.sync.syncInProgress) {
      triggerSync(false);
    }
  }, 30000);

  updateSyncUI();
}

export function updateSyncUI() {
  const syncPill = document.getElementById('sync-status-pill');
  const syncDot = document.getElementById('sync-status-dot');
  const syncIcon = document.getElementById('sync-status-icon');
  const syncText = document.getElementById('sync-status-text');
  const syncDetail = document.getElementById('sync-time-detail');

  const popoverBadge = document.getElementById('popover-status-badge');
  const popoverLastSync = document.getElementById('popover-last-sync');
  const popoverPending = document.getElementById('popover-pending-count');

  if (!syncPill) return;

  const now = new Date();
  const elapsedSec = Math.max(0, Math.floor((now - state.sync.lastSyncTimestamp) / 1000));
  let relativeStr = 'just now';
  if (elapsedSec >= 60) {
    const mins = Math.floor(elapsedSec / 60);
    relativeStr = `${mins}m ago`;
  } else if (elapsedSec >= 5) {
    relativeStr = `${elapsedSec}s ago`;
  }

  const timeStr = state.sync.lastSyncTimestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (state.sync.syncInProgress) {
    syncPill.className = 'telemetry-item sync-pill syncing';
    if (syncDot) syncDot.className = 'telemetry-dot pulse';
    if (syncIcon) syncIcon.textContent = '↻';
    if (syncText) syncText.textContent = 'Syncing...';
    if (syncDetail) syncDetail.textContent = 'connecting';
    return;
  }

  if (state.sync.isHealthy) {
    syncPill.className = 'telemetry-item sync-pill synced';
    if (syncDot) syncDot.className = 'telemetry-dot';
    if (syncIcon) syncIcon.textContent = '↑↓';
    if (syncText) syncText.textContent = 'Synced';
    if (syncDetail) syncDetail.textContent = relativeStr;

    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge synced';
      popoverBadge.textContent = '● Synced';
    }
    if (popoverLastSync) popoverLastSync.textContent = `${timeStr} (${relativeStr})`;
    if (popoverPending) popoverPending.textContent = `${state.sync.pendingQueue} items`;
  } else {
    syncPill.className = 'telemetry-item sync-pill failed';
    if (syncDot) syncDot.className = 'telemetry-dot red pulse';
    if (syncIcon) syncIcon.textContent = '⚠️';
    if (syncText) syncText.textContent = 'Sync Failed';
    if (syncDetail) {
      const qText = state.sync.pendingQueue > 0 ? `${state.sync.pendingQueue} pending` : 'Offline';
      syncDetail.textContent = `${qText} • ${relativeStr}`;
    }

    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge failed';
      popoverBadge.textContent = '✕ Sync Failed';
    }
    if (popoverLastSync) popoverLastSync.textContent = `Failed • Last: ${timeStr} (${relativeStr})`;
    if (popoverPending)
      popoverPending.textContent = `${state.sync.pendingQueue} items in local outbox`;
  }
}

export function triggerSync(isManual = false) {
  if (state.sync.syncInProgress) return;

  if (IS_PRODUCTION) {
    state.sync.syncInProgress = true;
    updateSyncUI();
    sendCommand('getSyncStatus')
      .then((status) => {
        state.sync.isHealthy = status?.isHealthy !== false;
        state.sync.pendingQueue = status?.pendingQueue || 0;
        state.sync.lastSyncTimestamp = status?.lastSyncTimestamp
          ? new Date(status.lastSyncTimestamp)
          : new Date();
        if (isManual) {
          showToast(
            state.sync.pendingQueue > 0
              ? `${state.sync.pendingQueue} events queued in the encrypted outbox`
              : 'Outbox is clear — no pending events',
            state.sync.pendingQueue > 0 ? 'warning' : 'success'
          );
        }
      })
      .catch((err) => {
        state.sync.isHealthy = false;
        if (isManual) {
          showToast(err?.message || 'Could not read outbox status', 'error');
        }
      })
      .finally(() => {
        state.sync.syncInProgress = false;
        updateSyncUI();
      });
    return;
  }

  state.sync.syncInProgress = true;
  updateSyncUI();

  setTimeout(() => {
    state.sync.syncInProgress = false;

    if (state.sync.isHealthy) {
      state.sync.lastSyncTimestamp = new Date();
      state.sync.pendingQueue = 0;
      updateSyncUI();
      if (isManual) {
        showToast('Cloud database synchronized successfully', 'success');
      }
    } else {
      updateSyncUI();
      if (isManual) {
        showToast(
          'Sync failed: Supabase Cloud unreachable. Events preserved in encrypted SQLite outbox.',
          'error'
        );
      }
    }
  }, 750);
}

