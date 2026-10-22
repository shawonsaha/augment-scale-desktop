/**
 * Printable History Report
 * Range selection → current-operator PIN re-authentication → A4 portrait preview.
 * Production snapshots and PIN verification are owned by the C# workstation.
 */
import { state, getAllTickets, getTicketStatus, getTicketTimestamp } from './state.js';
import { IS_PRODUCTION, sendCommand } from './runtime.js';
import { verifyPin } from './pin-auth.js';
import { showToast } from './toast.js';
import { escapeHtml, formatFullDateTime, formatShortDate } from './utils.js';
import { openVerifyReportModal } from './verify-report.js';

const PAGE_STYLE_ID = 'history-report-page-style';
const RANGE_VALUES = new Set(['today', 'yesterday', '7days', '30days', 'custom']);

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

function formatKg(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value)).toLocaleString('en-US')} kg`;
}

function formatTonnes(value) {
  if (value === null || value === undefined) return '0.000';
  return (Number(value) / 1000).toFixed(3);
}

function statusOf(ticket) {
  return getTicketStatus(ticket);
}

function statusLabel(ticket) {
  return { pending: 'Pending', completed: 'Completed', voided: 'Voided', deleted: 'Deleted' }[
    statusOf(ticket)
  ] || 'Pending';
}

function directionOf(ticket) {
  return String(ticket.direction || ticket.weightType || '').toUpperCase().includes('OUT')
    ? 'OUT'
    : 'IN';
}

function hasOverride(ticket) {
  return Boolean(ticket?.override || ticket?.overridden || ticket?.isOverridden);
}

function businessDate(ticket) {
  const ms = ticket.businessAt ? new Date(ticket.businessAt).getTime() : getTicketTimestamp(ticket);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

function operatorFor(ticket, which) {
  return which === 'first'
    ? ticket.firstOperator || '—'
    : ticket.secondOperator || 'Pending';
}

function reprintEntries(ticket) {
  const log = Array.isArray(ticket.printLog) ? ticket.printLog : [];
  return log.filter((entry) => entry.type === 'reprint' || Number(entry.copyNumber) > 1);
}

function summarize(tickets) {
  const summary = {
    total: tickets.length,
    completed: 0,
    pending: 0,
    voided: 0,
    deleted: 0,
    overrides: 0,
    reprints: 0,
    netKg: 0,
  };

  for (const ticket of tickets) {
    const status = statusOf(ticket);
    if (status === 'completed') {
      summary.completed += 1;
      summary.netKg += Number(ticket.netWeight) || 0;
    } else if (status === 'voided') {
      summary.voided += 1;
    } else if (status === 'deleted') {
      summary.deleted += 1;
    } else {
      summary.pending += 1;
    }
    if (hasOverride(ticket)) summary.overrides += 1;
    const entries = reprintEntries(ticket);
    summary.reprints += entries.length || Math.max(0, Number(ticket.printCount || 1) - 1);
  }

  return summary;
}

function selectedRange() {
  const value =
    document.querySelector('input[name="history-report-range"]:checked')?.value || 'today';
  const today = startOfDay(new Date());
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
  if (!from.value) from.value = toDateValue(addDays(new Date(), -29));
  if (!to.value) to.value = toDateValue(new Date());
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

function buildDemoReport(range, operator) {
  const tickets = getAllTickets()
    .filter((ticket) => {
      const at = businessDate(ticket);
      if (!at) return false;
      const ms = at.getTime();
      return ms >= range.fromMs && ms < range.toMs;
    })
    .sort((a, b) => (businessDate(a)?.getTime() || 0) - (businessDate(b)?.getTime() || 0))
    .map((ticket) => ({
      ...ticket,
      businessAt: businessDate(ticket)?.toISOString() || null,
    }));

  const now = new Date();
  return {
    reportId: `DEMO-${now.getTime().toString(36).toUpperCase()}`,
    generatedAt: now.toISOString(),
    workstationName: 'Browser preview',
    rangeLabel: range.label,
    fromDate: range.fromDate,
    toDate: range.toDate,
    operatorId: operator.id,
    operatorName: operator.name,
    integrityHash: 'DEMO-PREVIEW-NOT-ARCHIVED',
    isDemo: true,
    tickets,
    summary: summarize(tickets),
  };
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
    let report;
    if (IS_PRODUCTION) {
      report = await sendCommand('generateHistoryReport', {
        fromDate: pendingRange.fromDate,
        toDate: pendingRange.toDate,
        operatorId: operator.id,
        pin,
      });
    } else {
      if (!verifyPin(operator, pin)) {
        pinError('Wrong PIN. Try again.');
        input.value = '';
        input.focus();
        return;
      }
      report = buildDemoReport(pendingRange, operator);
    }

    if (!report || !Array.isArray(report.tickets)) {
      throw new Error('The workstation returned an invalid report.');
    }

    reportData = report;
    renderReport(report);
    const title = document.getElementById('history-report-preview-title');
    const meta = document.getElementById('history-report-preview-meta');
    const verifyButton = document.getElementById('history-report-verify');
    if (title) title.textContent = `${report.summary?.total || 0} ticket${report.summary?.total === 1 ? '' : 's'}`;
    if (meta) meta.textContent = `${report.rangeLabel} · ${report.reportId}`;
    if (verifyButton) verifyButton.disabled = Boolean(report.isDemo);
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

function reportTimestamp(input) {
  return formatShortDate(input).replace(/\s+\d{4}\s+/, ' ');
}

function weighHtml(value, type, operator, timestamp) {
  const label = String(type || 'Weight').toUpperCase();
  if (value === null || value === undefined) {
    return `
      <td class="report-weigh report-weigh--pending">
        <strong>${escapeHtml(label)} · PENDING</strong>
        <span>Awaiting second weigh</span>
      </td>
    `;
  }
  const meta = [operator || '—', reportTimestamp(timestamp) || '—'].join(' · ');
  return `
    <td class="report-weigh">
      <strong>${escapeHtml(label)} · ${formatKg(value)}</strong>
      <span>${escapeHtml(meta)}</span>
    </td>
  `;
}

function exceptionRows(tickets) {
  const rows = [];
  for (const ticket of tickets) {
    if (hasOverride(ticket)) {
      rows.push({
        ticket,
        type: 'Override',
        reason: ticket.override?.reason || 'Override recorded',
        by: ticket.override?.operator || '—',
        at: ticket.override?.timestamp,
      });
    }
    const status = statusOf(ticket);
    if (status === 'voided') {
      rows.push({
        ticket,
        type: 'Void',
        reason: ticket.voidedReason || 'No reason recorded',
        by: ticket.voidedBy || '—',
        at: ticket.voidedAt,
      });
    }
    if (status === 'deleted') {
      rows.push({
        ticket,
        type: 'Delete',
        reason: ticket.deletedReason || 'No reason recorded',
        by: ticket.deletedBy || '—',
        at: ticket.deletedAt,
      });
    }
  }
  return rows;
}

function reprintRows(tickets) {
  const rows = [];
  for (const ticket of tickets) {
    const entries = reprintEntries(ticket);
    if (entries.length > 0) {
      for (const entry of entries) {
        rows.push({
          ticket,
          copy: entry.copyNumber || 2,
          by: entry.by || '—',
          at: entry.at,
          reason: entry.reason || '—',
        });
      }
    } else if (Number(ticket.printCount) > 1) {
      rows.push({
        ticket,
        copy: ticket.printCount,
        by: '—',
        at: null,
        reason: 'Reprint count recorded',
      });
    }
  }
  return rows;
}

function renderReport(report) {
  const documentElement = document.getElementById('history-report-document');
  if (!documentElement) return;

  const tickets = Array.isArray(report.tickets) ? report.tickets : [];
  const summary = report.summary || summarize(tickets);
  const exceptions = exceptionRows(tickets);
  const reprints = reprintRows(tickets);

  const rows = tickets
    .map((ticket) => {
      const status = statusOf(ticket);
      const direction = directionOf(ticket);
      const firstType = ticket.firstWeightType || (direction === 'IN' ? 'Gross' : 'Tare');
      const secondType = ticket.secondWeightType || (firstType === 'Gross' ? 'Tare' : 'Gross');
      const net = ticket.netWeight;
      const hasNet = net !== null && net !== undefined;
      const netAnomaly = hasNet && Number(net) <= 0;
      const override = hasOverride(ticket) ? ticket.override || {} : null;
      const overrideReason = override?.reason || 'Override recorded';

      return `
        <tr class="report-row report-row--${escapeHtml(status)}">
          <td class="report-ticket">
            <strong>#${ticket.id}</strong>
            <span class="report-direction report-direction--${direction.toLowerCase()}">${direction}</span>
          </td>
          <td class="report-truck">
            <strong>${escapeHtml(ticket.truckNo || '—')}</strong>
            <span>${escapeHtml(ticket.driver || '—')}</span>
          </td>
          ${weighHtml(ticket.firstWeight, firstType, ticket.firstOperator, ticket.firstWeightTime)}
          ${weighHtml(ticket.secondWeight, secondType, ticket.secondOperator, ticket.secondWeightTime)}
          <td class="report-net">
            ${hasNet ? `<span class="${netAnomaly ? 'report-net-value report-net-value--anomaly' : 'report-net-value'}">${formatKg(net)}</span>` : '—'}
          </td>
          <td class="report-status-cell">
            <span class="report-status report-status--${escapeHtml(status)}">${escapeHtml(statusLabel(ticket))}</span>
            ${override ? `<span class="report-flags">OVR</span><span class="report-override-note">${escapeHtml(overrideReason)}</span>` : ''}
          </td>
        </tr>
      `;
    })
    .join('');

  const exceptionSection =
    exceptions.length === 0
      ? ''
      : `
        <section class="report-appendix">
          <h2>Exception register</h2>
          <table class="report-table report-table--appendix">
            <thead>
              <tr><th>Ticket</th><th>Type</th><th>Reason</th><th>Authorised by</th><th>Timestamp</th></tr>
            </thead>
            <tbody>
              ${exceptions
                .map(
                  (row) => `
                    <tr>
                      <td>#${row.ticket.id}</td>
                      <td>${escapeHtml(row.type)}</td>
                      <td>${escapeHtml(row.reason)}</td>
                      <td>${escapeHtml(row.by)}</td>
                      <td>${escapeHtml(formatFullDateTime(row.at) || '—')}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `;

  const reprintSection =
    reprints.length === 0
      ? ''
      : `
        <section class="report-appendix">
          <h2>Reprint register</h2>
          <table class="report-table report-table--appendix">
            <thead>
              <tr><th>Ticket</th><th>Copy</th><th>Reprinted by</th><th>Timestamp</th><th>Reason</th></tr>
            </thead>
            <tbody>
              ${reprints
                .map(
                  (row) => `
                    <tr>
                      <td>#${row.ticket.id}</td>
                      <td>${escapeHtml(row.copy)}</td>
                      <td>${escapeHtml(row.by)}</td>
                      <td>${escapeHtml(formatFullDateTime(row.at) || '—')}</td>
                      <td>${escapeHtml(row.reason)}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `;

  documentElement.innerHTML = `
    <header class="report-header">
      <div class="report-heading">
        <h1>Weighbridge History Report</h1>
        <span>Daily weighbridge ledger · all ticket states</span>
      </div>
      <div class="report-identity">
        <span>Report</span>
        <strong>${escapeHtml(report.reportId || '—')}</strong>
        <span>${escapeHtml(report.rangeLabel || '')}</span>
      </div>
    </header>

    <div class="report-integrity-line">
      <span>${report.isDemo ? 'Demo preview' : 'SHA-256 integrity hash'}</span>
      <code>${escapeHtml(report.integrityHash || '—')}</code>
    </div>

    <section class="report-meta">
      <div><span>Report period</span><strong>${escapeHtml(report.rangeLabel || '—')}</strong></div>
      <div><span>Generated by</span><strong>${escapeHtml(report.operatorName || '—')}</strong></div>
      <div><span>Generated at</span><strong>${escapeHtml(formatFullDateTime(report.generatedAt) || '—')}</strong></div>
      <div><span>Workstation</span><strong>${escapeHtml(report.workstationName || 'Workstation')}</strong></div>
    </section>

    <section class="report-summary">
      <div><span>Total tickets</span><strong>${summary.total || 0}</strong></div>
      <div><span>Completed</span><strong>${summary.completed || 0}</strong></div>
      <div><span>Pending</span><strong>${summary.pending || 0}</strong></div>
      <div><span>Voided / deleted</span><strong>${(summary.voided || 0) + (summary.deleted || 0)}</strong></div>
      <div><span>Overrides</span><strong>${summary.overrides || 0}</strong></div>
      <div><span>Reprints</span><strong>${summary.reprints || 0}</strong></div>
      <div class="report-summary-net">
        <span>Completed net</span>
        <strong>${formatTonnes(summary.netKg)} MT</strong>
      </div>
    </section>

    <section class="report-ledger-section">
      <div class="report-section-heading">
        <h2>Ticket ledger</h2>
        <span>${tickets.length} record${tickets.length === 1 ? '' : 's'} · chronological</span>
      </div>
      ${
        tickets.length === 0
          ? '<p class="report-empty">No tickets were recorded in this period.</p>'
          : `
            <table class="report-table report-table--ledger">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Truck / driver</th>
                  <th>First weigh</th>
                  <th>Second weigh</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          `
      }
    </section>

    ${exceptionSection}
    ${reprintSection}

    <footer class="report-footer">
      <span>${escapeHtml(report.reportId || '')} · ${escapeHtml(report.rangeLabel || '')}</span>
      <span class="report-powered">Powered by augmentlab.net</span>
    </footer>
  `;
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
  style.textContent = `@media print {
  @page {
    size: A4 portrait;
    margin: 10mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      color: #4b5563;
    }
  }
}`;
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
    if (!reportData || reportData.isDemo) return;
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
