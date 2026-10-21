/**
 * Screen 3: First Weight Workflow (Refined Architecture - Polish Pass)
 * - Shared HUD mount
 * - Direction Selection Card (IN/OUT hotkeys I/O with plain phrasing)
 * - Two-card layout: Ticket Details (60%) + Live/Captured Weight Preview (40%)
 * - As-you-type truck suggestions with keyboard navigation (Down to browse, Enter to commit & blur)
 * - Ship-wrecking material defaults ("Other" by default, quick-picks, M key shortcut)
 * - Always-visible optional fields (Driver Name, Driver Mobile, Client / Party, Challan, Resizable Remarks)
 * - Register/Update Truck (Ctrl+S) calm suggestion strip
 * - Duplicate Open Ticket safety blocking (Capture & Preview blocked, Jump to ticket)
 * - Innermost-first Esc navigation and dynamic Back/Exit-field button
 * - Double-check guard on Confirm & Print
 */
import {
  state,
  pendingTickets,
  REGISTERED_TRUCKS,
  registerTruck,
  peekNextTicketId,
  consumeTicketId,
  commitFirstWeigh,
} from '../state.js';
import { IS_PRODUCTION } from '../runtime.js';
import { showScreen } from '../router.js';
import { formatDateTime12H, formatElapsed } from '../utils.js';
import hapticAudio from '../audio.js';
import { showToast } from '../toast.js';
import { mountHud } from '../hud.js';
import { openPrintSlipModal, closePrintModal } from '../print.js';
import { renderPendingTicketsTable } from './dashboard.js';
import { triggerSync, updateSyncUI } from '../sync.js';
import { openSecondWeighWithTicket } from './second-weigh.js';
import { openConfirmDialog } from '../confirm-dialog.js';

export const PREDEFINED_MATERIALS = [
  'Scrap Iron',
  'MS Plate',
  'Pipe',
  'Machinery',
  'Copper / Cable',
  'Wood / Furniture',
  'Waste Oil',
  'Other',
];

let selectedSuggestionIndex = -1;
let selectedMaterialIndex = -1;

/**
 * Updates the bottom-left control label, icon, and tooltip to reflect what Esc will do
 */
export function updateBackButtonState() {
  const backBtn = document.getElementById('fw-btn-back');
  const backIcon = document.getElementById('fw-back-icon');
  const backText = document.getElementById('fw-back-text');
  if (!backBtn) return;

  const truckSuggestions = document.getElementById('fw-truck-suggestions');
  const materialDropdown = document.getElementById('fw-material-dropdown');
  const suggestionsOpen =
    (truckSuggestions && !truckSuggestions.hidden) ||
    (materialDropdown && !materialDropdown.hidden);

  if (suggestionsOpen) {
    if (backIcon) backIcon.textContent = '✕';
    if (backText) backText.textContent = 'Close List';
    backBtn.title = 'Close open list (Esc)';
    return;
  }

  const activeEl = document.activeElement;
  const inField =
    activeEl &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) &&
    document.getElementById('first-weigh-screen')?.contains(activeEl);

  if (inField) {
    if (backIcon) backIcon.textContent = '✕';
    if (backText) backText.textContent = 'Exit Field';
    backBtn.title = 'Release focus (Esc)';
    return;
  }

  if (backIcon) backIcon.textContent = '←';
  if (backText) backText.textContent = 'Back';
  backBtn.title = 'Back to dashboard (Esc)';
}

/**
 * Resets the First Weigh form and internal state
 */
export function resetFirstWeighForm() {
  state.firstWeigh.capturedWeight = null;
  state.firstWeigh.capturedTime = null;
  state.firstWeigh.capturedTimestamp = null;
  state.firstWeigh.direction = null;
  state.firstWeigh._blockedByOpenTicket = false;
  state.firstWeigh._blockedTicketId = null;

  const truckInput = document.getElementById('fw-truck-input');
  const materialInput = document.getElementById('fw-material-input');
  const driverInput = document.getElementById('fw-driver-input');
  const clientInput = document.getElementById('fw-client-input');
  const phoneInput = document.getElementById('fw-phone-input');
  const challanInput = document.getElementById('fw-challan-input');
  const remarksInput = document.getElementById('fw-remarks-input');
  const pendingNotice = document.getElementById('fw-truck-pending-notice');
  const truckSuggestions = document.getElementById('fw-truck-suggestions');
  const materialDropdown = document.getElementById('fw-material-dropdown');
  const regStrip = document.getElementById('fw-register-strip');

  if (truckInput) {
    truckInput.value = '';
    truckInput.classList.remove('fw-input-prefilled');
    delete truckInput.dataset.prefilled;
  }
  if (materialInput) {
    materialInput.value = 'Other';
  }
  if (driverInput) {
    driverInput.value = '';
    driverInput.classList.remove('fw-input-prefilled');
    delete driverInput.dataset.prefilled;
  }
  if (phoneInput) {
    phoneInput.value = '';
    phoneInput.classList.remove('fw-input-prefilled');
    delete phoneInput.dataset.prefilled;
  }
  if (clientInput) {
    clientInput.value = '';
    clientInput.classList.remove('fw-input-prefilled');
    delete clientInput.dataset.prefilled;
  }
  if (challanInput) challanInput.value = '';
  if (remarksInput) {
    remarksInput.value = '';
    remarksInput.style.height = '34px';
  }
  if (pendingNotice) pendingNotice.hidden = true;
  if (truckSuggestions) truckSuggestions.hidden = true;
  if (materialDropdown) materialDropdown.hidden = true;
  if (regStrip) regStrip.hidden = true;

  // Set quick-pick 'Other' pill to active
  const pills = document.querySelectorAll('.fw-quick-pick');
  pills.forEach((p) => {
    p.classList.toggle('active', p.dataset.material === 'Other');
  });

  setFirstWeighDirection(null, false);
  updateTicketIdDisplay();
  updateFirstWeighPreview();
  updateBackButtonState();
}

/**
 * Updates the predicted Next Ticket ID in the card header
 */
export function updateTicketIdDisplay() {
  const ticketIdEl = document.getElementById('fw-ticket-id');
  if (ticketIdEl) {
    ticketIdEl.textContent = `#${peekNextTicketId()}`;
  }
}

/**
 * Checks whether the form currently contains unsaved modifications.
 * Material defaulting to 'Other', direction choices, and unedited pre-filled values
 * are deliberately excluded from dirty checks.
 */
