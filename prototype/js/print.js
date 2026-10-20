/**
 * Ticket & Certificate Print Modal
 * Formats industrial 12H scale slips and weighbridge certificates.
 * Supports immediate print (First Weigh) and deferred commit with preview (Second Weigh).
 */
import { ensureFullTimestamp, formatDateTime12H } from './utils.js';
import { showScreen } from './router.js';
import hapticAudio from './audio.js';
import { showToast } from './toast.js';
import {
  state,
  pendingTickets,
  setPendingTickets,
  completedTickets,
  REGISTERED_TRUCKS,
  recordReprint,
  logAction,
} from './state.js';
import { openReasonDialog } from './reason-dialog.js';
import { renderPendingTicketsTable } from './screens/dashboard.js';
import { triggerSync, updateSyncUI } from './sync.js';

let activeModalData = null;
let confirmInProgress = false;

// Double-Enter protection flag
if (typeof window !== 'undefined') {
  window._printConfirmReady = false;
}

export function openPrintSlipModal(data) {
  const modal = document.getElementById('print-modal');
  if (!modal) return;

  activeModalData = data;
  confirmInProgress = false;

  const watermark = document.getElementById('ticket-reprint-watermark');
  if (watermark) watermark.style.display = data.isReprint ? 'block' : 'none';
  if (typeof window !== 'undefined') {
    window._printConfirmReady = false;
    setTimeout(() => {
      window._printConfirmReady = true;
    }, 150);
  }

  const confirmBtn = document.getElementById('btn-print-slip');
  if (confirmBtn) {
    confirmBtn.disabled = false;
  }

  const dir = String(data.direction || '').toUpperCase();
  const isOut = dir.includes('OUT');
  const prefix = isOut ? 'O' : 'I';
  const formattedWeightId = `${prefix}-${data.ticketId}`;
  const weightTypeStr = isOut ? 'OUT WEIGHT' : 'IN WEIGHT';

  // Modal Header badge
  const modalTicketId = document.getElementById('modal-ticket-id');
  if (modalTicketId) modalTicketId.textContent = `#${formattedWeightId}`;

  // Document Fields
  const docTicketNo = document.getElementById('doc-ticket-no');
  if (docTicketNo) docTicketNo.textContent = formattedWeightId;

  const docWeightType = document.getElementById('doc-weight-type');
  if (docWeightType) docWeightType.textContent = weightTypeStr;

  const docTruckNo = document.getElementById('doc-truck-no');
  if (docTruckNo) docTruckNo.textContent = data.truckNo || '------';

  const docOperator = document.getElementById('doc-operator');
  if (docOperator) {
    const firstOp = (data.firstOperator || data.operator || '').trim();
    const secondOp = (data.secondOperator || '').trim();
    if (firstOp && secondOp && firstOp !== secondOp) {
      docOperator.textContent = `${firstOp} (1st)\n${secondOp} (2nd)`;
    } else {
      docOperator.textContent = firstOp || secondOp || 'MD. RAJU';
    }
  }

  // ── Conditional Fields Helper ─────────────────────────────────────────
  function setPairRow(rowEl, th1, td1, label1, val1, th2, td2, label2, val2) {
    if (!rowEl) return;
    const v1 = (val1 || '').trim();
    const v2 = (val2 || '').trim();
    if (v1 && v2) {
      rowEl.style.display = '';
      if (th1) th1.textContent = label1;
      if (td1) {
        td1.textContent = v1;
        td1.colSpan = 1;
      }
      if (th2) th2.style.display = '';
      if (td2) {
        td2.style.display = '';
        td2.textContent = v2;
      }
    } else if (v1 || v2) {
      rowEl.style.display = '';
      if (th1) th1.textContent = v1 ? label1 : label2;
      if (td1) {
        td1.textContent = v1 || v2;
        td1.colSpan = 3;
      }
      if (th2) th2.style.display = 'none';
      if (td2) {
        td2.style.display = 'none';
        td2.textContent = v2;
      }
    } else {
      rowEl.style.display = 'none';
    }
  }

  // Material & Client
  const isOther =
    !data.material ||
    ['other', 'others', '-', '--', '------', 'n/a'].includes(data.material.toLowerCase().trim());
  setPairRow(
    document.getElementById('doc-row-material-client'),
    document.getElementById('doc-th-material'),
    document.getElementById('doc-material'),
    'Material',
    isOther ? '' : data.material,
    document.getElementById('doc-th-client'),
    document.getElementById('doc-client'),
    'Client',
    data.client
  );

  // Driver & Phone
  const driverRow = document.getElementById('doc-row-driver-phone');
  setPairRow(
    driverRow,
    driverRow?.querySelector('th'),
    document.getElementById('doc-driver-name'),
    'Driver',
    data.driver,
    document.getElementById('doc-th-phone'),
    document.getElementById('doc-phone'),
    'Phone',
    data.phone
  );

  // Challan & Remarks (Appends override audit if present)
  let remarksText = data.remarks || '';
  if (data.override) {
    const auditText = `OVERRIDE: ${data.override.reason} (Auth: ${data.override.operator})`;
    remarksText = remarksText ? `${remarksText} • ${auditText}` : auditText;
  }
  const challanRow = document.getElementById('doc-row-challan-remarks');
  setPairRow(
    challanRow,
    challanRow?.querySelector('th'),
    document.getElementById('doc-challan'),
    'Challan / Gate Pass',
    data.challan,
    document.getElementById('doc-th-remarks'),
    document.getElementById('doc-remarks'),
    'Remarks',
    remarksText
  );

  // Weight Rows with Mandatory 12H Timestamps
  const grossValEl = document.getElementById('doc-gross-val');
  const grossTimeEl = document.getElementById('doc-gross-time');
  const tareValEl = document.getElementById('doc-tare-val');
  const tareTimeEl = document.getElementById('doc-tare-time');
  const netValEl = document.getElementById('doc-net-val');
  const netTimeEl = document.getElementById('doc-net-time');

  const firstTs = ensureFullTimestamp(data.firstTime);
  const secondTs = ensureFullTimestamp(data.secondTime);

  // Gross Weight
  if (data.grossWeight) {
    grossValEl.textContent = `${data.grossWeight.toLocaleString()}`;
    const grossTime = !isOut ? firstTs || formatDateTime12H() : secondTs || formatDateTime12H();
    grossTimeEl.textContent = grossTime;
  } else {
    grossValEl.textContent = '------';
    grossTimeEl.textContent = 'Pending 2nd Weigh';
  }

  // Tare Weight
  if (data.tareWeight) {
    tareValEl.textContent = `${data.tareWeight.toLocaleString()}`;
    const tareTime = isOut ? firstTs || formatDateTime12H() : secondTs || formatDateTime12H();
    tareTimeEl.textContent = tareTime;
  } else {
    tareValEl.textContent = '------';
    tareTimeEl.textContent = 'Pending 2nd Weigh';
  }

  // Net Weight
  if (data.netWeight !== null && data.netWeight !== undefined) {
    netValEl.textContent = `${data.netWeight.toLocaleString()}`;
    netTimeEl.textContent = secondTs || formatDateTime12H();
  } else {
    netValEl.textContent = 'PENDING 2ND WEIGH';
    netTimeEl.textContent = '------';
  }

  modal.classList.add('open');
  if (hapticAudio) hapticAudio.playSuccess();
}

