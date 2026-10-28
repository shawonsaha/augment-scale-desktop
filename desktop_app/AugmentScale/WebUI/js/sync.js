/**
 * Cloud Sync Engine & Health Telemetry
 * Real-time outbox synchronization and remote controls with Supabase Cloud.
 */
import { state } from './state.js';
import { showToast } from './toast.js';
import { sendCommand } from './runtime.js';
import { escapeHtml } from './utils.js';

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

  const btnArchiveRetry = document.getElementById('btn-archive-retry');
  if (btnArchiveRetry) {
    btnArchiveRetry.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btnArchiveRetry.disabled) return;
      btnArchiveRetry.disabled = true;
      try {
        const result = await sendCommand('retryArchive');
        const retried = Number(result?.retried) || 0;
        showToast(
          retried > 0
            ? `Retrying ${retried} failed archive${retried === 1 ? '' : 's'}…`
            : 'No failed archives to retry.',
          retried > 0 ? 'success' : 'warning'
        );
        triggerSync(false);
      } catch (err) {
        showToast(err?.message || 'Could not retry the archive', 'error');
      } finally {
        btnArchiveRetry.disabled = false;
      }
    });
  }

  // Update relative time elapsed every second
  setInterval(updateSyncUI, 1000);

  // Poll faster while the archive is working; otherwise use the normal heartbeat.
  scheduleHeartbeat();
  updateSyncUI();
  triggerSync(false);
}

let heartbeatTimer = null;

function archiveIsActive() {
  const archive = state.sync.archive;
  return archive?.state === 'processing' || (archive?.pendingCount || 0) > 0;
}

function scheduleHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    if (state.sync.isHealthy && !state.sync.syncInProgress) {
      triggerSync(false);
    }
    scheduleHeartbeat();
  }, archiveIsActive() ? 5000 : 30000);
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

  updateArchiveUI();

  const now = new Date();
  const elapsedSec = Math.max(0, Math.floor((now - state.sync.lastSyncTimestamp) / 1000));
  let relativeStr = 'just now';
  if (elapsedSec >= 60) {
    const mins = Math.floor(elapsedSec / 60);
    relativeStr = `${mins}m ago`;
  } else if (elapsedSec >= 5) {
    relativeStr = `${elapsedSec}s ago`;
  }

  if (state.sync.syncInProgress) {
    syncPill.className = 'telemetry-item sync-pill syncing';
    if (syncDot) syncDot.className = 'telemetry-dot pulse';
    if (syncIcon) syncIcon.textContent = '↻';
    if (syncText) syncText.textContent = 'Cloud syncing...';
    if (syncDetail) syncDetail.textContent = 'sending outbox';
    return;
  }

  if (!state.sync.licenseActive) {
    syncPill.className = 'telemetry-item sync-pill error';
    if (syncDot) syncDot.className = 'telemetry-dot danger';
    if (syncIcon) syncIcon.textContent = '⚠';
    if (syncText) syncText.textContent = 'License Expired';
    if (syncDetail) syncDetail.textContent = 'grace exceeded';
    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge is-error';
      popoverBadge.textContent = 'License Expired';
    }
  } else if (state.sync.cloudStatus === 'paused' || !state.sync.cloudSyncEnabled) {
    syncPill.className = 'telemetry-item sync-pill paused';
    if (syncDot) syncDot.className = 'telemetry-dot warning';
    if (syncIcon) syncIcon.textContent = '❚❚';
    if (syncText) syncText.textContent = 'Sync paused';
    if (syncDetail) syncDetail.textContent = 'remote control';
    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge is-warning';
      popoverBadge.textContent = 'Sync Paused';
    }
  } else if (state.sync.cloudStatus === 'online' || state.sync.cloudStatus === 'syncing') {
    syncPill.className = 'telemetry-item sync-pill online';
    if (syncDot) syncDot.className = 'telemetry-dot online';
    if (syncIcon) syncIcon.textContent = '☁';
    if (syncText) syncText.textContent = 'Cloud synced';
    if (syncDetail) {
      const queueText = state.sync.pendingQueue > 0
        ? `${state.sync.pendingQueue} pending`
        : 'up to date';
      const archiveText = archiveDetailText();
      syncDetail.textContent = archiveText ? `${queueText} • ${archiveText}` : queueText;
    }
    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge is-success';
      popoverBadge.textContent = 'Supabase Cloud';
    }
  } else {
    // Offline mode
    syncPill.className = 'telemetry-item sync-pill offline';
    if (syncDot) syncDot.className = 'telemetry-dot';
    if (syncIcon) syncIcon.textContent = '●';
    if (syncText) syncText.textContent = 'Cloud offline';
    if (syncDetail) {
      const queueText = state.sync.pendingQueue > 0
        ? `${state.sync.pendingQueue} pending`
        : 'offline grace';
      const archiveText = archiveDetailText();
      syncDetail.textContent = archiveText ? `${queueText} • ${archiveText}` : queueText;
    }
    if (popoverBadge) {
      popoverBadge.className = 'sync-popover-badge';
      popoverBadge.textContent = 'Offline Grace';
    }
  }

  if (popoverLastSync) {
    if (state.sync.lastCloudSyncTimestamp) {
      popoverLastSync.textContent = archiveTimestamp(state.sync.lastCloudSyncTimestamp);
    } else {
      popoverLastSync.textContent = state.sync.cloudStatus === 'offline' ? 'Offline (Grace active)' : 'Pending sync';
    }
  }

  if (popoverPending) {
    popoverPending.textContent = `${state.sync.pendingQueue} events in outbox`;
  }
}