export function isFirstWeighFormDirty() {
  if (state.firstWeigh.capturedWeight !== null) return true;
  const truck = document.getElementById('fw-truck-input')?.value.trim() || '';
  const driverEl = document.getElementById('fw-driver-input');
  const phoneEl = document.getElementById('fw-phone-input');
  const clientEl = document.getElementById('fw-client-input');
  const challanEl = document.getElementById('fw-challan-input');
  const remarksEl = document.getElementById('fw-remarks-input');

  const driver = driverEl?.value.trim() || '';
  const phone = phoneEl?.value.trim() || '';
  const client = clientEl?.value.trim() || '';
  const challan = challanEl?.value.trim() || '';
  const remarks = remarksEl?.value.trim() || '';

  if (truck) return true;
  if (challan || remarks) return true;

  const isDriverEdited = driver && driver !== (driverEl?.dataset.prefilled || '');
  const isPhoneEdited = phone && phone !== (phoneEl?.dataset.prefilled || '');
  const isClientEdited = client && client !== (clientEl?.dataset.prefilled || '');

  return Boolean(isDriverEdited || isPhoneEdited || isClientEdited);
}

/**
 * Discard Confirmation Dialog
 */
export function openDiscardFirstWeighDialog(onConfirm = null) {
  openConfirmDialog({
    id: 'discard-first-modal',
    stateFlag: '_discardDialogOpen',
    title: 'Discard this ticket?',
    message:
      'You have unsaved ticket information or captured weight. Leaving will discard your changes.',
    keepLabel: 'Keep working',
    confirmLabel: 'Discard and leave',
    onConfirm: () => {
      if (typeof onConfirm === 'function') {
        onConfirm();
      } else {
        resetFirstWeighForm();
        showScreen('dashboard-screen');
      }
    },
  });
}

/**
 * Handle Back action (from button click or Esc key)
 */
export function handleFirstWeighBack() {
  if (isFirstWeighFormDirty()) {
    openDiscardFirstWeighDialog();
  } else {
    resetFirstWeighForm();
    showScreen('dashboard-screen');
  }
}

/**
 * Sets the active weight direction: 'IN', 'OUT', or null
 */
export function setFirstWeighDirection(dir, playSound = false) {
  const btnIn = document.getElementById('fw-btn-dir-in');
  const btnOut = document.getElementById('fw-btn-dir-out');
  const subtext = document.getElementById('fw-direction-subtext');

  if (!dir) {
    state.firstWeigh.direction = null;
    if (btnIn) {
      btnIn.classList.remove('active');
      btnIn.setAttribute('aria-checked', 'false');
    }
    if (btnOut) {
      btnOut.classList.remove('active');
      btnOut.setAttribute('aria-checked', 'false');
    }
    if (subtext) {
      subtext.innerHTML = `Select direction with <kbd>I</kbd> or <kbd>O</kbd> keys or click above`;
    }
    updateFirstWeighPreview();
    return;
  }

  const isOut = dir === 'OUT' || (typeof dir === 'string' && dir.toUpperCase().includes('OUT'));
  state.firstWeigh.direction = isOut ? 'OUT' : 'IN';

  if (btnIn && btnOut) {
    if (isOut) {
      btnOut.classList.add('active');
      btnOut.setAttribute('aria-checked', 'true');
      btnIn.classList.remove('active');
      btnIn.setAttribute('aria-checked', 'false');
      if (subtext) {
        subtext.innerHTML = `Weighing the empty truck now (tare). The loaded truck is weighed when it returns.`;
      }
    } else {
      btnIn.classList.add('active');
      btnIn.setAttribute('aria-checked', 'true');
      btnOut.classList.remove('active');
      btnOut.setAttribute('aria-checked', 'false');
      if (subtext) {
        subtext.innerHTML = `Weighing the loaded truck now (gross). The empty truck is weighed when it returns.`;
      }
    }
  }

  if (playSound && hapticAudio) {
    hapticAudio.playClick();
  }

  updateFirstWeighPreview();
}

/**
 * Evaluates whether to show the "Register truck" or "Update truck" strip
 */
export function updateRegisterStrip() {
  const strip = document.getElementById('fw-register-strip');
  const titleEl = document.getElementById('fw-register-strip-title');
  const descEl = document.getElementById('fw-register-strip-desc');
  const btnTextEl = document.getElementById('fw-register-btn-text');
  if (!strip) return;

  const truckInput = document.getElementById('fw-truck-input');
  const plate = truckInput ? truckInput.value.trim().toUpperCase() : '';
  if (!plate) {
    strip.hidden = true;
    return;
  }

  const driver = document.getElementById('fw-driver-input')?.value.trim() || '';
  const phone = document.getElementById('fw-phone-input')?.value.trim() || '';
  const client = document.getElementById('fw-client-input')?.value.trim() || '';

  const saved = REGISTERED_TRUCKS.find((t) => (t.plate || '').trim().toUpperCase() === plate);

  if (!saved) {
    // New truck
    if (titleEl) titleEl.textContent = 'Register truck';
    if (descEl) descEl.textContent = 'New truck, not saved yet';
    if (btnTextEl) btnTextEl.textContent = 'Register Truck';
    strip.hidden = false;
  } else {
    // Existing truck: check if form has differing non-empty values
    const driverDiff = Boolean(driver && driver !== (saved.driver || ''));
    const phoneDiff = Boolean(phone && phone !== (saved.phone || ''));
    const clientDiff = Boolean(client && client !== (saved.client || ''));

    if (driverDiff || phoneDiff || clientDiff) {
      if (titleEl) titleEl.textContent = 'Update truck';
      if (descEl) descEl.textContent = 'Details changed';
      if (btnTextEl) btnTextEl.textContent = 'Update Truck';
      strip.hidden = false;
    } else {
      strip.hidden = true;
    }
  }
}

/**
 * Registers or updates the current truck record (Ctrl+S or button click)
 */
export async function doRegisterOrUpdateTruck() {
  const truckInput = document.getElementById('fw-truck-input');
  const plate = truckInput ? truckInput.value.trim().toUpperCase() : '';
  if (!plate) return;

  const driver = document.getElementById('fw-driver-input')?.value.trim() || '';
  const phone = document.getElementById('fw-phone-input')?.value.trim() || '';
  const client = document.getElementById('fw-client-input')?.value.trim() || '';
  const material = document.getElementById('fw-material-input')?.value.trim() || 'Other';
  const operatorName = state.activeOperator ? state.activeOperator.name : 'MD. RAJU';

  const wasExisting = REGISTERED_TRUCKS.some(
    (t) => (t.plate || '').trim().toUpperCase() === plate
  );

  try {
    await registerTruck({ plate, driver, phone, client, material }, operatorName);
  } catch (err) {
    showToast(err?.message || `Could not save truck ${plate}`, 'error');
    return;
  }

  if (hapticAudio) hapticAudio.playSuccess();
  showToast(
    wasExisting ? `Truck ${plate} details updated` : `Truck ${plate} registered`,
    'success'
  );

  updateRegisterStrip();
}

/**
 * Navigates to Second Weigh for the current truck if it has an open ticket
 */
export function openPendingTicketForCurrentTruck() {
  const truckInput = document.getElementById('fw-truck-input');
  const plate = truckInput ? truckInput.value.trim().toUpperCase() : '';
  if (!plate) return;

  const ticket = pendingTickets.find(
    (t) => (t.truckNo || '').trim().toUpperCase() === plate
  );
  if (!ticket) return;

  resetFirstWeighForm();
  openSecondWeighWithTicket(ticket);
}