/**
 * Closes the print modal.
 * If previewing deferred commit (Second Weigh), keeps current screen intact.
 * Otherwise (First Weigh completed), navigates back to dashboard.
 */
export function closePrintModal() {
  const modal = document.getElementById('print-modal');
  if (modal) modal.classList.remove('open');

  const isDeferred = activeModalData?.isDeferredCommit;
  const stayOnScreen = Boolean(activeModalData?.stayOnScreen);
  const onCancel = activeModalData?.onDeferredCancel;
  const watermark = document.getElementById('ticket-reprint-watermark');
  if (watermark) watermark.style.display = 'none';
  activeModalData = null;
  if (typeof window !== 'undefined') {
    window._printConfirmReady = false;
  }

  if (typeof onCancel === 'function') {
    onCancel();
  } else if (!isDeferred && !stayOnScreen) {
    showScreen('dashboard-screen');
  }
}

/**
 * Reprints a stored certificate (or first-weigh slip) without recalculating
 * anything. Requires a reason, stamps the paper and appends to the print log.
 */
export function openReprintModal(ticket) {
  if (!ticket || ticket.id === undefined) return;

  openReasonDialog({
    id: 'reprint-reason-modal',
    title: ticket.secondWeight
      ? `Reprint certificate #${ticket.id}?`
      : `Reprint first-weigh slip #${ticket.id}?`,
    metaHtml: `${ticket.truckNo || ''} — ${ticket.material || 'Material'}${ticket.secondWeight ? '' : '<br><strong>First weight only</strong> — first-weigh slip will be printed'}`,
    prompt: 'Reason for reprint:',
    reasons: ['Customer requested copy', 'Original lost', 'Bad print quality', 'Other'],
    confirmLabel: 'Print Copy',
    confirmTone: 'warning',
    stateFlag: '_reprintDialogOpen',
    onConfirm: (reason) => {
      const operator = state.activeOperator?.name || 'Unknown';
      const copyNumber = recordReprint(ticket, reason, operator);
      const now = new Date();
      const reprintStamp = `Reprint by ${operator} on ${formatDateTime12H(now)} — ${reason}`;
      const data = buildReprintData(ticket);
      data.reprintStamp = reprintStamp;
      data.remarks = ticket.remarks ? `${ticket.remarks} • ${reprintStamp}` : reprintStamp;

      openPrintSlipModal(data);
      document.dispatchEvent(
        new CustomEvent('history:refresh', { detail: { ticketId: ticket.id } })
      );
      showToast(`Reprint copy #${copyNumber} ready`, 'info');
    },
  });
}

