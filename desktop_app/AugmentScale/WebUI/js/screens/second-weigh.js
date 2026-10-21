/**
 * Screen 4: Second Weight Workflow
 * Single-ticket workflow, shared HUD, net weight calculation, tare/gross inversion anomaly detection,
 * operator reason override, deferred certificate preview, safe discard dialog.
 */
import { state, pendingTickets } from '../state.js';
import { showScreen } from '../router.js';
import {
  formatDateTime12H,
  formatShortDateWithSeconds,
  formatElapsed,
  calcNet,
} from '../utils.js';
import hapticAudio from '../audio.js';
import { showToast } from '../toast.js';
import { openPrintSlipModal } from '../print.js';
import { mountHud } from '../hud.js';
import { openReasonDialog } from '../reason-dialog.js';
import { openConfirmDialog } from '../confirm-dialog.js';

const LOCK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

export function initSecondWeighScreen() {
  // Mount shared HUD
  const hudSlot = document.getElementById('second-weigh-hud-slot');
  if (hudSlot) mountHud(hudSlot);

  // Back button
  const backBtn = document.getElementById('sw-btn-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (state.secondWeigh.capturedWeight !== null) {
        openDiscardWeightDialog();
      } else {
        showScreen('dashboard-screen');
      }
    });
  }

  // Capture / Recapture button
  const captureBtn = document.getElementById('sw-btn-capture');
  if (captureBtn) {
    captureBtn.addEventListener('click', doCaptureSecond);
  }

  // Operator Override dialog
  function handleOperatorOverride() {
    const t = state.secondWeigh.selectedTicket;
    if (!t) return;
    const { gross, tare, net } = calcNet(
      t.firstWeightType,
      t.firstWeight,
      state.secondWeigh.capturedWeight !== null
        ? state.secondWeigh.capturedWeight
        : state.currentLiveWeight
    );
    const netFormatted = `${net < 0 ? '−' : ''}${Math.abs(net).toLocaleString('en-US')} kg`;
    openReasonDialog({
      id: 'override-reason-modal',
      title: 'Override anyway?',
      metaHtml: `Ticket #${t.id} · ${t.truckNo} · ${t.material}<br>First: ${tare.toLocaleString('en-US')} kg · Second: ${gross.toLocaleString('en-US')} kg · Net: ${netFormatted}`,
      prompt: 'Why are you overriding it?',
      reasons: [
        'Truck returned empty or unloaded',
        'Fuel, driver or equipment changed between weighs',
        'First weight was recorded incorrectly',
        'Scale reading verified manually',
        'Approved by supervisor',
        'Other',
      ],
      confirmLabel: 'Confirm Override',
      confirmTone: 'warning',
      stateFlag: '_overrideDialogOpen',
      onConfirm: (reason) => {
        state.secondWeigh.isOverridden = true;
        state.secondWeigh.overrideReason = reason;
        state.secondWeigh.overrideTimestamp = new Date().toISOString();
        state.secondWeigh.overrideOperator = state.activeOperator?.name || 'Unknown Operator';
        state.secondWeigh.overrideAnomalyDetails = {
          type: 'Gross ≤ Tare',
          gross,
          tare,
          net,
        };
        showToast(`Anomaly override confirmed: ${reason}`, 'warning');
        updateSecondWeighPreview(
          state.secondWeigh.capturedWeight !== null
            ? state.secondWeigh.capturedWeight
            : state.currentLiveWeight
        );
      },
    });
  }

  const statusOverrideBtn = document.getElementById('sw-status-override-btn');
  if (statusOverrideBtn) {
    statusOverrideBtn.addEventListener('click', handleOperatorOverride);
  }

  // Preview button (deferred save: opens preview modal without writing data)
  const finalizeBtn = document.getElementById('sw-btn-finalize');
  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', () => {
      const t = state.secondWeigh.selectedTicket;
      if (!t) return;

      // Re-check that ticket is still pending (handles concurrent deletion / sync removal)
      if (!pendingTickets.some((item) => item.id === t.id)) {
        showToast('This ticket is no longer pending or was already processed.', 'error');
        showScreen('dashboard-screen');
        return;
      }

      // Signed net: an overridden inversion stays negative on the slip instead of hiding behind Math.abs
      const { gross, tare, net } = calcNet(
        t.firstWeightType,
        t.firstWeight,
        state.secondWeigh.capturedWeight
      );
      const secondTimestamp = state.secondWeigh.capturedTimestamp || formatDateTime12H(new Date());
      const secondOperatorName = state.activeOperator ? state.activeOperator.name : t.firstOperator;

      // Show Weighbridge Certificate Preview (Data save deferred until Confirm & Print)
      openPrintSlipModal({
        ticketId: t.id,
        truckNo: t.truckNo,
        driver: t.driver,
        material: t.material,
        client: t.client,
        direction: t.weightType,
        grossWeight: gross,
        tareWeight: tare,
        netWeight: net,
        firstTime: t.firstWeightTime,
        secondTime: secondTimestamp,
        firstOperator: t.firstOperator,
        secondOperator: secondOperatorName,
        operator: secondOperatorName,
        phone: t.phone || '',
        challan: t.challan || '',
        remarks: t.remarks || '',
        isDeferredCommit: true,
        override: state.secondWeigh.isOverridden
          ? {
              reason: state.secondWeigh.overrideReason,
              operator: state.secondWeigh.overrideOperator,
              timestamp: state.secondWeigh.overrideTimestamp,
              anomalyDetails: state.secondWeigh.overrideAnomalyDetails,
            }
          : null,
      });
    });
  }

  setInterval(() => {
    if (state.currentScreen !== 'second-weigh-screen') return;
    updateTicketWaiting(state.secondWeigh.selectedTicket);
  }, 30000);
}

