/**
 * Printable History Report
 * Range selection → current-operator PIN re-authentication → A4 portrait preview.
 * Production snapshots and PIN verification are owned by the C# workstation.
 */
import { state } from './state.js';
import { sendCommand } from './runtime.js';
import { showToast } from './toast.js';
import {
  HISTORY_REPORT_PAGE_CSS,
  renderHistoryReportDocument,
  summarizeTickets,
} from './history-report-document.js?v=prod17';
import { openVerifyReportModal } from './verify-report.js';
import { getSiteTodayDateValue } from './utils.js';

const PAGE_STYLE_ID = 'history-report-page-style';
const RANGE_VALUES = new Set(['today', 'yesterday', '7days', '30days', 'custom']);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

let bound = false;
let pendingRange = null;
let reportData = null;
let lastFocusedElement = null;
let generating = false;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRangeDate(date) {
  return `${pad(date.getDate())} ${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()}`;
}

function rangeLabel(fromDate, toDate) {
  if (fromDate.getTime() === toDate.getTime()) return formatRangeDate(fromDate);
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const from = sameYear
    ? `${pad(fromDate.getDate())} ${fromDate.toLocaleString('en-US', { month: 'short' })}`
    : formatRangeDate(fromDate);
  return `${from} – ${formatRangeDate(toDate)}`;
}

function selectedRange() {
  const value =
    document.querySelector('input[name="history-report-range"]:checked')?.value || 'today';
  const todayDateStr = getSiteTodayDateValue(state.siteTimezone);
  const today = parseDateValue(todayDateStr) || startOfDay(new Date());
  let from = today;
  let to = today;

  if (value === 'yesterday') {
    from = addDays(today, -1);
    to = from;
  } else if (value === '7days') {
    from = addDays(today, -6);
  } else if (value === '30days') {
    from = addDays(today, -29);
  } else if (value === 'custom') {
    const fromInput = document.getElementById('history-report-from');
    const toInput = document.getElementById('history-report-to');
    from = parseDateValue(fromInput?.value);
    to = parseDateValue(toInput?.value);
    if (!from || !to) throw new Error('Choose both dates for the custom report period.');
    if (from.getTime() > to.getTime()) throw new Error('The start date must be before the end date.');
    const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      throw new Error('Choose a report range of one year or less.');
    }
  }

  const fromDate = toDateValue(from);
  const toDate = toDateValue(to);
  return {
    value: RANGE_VALUES.has(value) ? value : 'today',
    fromDate,
    toDate,
    label: rangeLabel(from, to),
    fromMs: from.getTime(),
    toMs: addDays(to, 1).getTime(),
  };
}

function setCustomDefaults() {
  const from = document.getElementById('history-report-from');
  const to = document.getElementById('history-report-to');
  if (!from || !to) return;
  const todayDateStr = getSiteTodayDateValue(state.siteTimezone);
  const today = parseDateValue(todayDateStr) || startOfDay(new Date());
  if (!from.value) from.value = toDateValue(addDays(today, -29));
  if (!to.value) to.value = todayDateStr;
  from.max = todayDateStr;
  to.max = todayDateStr;
}

function updateCustomVisibility() {
  const value =
    document.querySelector('input[name="history-report-range"]:checked')?.value || 'today';
  const custom = document.getElementById('history-report-custom');
  if (custom) custom.hidden = value !== 'custom';
  if (value === 'custom') setCustomDefaults();
}

function showStage(name) {
  const setup = document.getElementById('history-report-setup');
  const pin = document.getElementById('history-report-pin');
  const preview = document.getElementById('history-report-preview');
  if (setup) setup.hidden = name !== 'setup';
  if (pin) pin.hidden = name !== 'pin';
  if (preview) preview.hidden = name !== 'preview';
}

function pinError(message = '') {
  const element = document.getElementById('history-report-pin-error');
  if (element) element.textContent = message;
}

function clearPin() {
  const input = document.getElementById('history-report-pin-input');
  if (input) input.value = '';
  pinError('');
}

function updateOperatorCard() {
  const operator = state.activeOperator;
  const name = document.getElementById('history-report-operator-name');
  const avatar = document.getElementById('history-report-operator-avatar');
  const range = document.getElementById('history-report-pin-range');
  if (name) name.textContent = operator?.name || 'Not signed in';
  if (avatar) avatar.src = operator?.avatar || 'avatars/frame-9.svg';
  if (range) range.textContent = pendingRange?.label || '—';
}

function goToPin() {
  try {
    pendingRange = selectedRange();
  } catch (err) {
    showToast(err.message, 'warning');
    return;
  }
  updateOperatorCard();
  clearPin();
  showStage('pin');
  const input = document.getElementById('history-report-pin-input');
  requestAnimationFrame(() => input?.focus());
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent.trim();
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || 'Generate report';
    button.disabled = false;
  }
}