/** Maps any ticket shape (pending, completed, voided) onto the print modal. */
function buildReprintData(ticket) {
  const rawDirection = String(ticket.direction || ticket.weightType || '').toUpperCase();
  const direction = rawDirection.includes('OUT') ? 'OUT' : 'IN';
  const firstType = ticket.firstWeightType || (direction === 'OUT' ? 'Tare' : 'Gross');
  const grossWeight =
    ticket.grossWeight !== undefined && ticket.grossWeight !== null
      ? ticket.grossWeight
      : firstType === 'Gross'
        ? ticket.firstWeight
        : null;
  const tareWeight =
    ticket.tareWeight !== undefined && ticket.tareWeight !== null
      ? ticket.tareWeight
      : firstType === 'Tare'
        ? ticket.firstWeight
        : null;

  return {
    ticketId: ticket.id,
    truckNo: ticket.truckNo,
    driver: ticket.driver,
    phone: ticket.phone || '',
    material: ticket.material,
    client: ticket.client,
    direction,
    grossWeight,
    tareWeight,
    netWeight: ticket.netWeight ?? null,
    firstTime: ticket.firstWeightTime,
    secondTime: ticket.secondWeightTime || null,
    firstOperator: ticket.firstOperator,
    secondOperator: ticket.secondOperator,
    operator: ticket.secondOperator || ticket.firstOperator,
    challan: ticket.challan || '',
    remarks: ticket.remarks || '',
    isReprint: true,
    stayOnScreen: true,
  };
}

/**
 * Handles Confirm & Print button action.
 * If deferred commit, writes mutations atomically, updates UI, then prints.
 */