function archiveDetailText() {
  const archive = state.sync.archive;
  if (!archive) return '';
  if (archive.state === 'processing') return 'archiving';
  if ((archive.failedCount || 0) > 0) return `${archive.failedCount} archive failed`;
  if ((archive.pendingCount || 0) > 0) return `${archive.pendingCount} archive queued`;
  if (archive.state === 'success') return 'archive current';
  if (archive.state === 'idle') return 'archive waiting';
  return '';
}

function archiveStateLabel(archive) {
  if (!archive) return 'Not available';
  if (archive.state === 'processing') {
    return `Archiving${archive.processingCount ? ` · ${archive.processingCount}` : '…'}`;
  }
  if (archive.state === 'pending') return `Queued · ${archive.pendingCount || 0}`;
  if (archive.state === 'failed') return `Failed · ${archive.failedCount || 0}`;
  if (archive.state === 'success') return 'Up to date';
  return 'Waiting for first run';
}

function archiveTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function updateArchiveUI() {
  const statusElement = document.getElementById('popover-archive-status');
  const lastElement = document.getElementById('popover-archive-last');
  const errorRow = document.getElementById('popover-archive-error-row');
  const errorElement = document.getElementById('popover-archive-error');
  const recentElement = document.getElementById('popover-archive-recent');
  const retryButton = document.getElementById('btn-archive-retry');
  if (!statusElement) return;

  const archive = state.sync.archive;
  statusElement.textContent = archiveStateLabel(archive);

  if (!archive) {
    if (lastElement) lastElement.textContent = '—';
    if (errorRow) errorRow.hidden = true;
    if (recentElement) {
      recentElement.innerHTML = '<span class="sync-archive-empty">No archive runs yet</span>';
    }
    if (retryButton) retryButton.hidden = true;
    return;
  }

  if (lastElement) {
    const kind = archive.lastSuccessKind ? ` · ${archive.lastSuccessKind}` : '';
    const period = archive.lastSuccessPeriodEnd ? ` · ${archive.lastSuccessPeriodEnd}` : '';
    lastElement.textContent = archive.lastSuccessAt
      ? `${archiveTimestamp(archive.lastSuccessAt)}${kind}${period}`
      : '—';
  }

  const error = String(archive.lastError || '').trim();
  if (errorRow) errorRow.hidden = !error;
  if (errorElement) errorElement.textContent = error;

  if (retryButton) {
    retryButton.hidden = (archive.failedCount || 0) <= 0;
  }

  if (!recentElement) return;
  const runs = Array.isArray(archive.recentRuns) ? archive.recentRuns : [];
  if (runs.length === 0) {
    recentElement.innerHTML = '<span class="sync-archive-empty">No archive runs yet</span>';
    return;
  }

  recentElement.innerHTML = runs
    .map((run) => {
      const failed = run.status === 'failed';
      return `
        <div class="sync-archive-run${failed ? ' is-failed' : ''}">
          <strong>${escapeHtml(run.kind || 'archive')} · ${escapeHtml(run.periodEnd || '—')}</strong>
          <span>${escapeHtml(run.status || 'pending')}</span>
        </div>
      `;
    })
    .join('');
}

export function applySyncStatus(status) {
  if (!status) return;
  state.sync.isHealthy = status.isHealthy !== false;
  state.sync.pendingQueue = status.pendingQueue || 0;
  state.sync.lastSyncTimestamp = status.lastSyncTimestamp
    ? new Date(status.lastSyncTimestamp)
    : new Date();
  state.sync.cloudStatus = status.cloudStatus || 'offline';
  state.sync.cloudSyncEnabled = status.cloudSyncEnabled !== false;
  state.sync.licenseActive = status.licenseActive !== false;
  state.sync.lastCloudSyncTimestamp = status.lastCloudSyncTimestamp
    ? new Date(status.lastCloudSyncTimestamp)
    : null;
  state.sync.archive = status.archive || null;
  updateSyncUI();
}

export function triggerSync(isManual = false) {
  if (state.sync.syncInProgress) return;

  state.sync.syncInProgress = true;
  updateSyncUI();

  const cmd = isManual ? sendCommand('syncNow') : sendCommand('getSyncStatus');
  cmd
    .then((status) => {
      applySyncStatus(status);

      if (isManual) {
        if (!state.sync.licenseActive) {
          showToast('License grace period expired — contact support', 'error');
        } else if (!state.sync.cloudSyncEnabled) {
          showToast('Cloud sync is paused remotely by administrator', 'warning');
        } else if (state.sync.cloudStatus === 'offline') {
          showToast(
            state.sync.pendingQueue > 0
              ? `Cloud offline — ${state.sync.pendingQueue} events queued safely in local outbox`
              : 'Cloud offline — operating normally in local grace period',
            'warning'
          );
        } else {
          showToast(
            state.sync.pendingQueue > 0
              ? `${state.sync.pendingQueue} events queued in outbox`
              : 'Cloud synced — all outbox events sent to Supabase',
            'success'
          );
        }
      }
    })
    .catch((err) => {
      state.sync.isHealthy = false;
      if (isManual) {
        showToast(err?.message || 'Could not sync with Supabase', 'error');
      }
    })
    .finally(() => {
      state.sync.syncInProgress = false;
      updateSyncUI();
      scheduleHeartbeat();
    });
}