async function generateReport() {
  if (generating) return;
  const operator = state.activeOperator;
  const input = document.getElementById('history-report-pin-input');
  const button = document.getElementById('history-report-generate');
  const pin = String(input?.value || '').trim();

  if (!operator) {
    pinError('Sign in again before generating a report.');
    return;
  }
  if (!pendingRange) {
    pinError('Choose a report period first.');
    return;
  }
  if (!pin) {
    pinError('Enter your PIN to continue.');
    input?.focus();
    return;
  }

  generating = true;
  pinError('');
  setBusy(button, true, 'Generating…');

  try {
    const report = await sendCommand('generateHistoryReport', {
      fromDate: pendingRange.fromDate,
      toDate: pendingRange.toDate,
      operatorId: operator.id,
      pin,
    });

    if (!report || !Array.isArray(report.tickets)) {
      throw new Error('The workstation returned an invalid report.');
    }

    reportData = report;
    renderHistoryReportDocument(
      document.getElementById('history-report-document'),
      report
    );
    const title = document.getElementById('history-report-preview-title');
    const meta = document.getElementById('history-report-preview-meta');
    const verifyButton = document.getElementById('history-report-verify');
    if (title) title.textContent = `${report.summary?.total || 0} ticket${report.summary?.total === 1 ? '' : 's'}`;
    if (meta) meta.textContent = `${report.rangeLabel} · ${report.reportId}`;
    if (verifyButton) verifyButton.disabled = false;
    input.value = '';
    showStage('preview');
    requestAnimationFrame(() => document.getElementById('history-report-print')?.focus());
  } catch (err) {
    pinError(err?.message || 'Report could not be generated. Try again.');
    if (input) {
      input.value = '';
      input.focus();
    }
  } finally {
    generating = false;
    setBusy(button, false);
  }
}

function removePrintMode() {
  document.body.classList.remove('printing-history-report');
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

function printReport() {
  if (!reportData) return;
  removePrintMode();

  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = HISTORY_REPORT_PAGE_CSS;
  document.head.appendChild(style);
  document.body.classList.add('printing-history-report');

  const cleanup = () => {
    removePrintMode();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  setTimeout(() => {
    try {
      window.print();
    } catch {
      cleanup();
      showToast('The print dialog could not be opened.', 'warning');
    }
  }, 80);
}

function closeReport() {
  const modal = document.getElementById('history-report-modal');
  if (!modal) return;
  removePrintMode();
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  state._historyReportOpen = false;
  reportData = null;
  pendingRange = null;
  generating = false;
  clearPin();
  showStage('setup');
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  lastFocusedElement = null;
}

export function openHistoryReportModal() {
  const modal = document.getElementById('history-report-modal');
  if (!modal) return;
  if (!state.activeOperator) {
    showToast('Sign in before generating a history report.', 'warning');
    return;
  }

  lastFocusedElement = document.activeElement;
  reportData = null;
  pendingRange = null;
  clearPin();
  pinError('');

  const today = document.querySelector('input[name="history-report-range"][value="today"]');
  if (today) today.checked = true;
  updateCustomVisibility();
  updateOperatorCard();
  showStage('setup');

  state._historyReportOpen = true;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => document.getElementById('history-report-continue')?.focus());
}

export function initHistoryReport() {
  if (bound) return;

  const modal = document.getElementById('history-report-modal');
  if (!modal) return;
  bound = true;

  document.getElementById('history-report-close')?.addEventListener('click', closeReport);
  document.querySelectorAll('[data-report-close]').forEach((button) => {
    button.addEventListener('click', closeReport);
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeReport();
  });

  document.querySelectorAll('input[name="history-report-range"]').forEach((input) => {
    input.addEventListener('change', updateCustomVisibility);
  });

  document.getElementById('history-report-from')?.addEventListener('change', updateCustomVisibility);
  document.getElementById('history-report-to')?.addEventListener('change', updateCustomVisibility);

  document.getElementById('history-report-continue')?.addEventListener('click', goToPin);
  document.getElementById('history-report-pin-back')?.addEventListener('click', () => {
    clearPin();
    showStage('setup');
  });
  document.getElementById('history-report-generate')?.addEventListener('click', generateReport);
  document.getElementById('history-report-change')?.addEventListener('click', () => {
    removePrintMode();
    clearPin();
    showStage('setup');
    requestAnimationFrame(() => document.getElementById('history-report-continue')?.focus());
  });
  document.getElementById('history-report-print')?.addEventListener('click', printReport);
  document.getElementById('history-report-verify')?.addEventListener('click', () => {
    if (!reportData) return;
    openVerifyReportModal({
      reportId: reportData.reportId,
      integrityHash: reportData.integrityHash,
    });
  });

  const pinInput = document.getElementById('history-report-pin-input');
  pinInput?.addEventListener('input', () => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 8);
    if (pinInput.value) pinError('');
  });
  pinInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      generateReport();
    }
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (!state._historyReportOpen) return;
      if (document.getElementById('verify-report-modal')?.classList.contains('open')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        const previewVisible = !document.getElementById('history-report-preview')?.hidden;
        if (reportData && previewVisible) printReport();
        else showToast('Generate the report before printing.', 'warning');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement === pinInput) {
          clearPin();
          showStage('setup');
        } else {
          closeReport();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll(
        'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden])'
      )].filter((element) => !element.closest('[hidden]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true
  );
}