async function handleConfirmAndPrint() {
  if (confirmInProgress) return;
  const modal = document.getElementById('print-modal');
  const confirmBtn = document.getElementById('btn-print-slip');

  if (!activeModalData?.isDeferredCommit) {
    // Standard completed print (or a reprint)
    const wasReprint = Boolean(activeModalData?.isReprint);
    closePrintModal();
    showToast(
      wasReprint ? 'Reprint sent to printer' : 'Print command sent • Document archived',
      'success'
    );
    if (hapticAudio) hapticAudio.playSuccess();
    setTimeout(() => {
      try {
        window.print();
      } catch {
        showToast('Print command failed', 'warning');
      }
    }, 100);
    return;
  }

  // Generic deferred callback (e.g., First Weigh)
  if (typeof activeModalData.onDeferredConfirm === 'function') {
    confirmInProgress = true;
    if (confirmBtn) confirmBtn.disabled = true;
    try {
      await activeModalData.onDeferredConfirm();
      if (modal) modal.classList.remove('open');
      activeModalData = null;
      if (typeof window !== 'undefined') {
        window._printConfirmReady = false;
      }
      showToast('Document archived • Print command sent', 'success');
      if (hapticAudio) hapticAudio.playSuccess();
      setTimeout(() => {
        try {
          window.print();
        } catch {
          showToast('Certificate saved. Print failed — click to retry', 'warning');
        }
      }, 100);
    } catch (err) {
      showToast(err.message || 'Save failed — please try again', 'error');
      if (confirmBtn) confirmBtn.disabled = false;
    } finally {
      confirmInProgress = false;
    }
    return;
  }

  // Deferred Save Commit (Second Weigh)
  confirmInProgress = true;
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const t = state.secondWeigh.selectedTicket;
    if (!t) throw new Error('No ticket selected');

    if (!pendingTickets.some((item) => item.id === t.id)) {
      throw new Error('This ticket is no longer pending or was already processed');
    }

    // Preserve both operators for the audit trail before the ticket leaves pending
    t.secondOperator =
      activeModalData.secondOperator || activeModalData.operator || t.firstOperator || '';
    t.secondCompletedAt = activeModalData.secondTime || new Date().toISOString();

    // Atomic transaction: remove from pending, trigger sync
    setPendingTickets(pendingTickets.filter((item) => item.id !== t.id));
    renderPendingTicketsTable();

    // Archive to the completed ledger for History (stored values, never recalculated)
    const completedAt = new Date().toISOString();
    const completedTicket = {
      ...t,
      status: 'completed',
      secondWeight: state.secondWeigh.capturedWeight,
      secondWeightType: t.firstWeightType === 'Gross' ? 'Tare' : 'Gross',
      secondWeightTime: activeModalData.secondTime || formatDateTime12H(new Date()),
      grossWeight: activeModalData.grossWeight,
      tareWeight: activeModalData.tareWeight,
      netWeight: activeModalData.netWeight,
      completedAt,
      printCount: 1,
      printLog: [
        {
          by: state.activeOperator?.name || t.firstOperator || 'Unknown',
          at: completedAt,
          type: 'weighbridge_certificate',
          reason: null,
        },
      ],
    };
    completedTickets.unshift(completedTicket);

    const truckIdx = REGISTERED_TRUCKS.findIndex(
      (truck) => (truck.plate || '').toUpperCase() === (completedTicket.truckNo || '').toUpperCase()
    );
    if (truckIdx >= 0) {
      REGISTERED_TRUCKS[truckIdx].lastWeighed = completedAt;
      REGISTERED_TRUCKS[truckIdx].tripCount = (REGISTERED_TRUCKS[truckIdx].tripCount || 0) + 1;
      REGISTERED_TRUCKS[truckIdx].lastTare = completedTicket.tareWeight;
    }
    logAction('complete_weigh', 'ticket', completedTicket.id, {
      netWeight: completedTicket.netWeight,
    });
    document.dispatchEvent(
      new CustomEvent('history:refresh', { detail: { ticketId: completedTicket.id } })
    );

    if (activeModalData.override) {
      t.overridden = true;
      t.override = activeModalData.override;
    }

    if (state.sync.isHealthy) {
      triggerSync(false);
    } else {
      state.sync.pendingQueue++;
      updateSyncUI();
    }

    // Close modal and reset second-weigh state
    if (modal) modal.classList.remove('open');
    activeModalData = null;
    if (typeof window !== 'undefined') {
      window._printConfirmReady = false;
    }

    state.secondWeigh.selectedTicket = null;
    state.secondWeigh.capturedWeight = null;
    state.secondWeigh.isOverridden = false;
    state.secondWeigh.overrideReason = null;
    state.secondWeigh.overrideTimestamp = null;
    state.secondWeigh.overrideOperator = null;
    state.secondWeigh.overrideAnomalyDetails = null;

    showScreen('dashboard-screen');
    showToast('Document archived • Print command sent', 'success');
    if (hapticAudio) hapticAudio.playSuccess();

    // Trigger print after UI transition
    setTimeout(() => {
      try {
        window.print();
      } catch {
        showToast('Certificate saved. Print failed — click to retry', 'warning');
      }
    }, 100);
  } catch (err) {
    showToast(err.message || 'Save failed — please try again', 'error');
    if (confirmBtn) confirmBtn.disabled = false;
  } finally {
    confirmInProgress = false;
  }
}

export function initPrintModal() {
  const closeBtn = document.getElementById('btn-close-modal');
  const doneBtn = document.getElementById('btn-modal-done');
  const printSlipBtn = document.getElementById('btn-print-slip');

  if (closeBtn) closeBtn.addEventListener('click', closePrintModal);
  if (doneBtn) doneBtn.addEventListener('click', closePrintModal);

  if (printSlipBtn) {
    printSlipBtn.addEventListener('click', handleConfirmAndPrint);
  }
}