function updateTicketWaiting(ticket) {
  if (!ticket) return;

  const shortDate = formatShortDateWithSeconds(ticket.firstWeightTime);
  const elapsed =
    formatElapsed(ticket.createdAt || ticket.firstWeightTime) || ticket.timeElapsed || '';
  const waitingStr = elapsed ? ` · Waiting ${elapsed.replace(/\s*ago\b/i, '')}` : '';

  const ticketTimeTextEl = document.getElementById('sw-ticket-time-text');
  if (ticketTimeTextEl) {
    ticketTimeTextEl.textContent = `${shortDate}${waitingStr}`;
    ticketTimeTextEl.title = `Audit timestamp: ${ticket.firstWeightTime}`;
  }

  const firstDetail = document.getElementById('sw-first-detail');
  if (firstDetail) {
    firstDetail.textContent = `Recorded at ${shortDate}${waitingStr}`;
    firstDetail.title = `Audit timestamp: ${ticket.firstWeightTime}`;
  }
}

/**
 * Discard Captured Weight Confirmation Dialog
 */
export function openDiscardWeightDialog() {
  openConfirmDialog({
    id: 'discard-weight-modal',
    stateFlag: '_discardDialogOpen',
    title: 'Discard captured weight?',
    message: 'The second weight you captured has not been finalized. Going back will discard it.',
    keepLabel: 'Keep working',
    confirmLabel: 'Discard and go back',
    onConfirm: () => {
      state.secondWeigh.capturedWeight = null;
      state.secondWeigh.isOverridden = false;
      state.secondWeigh.overrideReason = null;
      state.secondWeigh.overrideTimestamp = null;
      state.secondWeigh.overrideOperator = null;
      state.secondWeigh.overrideAnomalyDetails = null;
      showScreen('dashboard-screen');
    },
  });
}