/**
 * State Machine: Updates Weight Preview Card, Status Strip, and Action Buttons
 */
export function updateFirstWeighPreview(weight = null) {
  const screen = document.getElementById('first-weigh-screen');
  if (!screen || !screen.classList.contains('active')) return;

  const dir = state.firstWeigh.direction;
  const capturedWeight = state.firstWeigh.capturedWeight;
  const isConnected = state.isScaleConnected;
  const isStable = state.isScaleStable;
  const liveWeight = Number.isFinite(weight) ? weight : state.currentLiveWeight;

  const truckInput = document.getElementById('fw-truck-input');
  const truckVal = truckInput ? truckInput.value.trim().toUpperCase() : '';

  // Elements
  const weightCard = document.getElementById('fw-weight-card');
  const weightLabel = document.getElementById('fw-weight-label');
  const weightChip = document.getElementById('fw-weight-chip');
  const weightValue = document.getElementById('fw-weight-value');
  const weightDetail = document.getElementById('fw-weight-detail');
  const flowFirstStep = document.getElementById('fw-flow-first-step');
  const flowSecondStep = document.getElementById('fw-flow-second-step');

  const statusStrip = document.getElementById('fw-status-strip');
  const statusIcon = document.getElementById('fw-status-icon');
  const statusText = document.getElementById('fw-status-text');
  const statusSubtext = document.getElementById('fw-status-subtext');

  const captureBtn = document.getElementById('fw-btn-capture');
  const captureBtnText = document.getElementById('fw-btn-capture-text');
  const previewBtn = document.getElementById('fw-btn-preview');

  // Reset status strip modifier classes
  if (statusStrip) {
    statusStrip.className = 'sw-status-strip fw-status-strip';
  }

  // Helper to set status strip content
  function setStatus(text, subtext = '', variant = 'stable', icon = 'ℹ') {
    if (!statusStrip) return;
    statusStrip.className = `sw-status-strip fw-status-strip sw-status-strip--${variant}`;
    if (statusIcon) statusIcon.textContent = icon;
    if (statusText) statusText.textContent = text;
    if (statusSubtext) {
      if (subtext) {
        statusSubtext.textContent = subtext;
        statusSubtext.style.display = 'block';
      } else {
        statusSubtext.style.display = 'none';
      }
    }
  }

  // 1. Connection check
  if (!isConnected) {
    if (weightCard) {
      weightCard.className = 'fw-weight-card sw-weigh-card fw-card-disabled';
    }
    if (weightLabel) weightLabel.textContent = 'SCALE OFFLINE';
    if (weightChip) {
      weightChip.textContent = 'DISCONNECTED';
      weightChip.className = 'sw-chip sw-chip--anomaly';
    }
    if (weightValue) {
      weightValue.textContent = '------';
      weightValue.classList.remove('is-unstable');
    }
    if (weightDetail) weightDetail.textContent = 'Scale disconnected — check serial connection';
    setStatus('Scale disconnected — check serial connection or simulator', '', 'anomaly', '⚠️');

    if (captureBtn) {
      captureBtn.disabled = true;
      captureBtn.title = 'Scale is disconnected';
      if (captureBtnText) captureBtnText.textContent = 'Scale Disconnected';
    }
    if (previewBtn) {
      previewBtn.disabled = true;
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
    }
    return;
  }

  // 2. Open Ticket Duplicate Check (Safety Blocking)
  const isBlockedByOpenTicket = state.firstWeigh._blockedByOpenTicket;
  const blockedTicketId = state.firstWeigh._blockedTicketId;

  if (isBlockedByOpenTicket) {
    if (weightCard) {
      weightCard.className = 'fw-weight-card sw-weigh-card sw-card-live';
    }
    const isOut = dir === 'OUT';
    const dirLabel = isOut ? 'FIRST · TARE' : 'FIRST · GROSS';
    if (weightLabel) weightLabel.textContent = dir ? dirLabel : 'FIRST WEIGHT';
    if (flowFirstStep) {
      flowFirstStep.textContent = isOut ? '1. First Weigh: Tare (Now)' : '1. First Weigh: Gross (Now)';
    }
    if (flowSecondStep) {
      flowSecondStep.textContent = isOut ? '2. Second Weigh: Gross (Return)' : '2. Second Weigh: Tare (Return)';
    }
    if (weightChip) {
      weightChip.textContent = 'BLOCKED';
      weightChip.className = 'sw-chip sw-chip--warning';
    }
    if (weightValue) {
      weightValue.textContent =
        capturedWeight !== null ? capturedWeight.toLocaleString() : (liveWeight !== null ? liveWeight.toLocaleString() : '------');
    }
    if (weightDetail) {
      weightDetail.textContent = `Capture blocked: truck has open ticket #${blockedTicketId} • Open or delete ticket`;
    }

    if (captureBtn) {
      captureBtn.disabled = true;
      captureBtn.className = 'sw-action-btn sw-action-btn--capture btn-primary-capture';
      if (captureBtnText) captureBtnText.textContent = 'Capture Blocked';
      captureBtn.title = `Capture is blocked: truck already has open ticket #${blockedTicketId}`;
    }
    if (previewBtn) {
      previewBtn.disabled = true;
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
    }

    setStatus(
      'Capture is blocked: this truck already has an open ticket',
      `Open existing ticket #${blockedTicketId} (Ctrl+Enter) or delete mistaken ticket from dashboard`,
      'warning',
      '⚠️'
    );
    return;
  }

  // 3. Direction check
  if (!dir) {
    if (weightCard) {
      weightCard.className = 'fw-weight-card sw-weigh-card fw-card-disabled';
    }
    if (weightLabel) weightLabel.textContent = 'FIRST WEIGHT';
    if (weightChip) {
      weightChip.textContent = 'SELECT DIRECTION';
      weightChip.className = 'sw-chip sw-chip--neutral';
    }
    if (weightValue) {
      weightValue.textContent = liveWeight !== null ? liveWeight.toLocaleString() : '------';
      weightValue.classList.remove('is-unstable');
    }
    if (weightDetail) weightDetail.textContent = 'Select direction with I or O to begin preview';
    if (flowFirstStep) flowFirstStep.textContent = '1. First Weigh (Select Direction)';
    if (flowSecondStep) flowSecondStep.textContent = '2. Second Weigh (Pending)';

    setStatus(
      'Select weight direction (IN or OUT) to begin',
      'Press I for Inbound (Loaded truck) or O for Outbound (Empty truck)',
      'warning',
      'ℹ'
    );

    if (captureBtn) {
      captureBtn.disabled = true;
      captureBtn.title = 'Select direction first (Press I or O)';
      captureBtn.className = 'sw-action-btn sw-action-btn--capture btn-primary-capture';
      if (captureBtnText) captureBtnText.textContent = 'Select Direction';
    }
    if (previewBtn) {
      previewBtn.disabled = true;
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
    }
    return;
  }

  // Direction is active: update direction label & flow step
  const isOut = dir === 'OUT';
  const dirLabel = isOut ? 'FIRST · TARE' : 'FIRST · GROSS';
  if (weightLabel) weightLabel.textContent = dirLabel;
  if (flowFirstStep) {
    flowFirstStep.textContent = isOut ? '1. First Weigh: Tare (Now)' : '1. First Weigh: Gross (Now)';
  }
  if (flowSecondStep) {
    flowSecondStep.textContent = isOut ? '2. Second Weigh: Gross (Return)' : '2. Second Weigh: Tare (Return)';
  }

  // 4. Weight NOT yet captured (Live preview tracking)
  if (capturedWeight === null) {
    if (weightCard) {
      weightCard.className = 'fw-weight-card sw-weigh-card sw-card-live';
    }
    if (weightValue) {
      weightValue.textContent = liveWeight !== null ? liveWeight.toLocaleString() : '------';
      if (!isStable) {
        weightValue.classList.add('is-unstable');
      } else {
        weightValue.classList.remove('is-unstable');
      }
    }

    if (weightChip) {
      if (!isStable) {
        weightChip.textContent = '● MOTION';
        weightChip.className = 'sw-chip sw-chip--warning';
      } else {
        weightChip.textContent = '● LIVE';
        weightChip.className = 'sw-chip sw-chip--live';
      }
    }

    if (weightDetail) {
      weightDetail.textContent = isStable
        ? 'Live scale reading — press Space to capture'
        : 'Scale in motion — waiting to stabilize...';
    }

    // Capture button setup
    if (captureBtn) {
      const canCapture = isStable && liveWeight !== null && liveWeight > 0;
      captureBtn.disabled = !canCapture;
      captureBtn.className = 'sw-action-btn sw-action-btn--capture btn-primary-capture';
      if (captureBtnText) {
        captureBtnText.textContent = isStable ? 'Capture Weight' : 'Waiting for stable…';
      }
      captureBtn.title = isStable ? 'Lock live reading (Spacebar)' : 'Scale is settling...';
    }

    // Status strip progression
    if (liveWeight === 0) {
      setStatus('Scale is empty (0 kg) — drive truck onto platform', '', 'warning', '⟳');
    } else if (!isStable) {
      setStatus('Scale is settling — waiting for stable reading…', '', 'unstable', '⟳');
    } else if (!truckVal) {
      setStatus('Scale stable • Enter truck registration number', '', 'stable', 'ℹ');
    } else {
      setStatus('Ready to capture weight (Press Spacebar)', '', 'stable', '✓');
    }

    // Preview button is disabled until weight is captured
    if (previewBtn) {
      previewBtn.disabled = true;
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
    }
    return;
  }

  // 5. Weight IS captured (Locked / Non-destructive recapture mode)
  if (weightCard) {
    weightCard.className = 'fw-weight-card sw-weigh-card fw-card-captured';
  }
  if (weightValue) {
    weightValue.textContent = capturedWeight.toLocaleString();
    weightValue.classList.remove('is-unstable');
  }
  if (weightChip) {
    weightChip.textContent = 'CAPTURED';
    weightChip.className = 'sw-chip sw-chip--preview';
  }
  if (weightDetail) {
    weightDetail.textContent = `Captured at ${state.firstWeigh.capturedTime || 'Platform'} • Verified`;
  }

  // Capture button acts as Recapture
  if (captureBtn) {
    const canRecapture = isStable && isConnected && liveWeight > 0;
    captureBtn.disabled = !canRecapture;
    captureBtn.className = 'sw-action-btn sw-action-btn--capture btn-secondary-recapture';
    if (captureBtnText) {
      captureBtnText.textContent = 'Recapture Weight';
    }
    captureBtn.title = isStable
      ? 'Non-destructive recapture (Spacebar)'
      : 'Waiting for scale to stabilize to recapture...';
  }

  // Preview button readiness — Material never blocks preview!
  const canPreview = Boolean(dir && truckVal && capturedWeight !== null && !isBlockedByOpenTicket);
  if (previewBtn) {
    previewBtn.disabled = !canPreview;
    if (canPreview) {
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-primary';
    } else {
      previewBtn.className = 'sw-action-btn sw-action-btn--finalize btn-finalize-neutral';
    }
  }

  // Status strip when captured
  if (!truckVal) {
    setStatus('Weight locked • Enter truck registration number', '', 'stable', 'ℹ');
  } else {
    setStatus(
      'Weight locked • Review details and click Preview to proceed (Enter ↵)',
      '',
      'success',
      '✓'
    );
  }
}