function doCaptureSecond() {
  if (!state.isScaleConnected || !state.isScaleStable) {
    showToast('Cannot capture while scale is in motion', 'error');
    return;
  }
  const t = state.secondWeigh.selectedTicket;
  if (!t) {
    showToast('Please select a pending ticket first', 'error');
    return;
  }

  const isRecapture = state.secondWeigh.capturedWeight !== null;

  // Recapturing or capturing clears previous override state
  state.secondWeigh.isOverridden = false;
  state.secondWeigh.overrideReason = null;
  state.secondWeigh.overrideTimestamp = null;
  state.secondWeigh.overrideOperator = null;
  state.secondWeigh.overrideAnomalyDetails = null;

  state.secondWeigh.capturedWeight = state.currentLiveWeight;
  state.secondWeigh.capturedTime = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  state.secondWeigh.capturedTimestamp = formatDateTime12H(new Date());

  updateSecondWeighPreview(state.secondWeigh.capturedWeight);

  const { isAnomaly } = calcNet(t.firstWeightType, t.firstWeight, state.secondWeigh.capturedWeight);

  if (isAnomaly) {
    showToast(
      'Payload Anomaly Detected (Gross ≤ Tare). Override required to preview certificate.',
      'error'
    );
  } else {
    showToast(
      isRecapture
        ? `Second weight recaptured: ${state.secondWeigh.capturedWeight.toLocaleString('en-US')} kg`
        : `Second weight locked: ${state.secondWeigh.capturedWeight.toLocaleString('en-US')} kg`,
      'success'
    );
  }

  if (hapticAudio) hapticAudio.playCapture();
}

export function openSecondWeighWithTicket(ticket) {
  // Entry guard: check if ticket is valid and still in pendingTickets
  if (!ticket || !ticket.id || !pendingTickets.some((t) => t.id === ticket.id)) {
    showToast('Invalid or already completed ticket', 'error');
    showScreen('dashboard-screen');
    return;
  }

  state.secondWeigh.selectedTicket = ticket;
  state.secondWeigh.capturedWeight = null;
  state.secondWeigh.isOverridden = false;
  state.secondWeigh.overrideReason = null;
  state.secondWeigh.overrideTimestamp = null;
  state.secondWeigh.overrideOperator = null;
  state.secondWeigh.overrideAnomalyDetails = null;

  showScreen('second-weigh-screen');

  // Populate ticket card (prominent Ticket # & plate, wrapping for driver & material)
  const ticketIdEl = document.getElementById('sw-ticket-id');
  const plateEl = document.getElementById('sw-plate');
  const driverEl = document.getElementById('sw-driver');
  const materialEl = document.getElementById('sw-material');

  if (ticketIdEl) ticketIdEl.textContent = `#${ticket.id}`;
  if (plateEl) plateEl.textContent = ticket.truckNo;
  if (driverEl) {
    driverEl.textContent = ticket.driver;
    driverEl.title = ticket.driver;
  }
  if (materialEl) {
    const matText = [ticket.material, ticket.client].filter(Boolean).join(' • ');
    materialEl.textContent = matText;
    materialEl.title = matText;
  }

  // Populate first weight card
  const firstLabel = document.getElementById('sw-first-label');
  const firstValue = document.getElementById('sw-first-value');
  const secondLabel = document.getElementById('sw-second-label');

  const isFirstGross = ticket.firstWeightType === 'Gross';
  if (firstLabel) firstLabel.textContent = isFirstGross ? 'FIRST · GROSS' : 'FIRST · TARE';
  if (secondLabel) secondLabel.textContent = isFirstGross ? 'SECOND · TARE' : 'SECOND · GROSS';
  if (firstValue) firstValue.textContent = ticket.firstWeight.toLocaleString('en-US');

  updateTicketWaiting(ticket);

  // Previous weigh data for this truck (helps spot bad tares)
  renderTruckHistory(ticket, isFirstGross);

  // Initial preview calculation with current live weight
  updateSecondWeighPreview(state.currentLiveWeight);
}

function renderTruckHistory(ticket, isFirstGross) {
  setHistoryRow(
    'sw-first-history',
    isFirstGross ? 'Last gross' : 'Last tare',
    isFirstGross ? ticket.lastGross : ticket.lastTare,
    ticket.lastWeighAt
  );
  setHistoryRow(
    'sw-second-history',
    isFirstGross ? 'Last tare' : 'Last gross',
    isFirstGross ? ticket.lastTare : ticket.lastGross,
    ticket.lastWeighAt
  );
  setHistoryRow('sw-net-history', 'Last payload', ticket.lastPayload, ticket.lastWeighAt);
}