/**
 * Capture / Recapture Weight Action
 */
export function doCaptureFirstWeigh() {
  if (!state.firstWeigh.direction) {
    showToast('Please select Weight Direction first (Press I for IN or O for OUT)', 'warning');
    if (hapticAudio) hapticAudio.playError();
    return;
  }

  // Blocked by open ticket feedback
  if (state.firstWeigh._blockedByOpenTicket) {
    const captureBtn = document.getElementById('fw-btn-capture');
    if (captureBtn) {
      captureBtn.classList.remove('fw-shake-blocked');
      void captureBtn.offsetWidth; // Force reflow
      captureBtn.classList.add('fw-shake-blocked');
    }
    showToast(
      `Capture blocked: this truck already has open ticket #${state.firstWeigh._blockedTicketId}`,
      'error'
    );
    if (hapticAudio) hapticAudio.playError();
    return;
  }

  if (!state.isScaleConnected || !state.isScaleStable || state.currentLiveWeight <= 0) {
    const captureBtn = document.getElementById('fw-btn-capture');
    if (captureBtn) {
      captureBtn.classList.remove('fw-shake-blocked');
      void captureBtn.offsetWidth;
      captureBtn.classList.add('fw-shake-blocked');
    }
    showToast('Cannot capture while scale is in motion, disconnected, or empty', 'error');
    if (hapticAudio) hapticAudio.playError();
    return;
  }

  const isRecapture = state.firstWeigh.capturedWeight !== null;
  state.firstWeigh.capturedWeight = state.currentLiveWeight;
  state.firstWeigh.capturedTime = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  state.firstWeigh.capturedTimestamp = formatDateTime12H(new Date());

  if (hapticAudio) hapticAudio.playCapture();

  if (isRecapture) {
    showToast(`Weight updated: ${state.firstWeigh.capturedWeight.toLocaleString()} kg`, 'info');
  } else {
    showToast(`Weight locked: ${state.firstWeigh.capturedWeight.toLocaleString()} kg`, 'success');
  }

  // Ensure button releases focus so subsequent Enter/Space works at screen level
  if (document.activeElement === document.getElementById('fw-btn-capture')) {
    document.activeElement.blur();
  }

  updateFirstWeighPreview();
  updateBackButtonState();
}

/**
 * Builds list of truck suggestions.
 * - On empty query (Down arrow to browse): only shows available registered trucks (no open tickets).
 * - On matching query: shows matching saved trucks. Open-ticket trucks are only
 *   shown when the query matches no registered truck at all, so they never
 *   clutter a real match.
 */
function getTruckSuggestions(query) {
  const q = query.trim().toUpperCase();

  // Set of plates currently having an open pending ticket
  const openPlatesMap = new Map();
  pendingTickets.forEach((t) => {
    const plate = (t.truckNo || '').trim().toUpperCase();
    if (plate) {
      openPlatesMap.set(plate, t);
    }
  });

  // 1. Available saved trucks (exclude trucks with open tickets from general browse)
  const savedList = [];
  const seenSavedPlates = new Set();

  REGISTERED_TRUCKS.forEach((t) => {
    if (t.status === 'archived') return;
    const plate = (t.plate || '').trim().toUpperCase();
    if (!plate || seenSavedPlates.has(plate)) return;
    seenSavedPlates.add(plate);

    // If this truck currently has an open ticket, exclude it from clean saved list
    if (openPlatesMap.has(plate)) return;

    savedList.push({
      plate: t.plate,
      driver: t.driver || '',
      material: t.material || '',
      client: t.client || '',
      phone: t.phone || '',
      hasOpenTicket: false,
      openTicketId: null,
      timeElapsed: null,
    });
  });

  // If query is empty (operator pressed Down arrow to browse):
  // Do not show open tickets at all. Only show available saved trucks.
  if (!q) {
    return savedList;
  }

  // Operator typed a query:
  // Match saved trucks first
  const savedMatches = savedList.filter((item) => {
    const p = item.plate.toUpperCase();
    const d = (item.driver || '').toUpperCase();
    const c = (item.client || '').toUpperCase();
    return p.includes(q) || d.includes(q) || c.includes(q);
  });

  // Match open tickets from pendingTickets
  const openTicketMatches = [];
  const seenOpenPlates = new Set();

  pendingTickets.forEach((t) => {
    const plate = (t.truckNo || '').trim().toUpperCase();
    if (!plate || seenOpenPlates.has(plate)) return;

    const p = plate;
    const d = (t.driver || '').toUpperCase();
    const c = (t.client || '').toUpperCase();

    if (p.includes(q) || d.includes(q) || c.includes(q)) {
      seenOpenPlates.add(plate);
      openTicketMatches.push({
        plate: t.truckNo,
        driver: t.driver || '',
        material: t.material || '',
        client: t.client || '',
        phone: t.phone || '',
        hasOpenTicket: true,
        openTicketId: t.id,
        timeElapsed: formatElapsed(t.createdAt || t.firstWeightTime) || t.timeElapsed || 'open',
      });
    }
  });

  // Registered-truck matches always win. Open tickets are only shown when
  // the query has no matching registered truck, so they never clutter a real match.
  if (savedMatches.length > 0) {
    return savedMatches;
  }

  if (openTicketMatches.length > 0) {
    return openTicketMatches;
  }

  // If nothing matches query, fallback to browsing saved trucks only (no open tickets)
  return savedList;
}

/**
 * Render truck suggestions dropdown with scrolling inside itself
 */
function renderTruckSuggestions(suggestions, container) {
  if (!suggestions.length) {
    container.hidden = true;
    container.innerHTML = '';
    selectedSuggestionIndex = -1;
    updateBackButtonState();
    return;
  }

  container.innerHTML = suggestions
    .map(
      (s, index) => `
      <div class="fw-suggestion-item ${index === selectedSuggestionIndex ? 'selected' : ''}" data-index="${index}">
        <div class="fw-suggestion-main">
          <span class="fw-suggestion-plate">${s.plate}</span>
          ${
            s.hasOpenTicket
              ? `<span class="fw-suggestion-badge" style="color: #d97706; background: rgba(245, 158, 11, 0.12);">OPEN #${s.openTicketId}</span>`
              : `<span class="fw-suggestion-badge">SAVED</span>`
          }
        </div>
        <div class="fw-suggestion-sub">
          ${[s.driver, s.client].filter(Boolean).join(' • ')}
        </div>
      </div>
    `
    )
    .join('');

  container.hidden = false;
  scrollSelectedSuggestionIntoView(container);
  updateBackButtonState();
}

function scrollSelectedSuggestionIntoView(container) {
  if (selectedSuggestionIndex < 0) return;
  const itemEl = container.querySelector(
    `.fw-suggestion-item[data-index="${selectedSuggestionIndex}"]`
  );
  if (itemEl) {
    itemEl.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Applies a truck selection to form fields.
 * Fills only empty fields for Driver, Mobile, and Client, marks them prefilled,
 * closes the list and releases focus. Does NOT touch Material.
 */
function applyTruckSelection(truckData) {
  const truckInput = document.getElementById('fw-truck-input');
  const driverInput = document.getElementById('fw-driver-input');
  const clientInput = document.getElementById('fw-client-input');
  const phoneInput = document.getElementById('fw-phone-input');
  const suggestions = document.getElementById('fw-truck-suggestions');
  const pendingNotice = document.getElementById('fw-truck-pending-notice');
  const pendingText = document.getElementById('fw-truck-pending-text');

  const upperPlate = truckData.plate.toUpperCase();
  if (truckInput) {
    truckInput.value = upperPlate;
  }

  // Pre-fill empty optional fields only
  if (driverInput && !driverInput.value.trim() && truckData.driver) {
    driverInput.value = truckData.driver;
    driverInput.classList.add('fw-input-prefilled');
    driverInput.dataset.prefilled = truckData.driver;
  }
  if (phoneInput && !phoneInput.value.trim() && truckData.phone) {
    phoneInput.value = truckData.phone;
    phoneInput.classList.add('fw-input-prefilled');
    phoneInput.dataset.prefilled = truckData.phone;
  }
  if (clientInput && !clientInput.value.trim() && truckData.client) {
    clientInput.value = truckData.client;
    clientInput.classList.add('fw-input-prefilled');
    clientInput.dataset.prefilled = truckData.client;
  }

  // Check duplicate open ticket status
  const openTicket = pendingTickets.find(
    (t) => (t.truckNo || '').trim().toUpperCase() === upperPlate
  );

  state.firstWeigh._blockedByOpenTicket = Boolean(openTicket);
  state.firstWeigh._blockedTicketId = openTicket ? openTicket.id : null;

  if (openTicket && pendingNotice && pendingText) {
    pendingText.textContent = `This truck already has open ticket #${openTicket.id} (${formatElapsed(openTicket.createdAt || openTicket.firstWeightTime) || openTicket.timeElapsed || 'pending'})`;
    pendingNotice.hidden = false;
  } else if (pendingNotice) {
    pendingNotice.hidden = true;
  }

  if (suggestions) suggestions.hidden = true;
  selectedSuggestionIndex = -1;

  // Release focus completely per fast path spec
  if (document.activeElement) {
    document.activeElement.blur();
  }

  if (hapticAudio) hapticAudio.playClick();
  updateRegisterStrip();
  updateFirstWeighPreview();
  updateBackButtonState();
}