function setHistoryRow(id, label, value, date) {
  const row = document.getElementById(id);
  if (!row) return;

  if (!Number.isFinite(value)) {
    row.hidden = true;
    return;
  }

  row.hidden = false;
  const labelEl = row.querySelector('.sw-history-label');
  const valueEl = row.querySelector('.sw-history-value');
  const dateEl = row.querySelector('.sw-history-date');

  if (labelEl) labelEl.textContent = label;
  if (valueEl) valueEl.textContent = `${value.toLocaleString('en-US')} kg`;
  if (dateEl) {
    dateEl.textContent = date || '';
    dateEl.hidden = !date;
  }
}

export function updateSecondWeighPreview(weight) {
  const t = state.secondWeigh.selectedTicket;
  if (!t) return;

  const captured = state.secondWeigh.capturedWeight !== null;
  const overridden = state.secondWeigh.isOverridden;
  const isStable = state.isScaleStable;
  const isConnected = state.isScaleConnected;

  const currentWeight = captured ? state.secondWeigh.capturedWeight : weight;
  const hasReading = Number.isFinite(currentWeight);
  const { gross, tare, net, isAnomaly } = hasReading
    ? calcNet(t.firstWeightType, t.firstWeight, currentWeight)
    : { gross: null, tare: null, net: null, isAnomaly: false };

  // 1. Elements
  const cardSecond = document.getElementById('sw-card-second');
  const secondVal = document.getElementById('sw-second-value');
  const secondBadge = document.getElementById('sw-second-badge');
  const secondDetail = document.getElementById('sw-second-detail');

  const cardNet = document.getElementById('sw-card-net');
  const netVal = document.getElementById('sw-net-value');
  const netBadge = document.getElementById('sw-net-badge');
  const netDetail = document.getElementById('sw-net-detail');

  const statusStrip = document.getElementById('sw-status-strip');
  const statusIcon = document.getElementById('sw-status-icon');
  const statusText = document.getElementById('sw-status-text');
  const statusSubtext = document.getElementById('sw-status-subtext');
  const statusOverrideBtn = document.getElementById('sw-status-override-btn');

  const capBtn = document.getElementById('sw-btn-capture');
  const capText = document.getElementById('sw-btn-capture-text');
  const capKbd = document.getElementById('sw-btn-capture-kbd');

  const finalizeBtn = document.getElementById('sw-btn-finalize');
  const finalizeHint = document.getElementById('sw-finalize-hint');

  // 2. Weight numbers & detail lines
  if (secondVal) {
    secondVal.textContent = Number.isFinite(currentWeight)
      ? currentWeight.toLocaleString('en-US')
      : '------';
  }

  if (netVal) {
    netVal.textContent = hasReading
      ? `${net < 0 ? '−' : ''}${Math.abs(net).toLocaleString('en-US')}`
      : '------';
  }

  if (netDetail) {
    netDetail.textContent = hasReading
      ? `Gross ${gross.toLocaleString('en-US')} − Tare ${tare.toLocaleString('en-US')}`
      : 'No live reading — scale offline';
  }

  // 3. State-based visual system (States: A, B [normal, zero, negative], C, D, E)
  if (!captured) {
    // ─── UNCAPTURED STATES (Live Preview) ───
    if (!isStable || !isConnected) {
      // ═══════════════════════════════════════════════════════════════
      // STATE A: Unstable scale reading
      // ═══════════════════════════════════════════════════════════════
      if (cardSecond) cardSecond.className = 'sw-weigh-card sw-weigh-card--second sw-card-live';
      if (secondBadge) {
        secondBadge.textContent = '● LIVE';
        secondBadge.className = 'sw-chip sw-chip--live is-unstable';
      }
      if (secondVal) secondVal.className = 'sw-weight-digits is-unstable';
      if (secondDetail) secondDetail.textContent = 'Live preview — capture to lock';

      if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net sw-card-net-preview';
      if (netBadge) {
        netBadge.textContent = 'PREVIEW';
        netBadge.className = 'sw-chip sw-chip--preview is-unstable';
      }
      if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero is-unstable';

      if (statusStrip) {
        statusStrip.className = 'sw-status-strip sw-status-strip--unstable';
        statusStrip.setAttribute('role', 'status');
      }
      if (statusIcon) {
        statusIcon.textContent = '⏳';
        statusIcon.style.color = '';
      }
      if (statusText) statusText.textContent = 'Waiting for a stable reading…';
      if (statusSubtext) statusSubtext.style.display = 'none';
      if (statusOverrideBtn) {
        statusOverrideBtn.hidden = true;
        statusOverrideBtn.style.display = 'none';
      }

      // Action bar
      if (capBtn) {
        capBtn.className = 'sw-action-btn sw-action-btn--capture btn-primary-capture';
        capBtn.disabled = true;
        capBtn.title = 'Waiting for scale to stabilize before capture';
      }
      if (capText) capText.textContent = 'Waiting for stable…';
      if (capKbd) capKbd.style.opacity = '0.5';

      if (finalizeBtn) {
        finalizeBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
        finalizeBtn.disabled = true;
        finalizeBtn.title = 'Capture second weight before previewing';
      }
      if (finalizeHint) finalizeHint.textContent = '';
    } else {
      // ═══════════════════════════════════════════════════════════════
      // STATE B: Stable reading, nothing captured yet
      // ═══════════════════════════════════════════════════════════════
      if (cardSecond) cardSecond.className = 'sw-weigh-card sw-weigh-card--second sw-card-live';
      if (secondBadge) {
        secondBadge.textContent = '● LIVE';
        secondBadge.className = 'sw-chip sw-chip--live';
      }
      if (secondVal) secondVal.className = 'sw-weight-digits';
      if (secondDetail) secondDetail.textContent = 'Live preview — capture to lock';

      if (net === 0) {
        // STATE B-zero-net: Zero net payload warning (amber)
        if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net sw-card-net-warning';
        if (netBadge) {
          netBadge.textContent = 'CHECK';
          netBadge.className = 'sw-chip sw-chip--warning';
        }
        if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

        if (statusStrip) {
          statusStrip.className = 'sw-status-strip sw-status-strip--warning';
          statusStrip.setAttribute('role', 'status');
        }
        if (statusIcon) {
          statusIcon.textContent = '⚠';
          statusIcon.style.color = 'var(--color-warning)';
        }
        if (statusText) statusText.textContent = 'Net payload is zero — check before capturing.';
        if (statusSubtext) statusSubtext.style.display = 'none';
      } else if (net < 0) {
        // STATE B-negative-net: Negative net payload danger (red)
        if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net anomaly';
        if (netBadge) {
          netBadge.textContent = 'CHECK';
          netBadge.className = 'sw-chip sw-chip--anomaly';
        }
        if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

        if (statusStrip) {
          statusStrip.className = 'sw-status-strip sw-status-strip--anomaly';
          statusStrip.setAttribute('role', 'status');
        }
        if (statusIcon) {
          statusIcon.textContent = '⚠';
          statusIcon.style.color = 'var(--color-danger)';
        }
        if (statusText) {
          statusText.textContent =
            'Net payload is negative — gross is lighter than tare. Check truck and first weight before capturing.';
        }
        if (statusSubtext) statusSubtext.style.display = 'none';
      } else {
        // STATE B-normal: Normal positive net preview
        if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net sw-card-net-preview';
        if (netBadge) {
          netBadge.textContent = 'PREVIEW';
          netBadge.className = 'sw-chip sw-chip--preview';
        }
        if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

        if (statusStrip) {
          statusStrip.className = 'sw-status-strip sw-status-strip--stable';
          statusStrip.setAttribute('role', 'status');
        }
        if (statusIcon) {
          statusIcon.textContent = '●';
          statusIcon.style.color = 'var(--color-success)';
        }
        if (statusText) statusText.textContent = 'Stable. Press Space to capture.';
        if (statusSubtext) statusSubtext.style.display = 'none';
      }

      if (statusOverrideBtn) {
        statusOverrideBtn.hidden = true;
        statusOverrideBtn.style.display = 'none';
      }

      // Action bar: Capture is PRIMARY (Space still captures in zero/negative preview)
      if (capBtn) {
        capBtn.className = 'sw-action-btn sw-action-btn--capture btn-primary-capture';
        capBtn.disabled = false;
        capBtn.title = 'Capture live reading (Spacebar)';
      }
      if (capText) capText.textContent = 'Capture';
      if (capKbd) capKbd.style.opacity = '1';

      if (finalizeBtn) {
        finalizeBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
        finalizeBtn.disabled = true;
        finalizeBtn.title = 'Capture second weight before previewing';
      }
      if (finalizeHint) finalizeHint.textContent = '';
    }
  } else {
    // ─── CAPTURED STATES (Weight locked) ───
    if (statusIcon) statusIcon.style.color = '';
    const formattedCaptureTime = formatShortDateWithSeconds(state.secondWeigh.capturedTimestamp);

    if (isAnomaly && !overridden) {
      // ═══════════════════════════════════════════════════════════════
      // STATE D: Captured, anomaly found (Gross ≤ Tare)
      // ═══════════════════════════════════════════════════════════════
      if (cardSecond) cardSecond.className = 'sw-weigh-card sw-weigh-card--second sw-card-locked';
      if (secondBadge) {
        secondBadge.innerHTML = `${LOCK_SVG}LOCKED`;
        secondBadge.className = 'sw-chip sw-chip--locked';
      }
      if (secondVal) secondVal.className = 'sw-weight-digits';
      if (secondDetail) secondDetail.textContent = `Captured at ${formattedCaptureTime}`;

      if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net anomaly';
      if (netBadge) {
        netBadge.textContent = 'CHECK';
        netBadge.className = 'sw-chip sw-chip--anomaly';
      }
      if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

      if (statusStrip) {
        statusStrip.className = 'sw-status-strip sw-status-strip--anomaly';
        statusStrip.setAttribute('role', 'alert');
      }
      if (statusIcon) statusIcon.textContent = '⚠';
      if (statusText) statusText.textContent = 'Metrological Safety Alert: Gross Weight ≤ Tare Weight';
      if (statusSubtext) {
        statusSubtext.style.display = 'block';
        statusSubtext.textContent = `Gross (${gross.toLocaleString('en-US')} kg) is not greater than Tare (${tare.toLocaleString('en-US')} kg). Negative/zero payload detected.`;
      }
      if (statusOverrideBtn) {
        statusOverrideBtn.hidden = false;
        statusOverrideBtn.style.display = 'inline-flex';
      }

      // Action bar: Preview blocked, Capture is secondary "Recapture"
      if (capBtn) {
        capBtn.className = 'sw-action-btn sw-action-btn--capture btn-secondary-recapture';
        capBtn.disabled = !isStable || !isConnected;
        capBtn.title = 'Recapture reading (Spacebar)';
      }
      if (capText) capText.textContent = 'Recapture';
      if (capKbd) capKbd.style.opacity = '1';

      if (finalizeBtn) {
        finalizeBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
        finalizeBtn.disabled = true;
        finalizeBtn.title = 'Blocked by Metrological Safety Alert: Gross ≤ Tare';
      }
      if (finalizeHint) finalizeHint.textContent = '';
    } else if (isAnomaly && overridden) {
      // ═══════════════════════════════════════════════════════════════
      // STATE E: Anomaly overridden by operator
      // ═══════════════════════════════════════════════════════════════
      if (cardSecond) cardSecond.className = 'sw-weigh-card sw-weigh-card--second sw-card-locked';
      if (secondBadge) {
        secondBadge.innerHTML = `${LOCK_SVG}LOCKED`;
        secondBadge.className = 'sw-chip sw-chip--locked';
      }
      if (secondVal) secondVal.className = 'sw-weight-digits';
      if (secondDetail) secondDetail.textContent = `Captured at ${formattedCaptureTime}`;

      if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net sw-card-net-ready';
      if (netBadge) {
        netBadge.textContent = 'OVERRIDDEN';
        netBadge.className = 'sw-chip sw-chip--warning';
      }
      if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

      if (statusStrip) {
        statusStrip.className = 'sw-status-strip sw-status-strip--authorized';
        statusStrip.setAttribute('role', 'status');
      }
      if (statusIcon) statusIcon.textContent = '✓';
      if (statusText) statusText.textContent = `Overridden: ${state.secondWeigh.overrideReason || 'Operator override'}`;
      if (statusSubtext) {
        statusSubtext.style.display = 'block';
        statusSubtext.textContent = 'Anomaly acknowledged. You may now preview and print certificate.';
      }
      if (statusOverrideBtn) {
        statusOverrideBtn.hidden = true;
        statusOverrideBtn.style.display = 'none';
      }

      // Action bar: Preview is PRIMARY, Capture is secondary
      if (capBtn) {
        capBtn.className = 'sw-action-btn sw-action-btn--capture btn-secondary-recapture';
        capBtn.disabled = !isStable || !isConnected;
        capBtn.title = 'Recapture reading (Spacebar)';
      }
      if (capText) capText.textContent = 'Recapture';
      if (capKbd) capKbd.style.opacity = '1';

      if (finalizeBtn) {
        finalizeBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-primary';
        finalizeBtn.disabled = false;
        finalizeBtn.title = 'Preview certificate (Enter)';
      }
      if (finalizeHint) finalizeHint.textContent = '';
    } else {
      // ═══════════════════════════════════════════════════════════════
      // STATE C: Captured, clean reading (no anomaly)
      // ═══════════════════════════════════════════════════════════════
      if (cardSecond) cardSecond.className = 'sw-weigh-card sw-weigh-card--second sw-card-locked';
      if (secondBadge) {
        secondBadge.innerHTML = `${LOCK_SVG}LOCKED`;
        secondBadge.className = 'sw-chip sw-chip--locked';
      }
      if (secondVal) secondVal.className = 'sw-weight-digits';
      if (secondDetail) secondDetail.textContent = `Captured at ${formattedCaptureTime}`;

      if (cardNet) cardNet.className = 'sw-weigh-card sw-weigh-card--net sw-card-net-ready';
      if (netBadge) {
        netBadge.textContent = 'READY';
        netBadge.className = 'sw-chip sw-chip--ready';
      }
      if (netVal) netVal.className = 'sw-weight-digits sw-weight-digits--hero';

      if (statusStrip) {
        statusStrip.className = 'sw-status-strip sw-status-strip--success';
        statusStrip.setAttribute('role', 'status');
      }
      if (statusIcon) statusIcon.textContent = '✓';
      if (statusText) statusText.textContent = 'Weight locked. No anomalies. Press Enter to preview certificate.';
      if (statusSubtext) statusSubtext.style.display = 'none';
      if (statusOverrideBtn) {
        statusOverrideBtn.hidden = true;
        statusOverrideBtn.style.display = 'none';
      }

      // Action bar: Preview is PRIMARY, Capture is secondary
      if (capBtn) {
        capBtn.className = 'sw-action-btn sw-action-btn--capture btn-secondary-recapture';
        capBtn.disabled = !isStable || !isConnected;
        capBtn.title = 'Recapture reading (Spacebar)';
      }
      if (capText) capText.textContent = 'Recapture';
      if (capKbd) capKbd.style.opacity = '1';

      if (finalizeBtn) {
        finalizeBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-primary';
        finalizeBtn.disabled = false;
        finalizeBtn.title = 'Preview certificate (Enter)';
      }
      if (finalizeHint) finalizeHint.textContent = '';
    }
  }
}