/**
 * Renders material suggestions dropdown
 */
function renderMaterialDropdown(query, container) {
  const q = query.trim().toUpperCase();
  const matches = PREDEFINED_MATERIALS.filter((m) => !q || m.toUpperCase().includes(q));

  if (!matches.length) {
    container.hidden = true;
    container.innerHTML = '';
    selectedMaterialIndex = -1;
    updateBackButtonState();
    return;
  }

  container.innerHTML = matches
    .map(
      (m, idx) => `
      <div class="fw-suggestion-item ${idx === selectedMaterialIndex ? 'selected' : ''}" data-material="${m}">
        <span class="fw-suggestion-plate" style="font-family: var(--font-sans);">${m}</span>
      </div>
    `
    )
    .join('');

  container.hidden = false;
  updateBackButtonState();
}

/**
 * Applies a material selection and releases focus
 */
export function applyMaterialSelection(material) {
  const materialInput = document.getElementById('fw-material-input');
  const materialDropdown = document.getElementById('fw-material-dropdown');

  if (materialInput) {
    materialInput.value = material;
  }

  const pills = document.querySelectorAll('.fw-quick-pick');
  pills.forEach((p) => {
    p.classList.toggle('active', p.dataset.material === material);
  });

  if (materialDropdown) materialDropdown.hidden = true;
  selectedMaterialIndex = -1;

  // Release focus completely so Space is ready to capture
  if (document.activeElement) {
    document.activeElement.blur();
  }

  if (hapticAudio) hapticAudio.playClick();
  updateFirstWeighPreview();
  updateBackButtonState();
}

/**
 * Opens First Weigh Screen (called from dashboard or router)
 */
export function openFirstWeigh(dir = null) {
  showScreen('first-weigh-screen');
  updateTicketIdDisplay();

  // Material always starts on "Other" as a real selected value
  const materialInput = document.getElementById('fw-material-input');
  if (materialInput && !materialInput.value) {
    materialInput.value = 'Other';
  }
  const pills = document.querySelectorAll('.fw-quick-pick');
  pills.forEach((p) => {
    p.classList.toggle('active', p.dataset.material === (materialInput?.value || 'Other'));
  });

  if (dir) {
    setFirstWeighDirection(dir, false);
  } else {
    updateFirstWeighPreview();
  }

  if (hapticAudio) {
    hapticAudio.playClick();
  }

  // Fast path: opens with truck field focused directly
  setTimeout(() => {
    const truckInput = document.getElementById('fw-truck-input');
    if (truckInput) {
      truckInput.focus();
      truckInput.select();
    }
    updateBackButtonState();
  }, 50);
}

/**
 * Initializes First Weigh Screen DOM event listeners
 */
export function initFirstWeighScreen() {
  // Mount shared HUD into first weigh top band
  const hudContainer = document.getElementById('first-weigh-hud-slot');
  if (hudContainer) {
    mountHud(hudContainer);
  }

  // 1. Direction Buttons
  const btnIn = document.getElementById('fw-btn-dir-in');
  const btnOut = document.getElementById('fw-btn-dir-out');

  if (btnIn) {
    btnIn.addEventListener('click', () => {
      setFirstWeighDirection('IN', true);
      const truckInput = document.getElementById('fw-truck-input');
      if (truckInput) truckInput.focus();
    });
  }

  if (btnOut) {
    btnOut.addEventListener('click', () => {
      setFirstWeighDirection('OUT', true);
      const truckInput = document.getElementById('fw-truck-input');
      if (truckInput) truckInput.focus();
    });
  }

  // 2. Truck Input & As-you-type Suggestions
  const truckInput = document.getElementById('fw-truck-input');
  const truckSuggestions = document.getElementById('fw-truck-suggestions');
  const pendingNotice = document.getElementById('fw-truck-pending-notice');
  const pendingText = document.getElementById('fw-truck-pending-text');
  const openPendingBtn = document.getElementById('fw-btn-open-pending');

  let currentTruckSuggestions = [];

  function evaluateTruckState() {
    if (!truckInput) return;
    const rawVal = truckInput.value;
    const upperVal = rawVal.toUpperCase();
    if (rawVal !== upperVal) {
      truckInput.value = upperVal;
    }
    const trimmed = upperVal.trim();

    // Check open ticket duplicate
    const openTicket = trimmed
      ? pendingTickets.find((t) => (t.truckNo || '').trim().toUpperCase() === trimmed)
      : null;

    state.firstWeigh._blockedByOpenTicket = Boolean(openTicket);
    state.firstWeigh._blockedTicketId = openTicket ? openTicket.id : null;

    if (openTicket && pendingNotice && pendingText) {
      pendingText.textContent = `This truck already has open ticket #${openTicket.id} (${formatElapsed(openTicket.createdAt || openTicket.firstWeightTime) || openTicket.timeElapsed || 'pending'})`;
      pendingNotice.hidden = false;
    } else if (pendingNotice) {
      pendingNotice.hidden = true;
    }

    // Exact match auto-fill into empty optional fields only
    const exactMatch = trimmed
      ? REGISTERED_TRUCKS.find(
          (t) => t.status !== 'archived' && (t.plate || '').trim().toUpperCase() === trimmed
        )
      : null;

    if (exactMatch && !openTicket) {
      const driverInput = document.getElementById('fw-driver-input');
      const clientInput = document.getElementById('fw-client-input');
      const phoneInput = document.getElementById('fw-phone-input');

      if (driverInput && !driverInput.value.trim() && exactMatch.driver) {
        driverInput.value = exactMatch.driver;
        driverInput.classList.add('fw-input-prefilled');
        driverInput.dataset.prefilled = exactMatch.driver;
      }
      if (clientInput && !clientInput.value.trim() && exactMatch.client) {
        clientInput.value = exactMatch.client;
        clientInput.classList.add('fw-input-prefilled');
        clientInput.dataset.prefilled = exactMatch.client;
      }
      if (phoneInput && !phoneInput.value.trim() && exactMatch.phone) {
        phoneInput.value = exactMatch.phone;
        phoneInput.classList.add('fw-input-prefilled');
        phoneInput.dataset.prefilled = exactMatch.phone;
      }
    }

    updateRegisterStrip();
    updateFirstWeighPreview();
    updateBackButtonState();
  }

  if (truckInput && truckSuggestions) {
    truckInput.addEventListener('input', () => {
      const rawVal = truckInput.value;
      const upperVal = rawVal.toUpperCase();
      if (rawVal !== upperVal) {
        truckInput.value = upperVal;
      }

      currentTruckSuggestions = getTruckSuggestions(upperVal);
      selectedSuggestionIndex = -1;
      renderTruckSuggestions(currentTruckSuggestions, truckSuggestions);

      evaluateTruckState();
    });

    truckInput.addEventListener('keydown', (e) => {
      // Down arrow opens the list when closed
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (truckSuggestions.hidden) {
          currentTruckSuggestions = getTruckSuggestions(truckInput.value);
          selectedSuggestionIndex = currentTruckSuggestions.length > 0 ? 0 : -1;
          renderTruckSuggestions(currentTruckSuggestions, truckSuggestions);
          return;
        }
        if (currentTruckSuggestions.length > 0) {
          selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentTruckSuggestions.length;
          renderTruckSuggestions(currentTruckSuggestions, truckSuggestions);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!truckSuggestions.hidden && currentTruckSuggestions.length > 0) {
          selectedSuggestionIndex =
            selectedSuggestionIndex <= 0
              ? currentTruckSuggestions.length - 1
              : selectedSuggestionIndex - 1;
          renderTruckSuggestions(currentTruckSuggestions, truckSuggestions);
        }
        return;
      }

      // Ctrl+Enter or Cmd+Enter directly navigates to open ticket if truck has one
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openPendingTicketForCurrentTruck();
        return;
      }

      // Enter commits plate and releases focus
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!truckSuggestions.hidden && selectedSuggestionIndex >= 0 && currentTruckSuggestions[selectedSuggestionIndex]) {
          applyTruckSelection(currentTruckSuggestions[selectedSuggestionIndex]);
          return;
        }

        const trimmed = truckInput.value.trim();
        if (!trimmed) {
          // Empty field: do not release focus, show status hint
          showToast('Truck registration number is required', 'warning');
          return;
        }

        // Has typed text: close list, release focus completely
        truckSuggestions.hidden = true;
        selectedSuggestionIndex = -1;
        truckInput.blur();
        evaluateTruckState();
        return;
      }

      // Esc closes suggestion list if open
      if (e.key === 'Escape') {
        if (!truckSuggestions.hidden) {
          e.preventDefault();
          e.stopPropagation();
          truckSuggestions.hidden = true;
          selectedSuggestionIndex = -1;
          updateBackButtonState();
          return;
        }
      }
    });

    truckSuggestions.addEventListener('click', (e) => {
      const item = e.target.closest('.fw-suggestion-item');
      if (item) {
        const idx = parseInt(item.dataset.index, 10);
        if (currentTruckSuggestions[idx]) {
          applyTruckSelection(currentTruckSuggestions[idx]);
        }
      }
    });
  }

  // Pending ticket Open button
  if (openPendingBtn) {
    openPendingBtn.addEventListener('click', () => {
      openPendingTicketForCurrentTruck();
    });
  }

  // 3. Material Input & Dropdown
  const materialInput = document.getElementById('fw-material-input');
  const materialDropdown = document.getElementById('fw-material-dropdown');

  if (materialInput && materialDropdown) {
    materialInput.addEventListener('focus', () => {
      renderMaterialDropdown(materialInput.value, materialDropdown);
      materialInput.select();
    });

    materialInput.addEventListener('input', () => {
      renderMaterialDropdown(materialInput.value, materialDropdown);
      const pills = document.querySelectorAll('.fw-quick-pick');
      pills.forEach((p) => {
        p.classList.toggle('active', p.dataset.material === materialInput.value.trim());
      });
      updateFirstWeighPreview();
    });

    materialInput.addEventListener('keydown', (e) => {
      const items = PREDEFINED_MATERIALS.filter(
        (m) =>
          !materialInput.value.trim() ||
          m.toUpperCase().includes(materialInput.value.trim().toUpperCase())
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (materialDropdown.hidden) {
          renderMaterialDropdown(materialInput.value, materialDropdown);
          selectedMaterialIndex = items.length > 0 ? 0 : -1;
        } else if (items.length > 0) {
          selectedMaterialIndex = (selectedMaterialIndex + 1) % items.length;
        }
        renderMaterialDropdown(materialInput.value, materialDropdown);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!materialDropdown.hidden && items.length > 0) {
          selectedMaterialIndex =
            selectedMaterialIndex <= 0 ? items.length - 1 : selectedMaterialIndex - 1;
          renderMaterialDropdown(materialInput.value, materialDropdown);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedMaterialIndex >= 0 && items[selectedMaterialIndex]) {
          applyMaterialSelection(items[selectedMaterialIndex]);
        } else if (materialInput.value.trim()) {
          // Keep current value, release focus
          materialDropdown.hidden = true;
          selectedMaterialIndex = -1;
          materialInput.blur();
          updateBackButtonState();
        } else {
          // If empty, revert to Other and release focus
          applyMaterialSelection('Other');
        }
        return;
      }

      if (e.key === 'Escape') {
        if (!materialDropdown.hidden) {
          e.preventDefault();
          e.stopPropagation();
          materialDropdown.hidden = true;
          selectedMaterialIndex = -1;
          updateBackButtonState();
          return;
        }
      }
    });

    materialDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.fw-suggestion-item');
      if (item && item.dataset.material) {
        applyMaterialSelection(item.dataset.material);
      }
    });
  }

  // Single page-wide listener closes whichever dropdown is open on an outside click
  document.addEventListener('click', (e) => {
    if (
      truckSuggestions &&
      !truckSuggestions.hidden &&
      truckInput &&
      !truckInput.contains(e.target) &&
      !truckSuggestions.contains(e.target)
    ) {
      truckSuggestions.hidden = true;
      selectedSuggestionIndex = -1;
      updateBackButtonState();
    }

    if (
      materialDropdown &&
      !materialDropdown.hidden &&
      materialInput &&
      !materialInput.contains(e.target) &&
      !materialDropdown.contains(e.target)
    ) {
      materialDropdown.hidden = true;
      selectedMaterialIndex = -1;
      updateBackButtonState();
    }
  });

  // Quick-Pick Buttons
  const quickPicks = document.querySelectorAll('.fw-quick-pick');
  quickPicks.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mat = btn.dataset.material;
      if (mat) {
        applyMaterialSelection(mat);
      }
    });
  });

  // 4. Optional Fields navigation & Enter chaining
  const fieldOrder = [
    'fw-driver-input',
    'fw-phone-input',
    'fw-client-input',
    'fw-challan-input',
    'fw-remarks-input',
  ];

  fieldOrder.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('focus', () => {
      if (el.value) {
        el.select();
      }
      updateBackButtonState();
    });

    el.addEventListener('input', () => {
      // If user typed over a prefilled value, remove the prefilled mark
      if (el.classList.contains('fw-input-prefilled') && el.value !== el.dataset.prefilled) {
        el.classList.remove('fw-input-prefilled');
      }
      updateRegisterStrip();
      updateFirstWeighPreview();
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (id === 'fw-remarks-input') {
          if (!e.shiftKey) {
            e.preventDefault();
            el.blur();
            updateBackButtonState();
          }
          return;
        }

        e.preventDefault();
        const nextId = fieldOrder[idx + 1];
        if (nextId) {
          const nextEl = document.getElementById(nextId);
          if (nextEl) nextEl.focus();
        }
      }
    });
  });

  // 5. Register Truck Button
  const registerBtn = document.getElementById('fw-btn-register-truck');
  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      doRegisterOrUpdateTruck();
      if (document.activeElement === registerBtn) {
        registerBtn.blur();
      }
      updateBackButtonState();
    });
  }

  // 6. Dynamic Back / Exit Field Button
  const backBtn = document.getElementById('fw-btn-back');
  if (backBtn) {
    // mousedown prevents stealing focus from active field before performing action
    backBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();

      const truckSug = document.getElementById('fw-truck-suggestions');
      const matDrop = document.getElementById('fw-material-dropdown');
      const isListOpen = (truckSug && !truckSug.hidden) || (matDrop && !matDrop.hidden);

      if (isListOpen) {
        if (truckSug) truckSug.hidden = true;
        if (matDrop) matDrop.hidden = true;
        updateBackButtonState();
        return;
      }

      const activeEl = document.activeElement;
      if (activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)) {
        activeEl.blur();
        updateBackButtonState();
        return;
      }

      handleFirstWeighBack();
    });
  }

  // 7. Capture / Recapture Button
  const captureBtn = document.getElementById('fw-btn-capture');
  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      doCaptureFirstWeigh();
    });
  }

  // 8. Preview Button (Deferred Commit via Print Modal)
  const previewBtn = document.getElementById('fw-btn-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (previewBtn.disabled) return;

      const dir = state.firstWeigh.direction;
      const truck = truckInput ? truckInput.value.trim().toUpperCase() : '';
      const material = materialInput ? materialInput.value.trim() : 'Other';
      const driver = document.getElementById('fw-driver-input')?.value.trim() || '';
      const client = document.getElementById('fw-client-input')?.value.trim() || '';
      const phone = document.getElementById('fw-phone-input')?.value.trim() || '';
      const challan = document.getElementById('fw-challan-input')?.value.trim() || '';
      const remarks = document.getElementById('fw-remarks-input')?.value.trim() || '';

      if (!dir || !truck || state.firstWeigh.capturedWeight === null) {
        showToast('Please enter truck registration and capture weight', 'warning');
        return;
      }

      if (state.firstWeigh._blockedByOpenTicket) {
        showToast('Cannot preview: this truck already has an open ticket', 'error');
        return;
      }

      const ticketId = peekNextTicketId();
      const isOut = dir === 'OUT';
      const weightType = isOut
        ? 'OUT WEIGHT (Tare First, Loaded Later)'
        : 'IN WEIGHT (Gross First, Empty Later)';
      const firstWeightType = isOut ? 'Tare' : 'Gross';
      const currentTimestamp =
        state.firstWeigh.capturedTimestamp || formatDateTime12H(new Date());
      const operatorName = state.activeOperator ? state.activeOperator.name : 'MD. RAJU';

      // Open Print Slip Modal with Deferred Commit semantics
      openPrintSlipModal({
        ticketId,
        truckNo: truck,
        driver,
        material,
        client,
        phone,
        challan,
        remarks,
        direction: weightType,
        grossWeight: !isOut ? state.firstWeigh.capturedWeight : null,
        tareWeight: isOut ? state.firstWeigh.capturedWeight : null,
        netWeight: null,
        firstTime: currentTimestamp,
        secondTime: 'Pending Second Weight',
        firstOperator: operatorName,
        secondOperator: null,
        operator: operatorName,
        isDeferredCommit: true,
        onDeferredConfirm: async () => {
          // Final safety re-check: verify truck does not have an open ticket right now
          const checkPlate = truck.trim().toUpperCase();
          const duplicateTicket = pendingTickets.find(
            (t) => (t.truckNo || '').trim().toUpperCase() === checkPlate
          );
          if (duplicateTicket) {
            closePrintModal();
            showToast(
              `Cannot save ticket: Truck ${truck} already has open ticket #${duplicateTicket.id}`,
              'error'
            );
            if (hapticAudio) hapticAudio.playError();
            evaluateTruckState();
            return false;
          }

          if (IS_PRODUCTION) {
            try {
              const saved = await commitFirstWeigh({
                ticketId,
                truckNo: truck,
                direction: state.firstWeigh.direction,
                driver,
                phone,
                material,
                client,
                challan,
                remarks,
                weightKg: state.firstWeigh.capturedWeight,
                firstWeightType,
                firstTime: currentTimestamp,
              });

              pendingTickets.unshift(saved);
              renderPendingTicketsTable();

              // Keep the printed slip aligned with the server-allocated number.
              const prefix = state.firstWeigh.direction === 'OUT' ? 'O' : 'I';
              const printedId = `${prefix}-${saved.id}`;
              const modalTicketId = document.getElementById('modal-ticket-id');
              if (modalTicketId) modalTicketId.textContent = `#${printedId}`;
              const docTicketNo = document.getElementById('doc-ticket-no');
              if (docTicketNo) docTicketNo.textContent = printedId;

              resetFirstWeighForm();
              showScreen('dashboard-screen');
              return true;
            } catch (err) {
              closePrintModal();
              showToast(err?.message || 'Ticket save failed — please try again', 'error');
              if (hapticAudio) hapticAudio.playError();
              evaluateTruckState();
              return false;
            }
          }

          // Transactional commit to pendingTickets
          const newTicket = {
            id: ticketId,
            truckNo: truck,
            driver,
            material,
            client,
            phone,
            challan,
            remarks,
            weightType,
            firstWeight: state.firstWeigh.capturedWeight ?? 0,
            firstWeightType,
            firstWeightTime: currentTimestamp,
            createdAt: new Date().toISOString(),
            firstOperator: operatorName,
          };

          // Reserve the displayed ID only now, at the moment of commit
          consumeTicketId(ticketId);
          pendingTickets.unshift(newTicket);
          renderPendingTicketsTable();

          // Trigger sync or update offline outbox
          if (state.sync.isHealthy) {
            triggerSync(false);
          } else {
            state.sync.pendingQueue++;
            updateSyncUI();
          }

          // Reset form and state
          resetFirstWeighForm();

          // Return to dashboard
          showScreen('dashboard-screen');
          return true;
        },
        onDeferredCancel: () => {
          // Keep operator on First Weigh screen with form and locked weight fully intact
        },
      });
    });
  }

  // Global focus listeners to maintain accurate back button state
  document.addEventListener('focusin', () => {
    if (state.currentScreen === 'first-weigh-screen') {
      updateBackButtonState();
    }
  });

  document.addEventListener('focusout', () => {
    if (state.currentScreen === 'first-weigh-screen') {
      setTimeout(() => updateBackButtonState(), 10);
    }
  });
}
