/**
 * Screen: History ledger
 * Paginated, no-scroll view of pending + completed + voided + deleted tickets.
 * Date/search filters, grouped advanced filters, sortable columns, detail panel,
 * reprint/void actions and the printable history report.
 */
import {
  state,
  OPERATORS,
  getAllTickets,
  getTicketStatus,
  getTicketTimestamp,
  voidTicket,
} from '../state.js';
import { openReprintModal } from '../print.js';
import { openReasonDialog } from '../reason-dialog.js';
import { openHistoryReportModal } from '../history-report.js';
import { openVerifyReportModal } from '../verify-report.js';
import { showScreen } from '../router.js';
import { showToast } from '../toast.js';
import { escapeHtml, formatFullDateTime } from '../utils.js';

const FALLBACK_ROW_HEIGHT = 68;
const MIN_PAGE_SIZE = 5;
const POPOVER_MARGIN = 12;

const FILTER_KEYS = [
  'statuses',
  'drivers',
  'operators',
  'materials',
  'clients',
  'directions',
  'flags',
];

const FILTER_GROUPS = {
  statuses: 'Status',
  drivers: 'Drivers',
  operators: 'Operators',
  materials: 'Materials',
  clients: 'Clients',
  directions: 'Direction',
  flags: 'Flags',
};

const STATUS_OPTIONS = [
  ['pending', 'Pending'],
  ['completed', 'Completed'],
  ['voided', 'Voided'],
  ['deleted', 'Deleted'],
];

const FLAG_OPTIONS = [
  ['overridden', 'Overridden only'],
  ['reprinted', 'Reprinted only'],
];

const SORT_KEYS = new Set([
  'id',
  'when',
  'truck',
  'first',
  'second',
  'net',
  'status',
  'prints',
]);

let filtered = [];
let pageSize = 20;
let focusedIndex = 0;

// ─── Small formatting helpers ───────────────────────────────────────────────

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatKg(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value).toLocaleString('en-US')}`;
}

function operatorFor(ticket, which) {
  const name = which === 'first' ? ticket.firstOperator : ticket.secondOperator;
  const avatar = which === 'first' ? ticket.firstOperatorAvatar : ticket.secondOperatorAvatar;
  if (name && avatar) return { name, avatar };
  const match = OPERATORS.find((op) => op.name === name);
  return {
    name: name || '',
    avatar: avatar || match?.avatar || 'avatars/frame-9.svg',
  };
}

function hasOverride(ticket) {
  return Boolean(ticket?.override || ticket?.overridden || ticket?.isOverridden);
}

function reprintEntries(ticket) {
  const log = Array.isArray(ticket?.printLog) ? ticket.printLog : [];
  return log.filter((entry) => entry.type === 'reprint' || Number(entry.copyNumber) > 1);
}

function isReprinted(ticket) {
  return reprintEntries(ticket).length > 0 || Number(ticket?.printCount) > 1;
}

function printCount(ticket) {
  const logCount = Array.isArray(ticket?.printLog) ? ticket.printLog.length : 0;
  return Math.max(1, Number(ticket?.printCount) || 0, logCount);
}

function directionOf(ticket) {
  const raw = String(ticket.direction || ticket.weightType || '').toUpperCase();
  return raw.includes('OUT') ? 'OUT' : 'IN';
}

function businessTimestamp(ticket) {
  const ms = getTicketTimestamp(ticket);
  return ms ? formatFullDateTime(new Date(ms)) : '—';
}

/** First/second weigh values, timestamps and operators for either ticket shape. */
function weightParts(ticket) {
  const direction = directionOf(ticket);
  const firstType = ticket.firstWeightType || (direction === 'IN' ? 'Gross' : 'Tare');
  const firstOp = operatorFor(ticket, 'first');
  const secondOp = operatorFor(ticket, 'second');

  let gross = ticket.grossWeight ?? null;
  let tare = ticket.tareWeight ?? null;

  if (gross === null && firstType === 'Gross') gross = ticket.firstWeight;
  if (tare === null && firstType === 'Tare') tare = ticket.firstWeight;

  const first = ticket.firstWeight ?? (firstType === 'Gross' ? gross : tare);
  const second = ticket.secondWeight ?? (firstType === 'Gross' ? tare : gross);
  const firstMeta = { time: ticket.firstWeightTime, op: firstOp };
  const secondMeta = { time: ticket.secondWeightTime, op: secondOp };

  return { first, second, firstMeta, secondMeta, gross, tare };
}

function statusLabel(ticket) {
  switch (getTicketStatus(ticket)) {
    case 'completed':
      return 'Completed';
    case 'voided':
      return 'Voided';
    case 'deleted':
      return 'Deleted';
    default:
      return 'Pending';
  }
}

function statusIcon(ticket) {
  switch (getTicketStatus(ticket)) {
    case 'completed':
      return '✓';
    case 'voided':
      return '⊘';
    case 'deleted':
      return '✕';
    default:
      return '◌';
  }
}

function statusRank(ticket) {
  return { pending: 0, completed: 1, voided: 2, deleted: 3 }[getTicketStatus(ticket)] ?? 4;
}

// ─── Filtering ──────────────────────────────────────────────────────────────

function withinDateRange(ticket) {
  const ts = getTicketTimestamp(ticket);
  if (!ts) return false;

  const history = state.history;
  const today = startOfDay();
  const todayTs = today.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  switch (history.dateFilter) {
    case 'today':
      return ts >= todayTs;
    case 'yesterday':
      return ts >= todayTs - dayMs && ts < todayTs;
    case '7days':
      return ts >= todayTs - 6 * dayMs;
    case '30days':
      return ts >= todayTs - 29 * dayMs;
    case 'custom': {
      if (history.customDateFrom) {
        const from = startOfDay(new Date(`${history.customDateFrom}T00:00:00`)).getTime();
        if (ts < from) return false;
      }
      if (history.customDateTo) {
        const to = startOfDay(new Date(`${history.customDateTo}T00:00:00`)).getTime() + dayMs;
        if (ts >= to) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

function matchesSearch(ticket, query) {
  if (!query) return true;
  const haystack = [
    ticket.id,
    ticket.truckNo,
    ticket.driver,
    ticket.material,
    ticket.client,
    ticket.firstOperator,
    ticket.secondOperator,
    ticket.challan,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function matchesFlags(ticket, flags) {
  if (flags.length === 0) return true;
  return flags.every((flag) => {
    if (flag === 'overridden') return hasOverride(ticket);
    if (flag === 'reprinted') return isReprinted(ticket);
    return true;
  });
}

function getFilteredTickets() {
  const history = state.history;
  const query = history.searchQuery.trim().toLowerCase();
  const selected = history.filters;

  return getAllTickets()
    .filter((ticket) => {
      if (!withinDateRange(ticket)) return false;
      if (!matchesSearch(ticket, query)) return false;

      const status = getTicketStatus(ticket);
      if (selected.statuses.length > 0 && !selected.statuses.includes(status)) return false;
      if (selected.drivers.length > 0 && !selected.drivers.includes(ticket.driver || '')) {
        return false;
      }
      if (selected.operators.length > 0) {
        const names = [ticket.firstOperator, ticket.secondOperator];
        if (!names.some((name) => selected.operators.includes(name))) return false;
      }
      if (selected.materials.length > 0 && !selected.materials.includes(ticket.material)) {
        return false;
      }
      if (selected.clients.length > 0 && !selected.clients.includes(ticket.client)) return false;
      if (
        selected.directions.length > 0 &&
        !selected.directions.includes(directionOf(ticket))
      ) {
        return false;
      }
      return matchesFlags(ticket, selected.flags);
    })
    .sort(compareTickets);
}

// ─── Sorting ────────────────────────────────────────────────────────────────

function sortValue(ticket, key) {
  switch (key) {
    case 'id':
      return ticket.id;
    case 'when':
      return getTicketTimestamp(ticket);
    case 'truck':
      return `${ticket.truckNo || ''} ${ticket.driver || ''}`.toLowerCase();
    case 'first':
      return weightParts(ticket).first;
    case 'second':
      return weightParts(ticket).second;
    case 'net':
      return ticket.netWeight;
    case 'status':
      return statusRank(ticket);
    case 'prints':
      return printCount(ticket);
    default:
      return getTicketTimestamp(ticket);
  }
}

function compareTickets(a, b) {
  const key = SORT_KEYS.has(state.history.sortKey) ? state.history.sortKey : 'when';
  const direction = state.history.sortDir === 'asc' ? 1 : -1;
  const av = sortValue(a, key);
  const bv = sortValue(b, key);

  const aMissing = av === null || av === undefined || av === '';
  const bMissing = bv === null || bv === undefined || bv === '';
  if (aMissing && bMissing) return (b.id || 0) - (a.id || 0);
  if (aMissing) return 1;
  if (bMissing) return -1;

  let result;
  if (typeof av === 'string' && typeof bv === 'string') {
    result = av.localeCompare(bv);
  } else {
    result = Number(av) - Number(bv);
  }
  if (result === 0) return (b.id || 0) - (a.id || 0);
  return result * direction;
}

function setSort(key) {
  if (!SORT_KEYS.has(key)) return;
  if (state.history.sortKey === key) {
    state.history.sortDir = state.history.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.history.sortKey = key;
    state.history.sortDir = key === 'when' || key === 'id' ? 'desc' : 'asc';
  }
  state.history.currentPage = 0;
  focusedIndex = 0;
}

function updateSortHeaders() {
  document.querySelectorAll('.hist-sort-btn[data-sort-key]').forEach((button) => {
    const th = button.closest('th');
    const active = button.dataset.sortKey === state.history.sortKey;
    const dir = active ? state.history.sortDir : 'none';
    if (th) th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    button.classList.toggle('is-active', active);
    button.dataset.sortDir = active ? dir : '';
    let indicator = button.querySelector('.hist-sort-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'hist-sort-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      button.appendChild(indicator);
    }
    indicator.textContent = active ? (dir === 'asc' ? '↑' : '↓') : '';
  });

  updateDateSortButton();
}

function updateDateSortButton() {
  const button = document.getElementById('hist-date-sort');
  const label = document.getElementById('hist-date-sort-label');
  const indicator = document.getElementById('hist-date-sort-indicator');
  if (!button) return;

  const active = state.history.sortKey === 'when';
  const newestFirst = state.history.sortDir === 'desc';
  button.classList.toggle('is-active', active);
  button.dataset.sortDir = active ? state.history.sortDir : '';
  button.setAttribute(
    'aria-label',
    active
      ? `Sort by date, ${newestFirst ? 'newest' : 'oldest'} first. Activate to reverse.`
      : 'Sort by date, newest first'
  );
  button.title = active
    ? `Date sort: ${newestFirst ? 'newest first' : 'oldest first'}`
    : 'Sort by date, newest first';
  if (label) label.textContent = active ? (newestFirst ? 'Newest first' : 'Oldest first') : 'Sort by date';
  if (indicator) indicator.textContent = active ? (newestFirst ? '↓' : '↑') : '';
}

// ─── Page sizing ────────────────────────────────────────────────────────────

function calculatePageSize() {
  const container = document.getElementById('history-table-container');
  if (!container) return pageSize;

  const thead = container.querySelector('thead');
  const row = container.querySelector('tbody tr');
  const rowHeight = row?.getBoundingClientRect().height || FALLBACK_ROW_HEIGHT;
  const headHeight = thead?.getBoundingClientRect().height || 38;
  const usable = container.clientHeight - headHeight;

  if (usable <= 0 || rowHeight <= 0) return pageSize;
  return Math.max(MIN_PAGE_SIZE, Math.floor(usable / rowHeight));
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function weightCellHtml(value, meta, emptyLabel = 'Pending 2nd') {
  if (value === null || value === undefined) {
    return `
      <td class="hist-weight-cell hist-weight-cell--empty">
        <span class="hist-weight-val">—</span>
        <span class="hist-weight-op">${escapeHtml(emptyLabel)}</span>
      </td>
    `;
  }
  return `
    <td class="hist-weight-cell">
      <span class="hist-weight-val">${formatKg(value)}</span>
      <span class="hist-weight-op">${escapeHtml(meta.op.name || '—')}</span>
      <span class="hist-weight-time">${escapeHtml(formatFullDateTime(meta.time))}</span>
    </td>
  `;
}

function overrideChipHtml(ticket) {
  if (!hasOverride(ticket)) return '';
  const override = ticket.override || {};
  const tooltip = [
    override.reason || 'Override recorded',
    override.operator ? `by ${override.operator}` : '',
    override.timestamp ? formatFullDateTime(override.timestamp) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<span class="hist-override-chip" title="${escapeHtml(tooltip)}">Overridden</span>`;
}

function rowHtml(ticket) {
  const status = getTicketStatus(ticket);
  const direction = directionOf(ticket);
  const { first, second, firstMeta, secondMeta } = weightParts(ticket);
  const net = ticket.netWeight;
  const hasNet = net !== null && net !== undefined;
  const netAnomaly = hasNet && Number(net) <= 0;
  const rowClass = [
    'hist-row',
    `hist-row--${status}`,
    ticket.id === state.history.selectedTicketId ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const count = printCount(ticket);

  return `
    <tr class="${rowClass}" data-ticket-id="${ticket.id}" tabindex="-1">
      <td class="hist-col-id">
        <span class="hist-id">#${ticket.id}</span>
        <span class="hist-dir hist-dir--${direction.toLowerCase()}">${direction}</span>
      </td>
      <td class="hist-col-truck">
        <span class="truck-plate-tag">${escapeHtml(ticket.truckNo)}</span>
        <span class="hist-driver" title="${escapeHtml(ticket.driver || '')}">${escapeHtml(ticket.driver || '—')}</span>
      </td>
      ${weightCellHtml(first, firstMeta, 'Not recorded')}
      ${weightCellHtml(second, secondMeta)}
      <td class="hist-col-net${netAnomaly ? ' hist-col-net--anomaly' : ''}"${netAnomaly ? ' title="Anomaly: net weight is zero or negative"' : ''}>
        <strong>${hasNet ? formatKg(net) : '—'}</strong>
        <span class="hist-net-unit">kg</span>
      </td>
      <td class="hist-col-status">
        <span class="hist-status-cell">
          <span class="hist-status hist-status--${status}">${statusIcon(ticket)} ${statusLabel(ticket)}</span>
          ${overrideChipHtml(ticket)}
        </span>
      </td>
      <td class="hist-col-prints">
        <span class="hist-print-badge ${count > 1 ? 'is-high' : ''}">🖨 ${count}</span>
      </td>
    </tr>
  `;
}

function renderDetail() {
  const panel = document.getElementById('history-detail');
  if (!panel) return;

  const id = state.history.selectedTicketId;
  const ticket = id === null ? null : getAllTickets().find((t) => t.id === id);
  if (!ticket) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const status = getTicketStatus(ticket);
  const direction = directionOf(ticket);
  const { gross, tare } = weightParts(ticket);
  const firstOp = operatorFor(ticket, 'first');
  const secondOp = operatorFor(ticket, 'second');
  const printLog = Array.isArray(ticket.printLog) ? ticket.printLog : [];
  const when = businessTimestamp(ticket);

  const overrideHtml = hasOverride(ticket)
    ? `
      <section class="hist-detail-section hist-detail-section--warn">
        <h4>Override</h4>
        <p>${escapeHtml(ticket.override?.reason || 'Override recorded')}</p>
        <p class="hist-detail-muted">Authorised by ${escapeHtml(ticket.override?.operator || '—')} · ${escapeHtml(formatFullDateTime(ticket.override?.timestamp))}</p>
        ${ticket.override?.anomalyDetails ? `<p class="hist-detail-muted">${escapeHtml(ticket.override.anomalyDetails)}</p>` : ''}
      </section>
    `
    : '';

  const voidHtml =
    status === 'voided'
      ? `
        <section class="hist-detail-section hist-detail-section--danger">
          <h4>Voided</h4>
          <p>${escapeHtml(ticket.voidedReason || 'No reason recorded')}</p>
          <p class="hist-detail-muted">By ${escapeHtml(ticket.voidedBy || '—')} · ${escapeHtml(formatFullDateTime(ticket.voidedAt))}</p>
        </section>
      `
      : '';

  const deleteHtml =
    status === 'deleted'
      ? `
        <section class="hist-detail-section hist-detail-section--danger">
          <h4>Deleted while pending</h4>
          <p>${escapeHtml(ticket.deletedReason || 'No reason recorded')}</p>
          <p class="hist-detail-muted">By ${escapeHtml(ticket.deletedBy || '—')} · ${escapeHtml(formatFullDateTime(ticket.deletedAt))}</p>
        </section>
      `
      : '';

  const printRows =
    printLog.length > 0
      ? printLog
          .map(
            (entry) => `
              <tr>
                <td>#${entry.copyNumber || 1}</td>
                <td>${escapeHtml(entry.type === 'reprint' ? 'Reprint' : entry.type === 'first_weigh_slip' ? 'First slip' : 'Certificate')}</td>
                <td>${escapeHtml(entry.by || '—')}</td>
                <td>${escapeHtml(formatFullDateTime(entry.at))}</td>
                <td>${escapeHtml(entry.reason || '—')}</td>
              </tr>
            `
          )
          .join('')
      : '<tr><td colspan="5">No prints recorded</td></tr>';

  panel.hidden = false;
  panel.innerHTML = `
    <div class="hist-detail-header">
      <div>
        <span class="hist-detail-id">#${ticket.id}</span>
        <span class="hist-status hist-status--${status}">${statusIcon(ticket)} ${statusLabel(ticket)}</span>
      </div>
      <button type="button" class="hist-detail-close" id="hist-detail-close" aria-label="Close details">✕</button>
    </div>

    <div class="hist-detail-sub">
      <span class="truck-plate-tag">${escapeHtml(ticket.truckNo)}</span>
      <span>${escapeHtml(ticket.material || '—')}</span>
      <span>${escapeHtml(ticket.client || '—')}</span>
    </div>

    <div class="hist-detail-actions">
      <button type="button" class="hist-detail-btn" data-detail-action="reprint" ${status === 'deleted' ? 'disabled' : ''}>
        Reprint <kbd>Alt+R</kbd>
      </button>
      ${
        status === 'completed'
          ? `<button type="button" class="hist-detail-btn hist-detail-btn--danger" data-detail-action="void">Void <kbd>Alt+V</kbd></button>`
          : ''
      }
    </div>

    <section class="hist-detail-section">
      <h4>Weigh details</h4>
      <div class="hist-detail-ops">
        <div class="hist-detail-op">
          <img src="${escapeHtml(firstOp.avatar)}" alt="" />
          <div>
            <strong>${escapeHtml(firstOp.name || '—')}</strong>
            <span>1st weigh · ${escapeHtml(formatFullDateTime(ticket.firstWeightTime))}</span>
            <span>${escapeHtml(ticket.firstWeightType || '')} ${formatKg(ticket.firstWeight)} kg</span>
          </div>
        </div>
        <div class="hist-detail-op">
          ${
            secondOp.name
              ? `<img src="${escapeHtml(secondOp.avatar)}" alt="" />`
              : '<span class="hist-detail-op-placeholder" aria-hidden="true">—</span>'
          }
          <div>
            <strong>${escapeHtml(secondOp.name || 'Awaiting second weigh')}</strong>
            <span>2nd weigh · ${ticket.secondWeightTime ? escapeHtml(formatFullDateTime(ticket.secondWeightTime)) : 'Pending'}</span>
            <span>${ticket.secondWeight ? `${formatKg(ticket.secondWeight)} kg` : '—'}</span>
          </div>
        </div>
      </div>
      <div class="hist-detail-weights">
        <div><span>Business time</span><strong>${escapeHtml(when || '—')}</strong></div>
        <div><span>Direction</span><strong>${direction}</strong></div>
        <div><span>Gross</span><strong>${formatKg(gross)} kg</strong></div>
        <div><span>Tare</span><strong>${formatKg(tare)} kg</strong></div>
        <div><span>Net</span><strong>${formatKg(ticket.netWeight)} kg</strong></div>
        <div><span>Prints</span><strong>${printCount(ticket)}</strong></div>
      </div>
    </section>

    <section class="hist-detail-section">
      <h4>Ticket</h4>
      <div class="hist-detail-facts">
        <div><span>Driver</span><strong>${escapeHtml(ticket.driver || '—')}</strong></div>
        <div><span>Mobile</span><strong>${escapeHtml(ticket.phone || '—')}</strong></div>
        <div><span>Challan</span><strong>${escapeHtml(ticket.challan || '—')}</strong></div>
        <div><span>Remarks</span><strong>${escapeHtml(ticket.remarks || '—')}</strong></div>
      </div>
    </section>

    ${overrideHtml}
    ${voidHtml}
    ${deleteHtml}

    <section class="hist-detail-section">
      <h4>Print history</h4>
      <div class="hist-print-table-wrap">
        <table class="hist-print-table">
          <thead>
            <tr><th>Copy</th><th>Type</th><th>By</th><th>When</th><th>Reason</th></tr>
          </thead>
          <tbody>${printRows}</tbody>
        </table>
      </div>
    </section>

    <section class="hist-detail-section hist-detail-sync">
      <span class="hist-sync-dot"></span>
      <span>${state.sync.isHealthy ? 'Synced to cloud' : 'Queued for sync'}</span>
    </section>
  `;
}

function render() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  filtered = getFilteredTickets();

  const measured = calculatePageSize();
  if (measured !== pageSize) {
    pageSize = measured;
    state.history.pageSize = measured;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (state.history.currentPage > pageCount - 1) state.history.currentPage = pageCount - 1;
  if (state.history.currentPage < 0) state.history.currentPage = 0;
  if (focusedIndex > filtered.length - 1) focusedIndex = Math.max(0, filtered.length - 1);

  const start = state.history.currentPage * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  updateSortHeaders();
  renderActiveFilters();

  if (pageRows.length === 0) {
    tbody.innerHTML = `
      <tr class="hist-empty-row">
        <td colspan="7">No tickets match these filters</td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageRows.map(rowHtml).join('');
  }

  tbody.querySelectorAll('tr[data-ticket-id]').forEach((row, index) => {
    row.classList.toggle('is-focused', start + index === focusedIndex);
  });

  const range = document.getElementById('hist-range');
  if (range) {
    range.textContent =
      filtered.length === 0
        ? '0 of 0'
        : `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`;
  }

  const summary = document.getElementById('hist-summary');
  if (summary) {
    const netKg = filtered.reduce(
      (sum, ticket) =>
        getTicketStatus(ticket) === 'completed' ? sum + (ticket.netWeight || 0) : sum,
      0
    );
    summary.textContent = `${filtered.length} ticket${filtered.length === 1 ? '' : 's'} · ${(netKg / 1000).toFixed(1)} MT net`;
  }

  const prev = document.getElementById('hist-prev');
  const next = document.getElementById('hist-next');
  if (prev) prev.disabled = state.history.currentPage <= 0;
  if (next) next.disabled = state.history.currentPage >= pageCount - 1;

  renderDetail();
}

// ─── Advanced filters ───────────────────────────────────────────────────────

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function selectedValues(key) {
  return Array.isArray(state.history.filters[key]) ? state.history.filters[key] : [];
}

function normalizeOption(option) {
  return Array.isArray(option) ? { value: option[0], label: option[1] } : {
    value: option,
    label: option,
  };
}

function filterSection(title, key, options) {
  const selected = selectedValues(key);
  const normalized = options.map(normalizeOption);
  const values = uniqueValues([...normalized.map((item) => item.value), ...selected]);
  const labels = new Map(normalized.map((item) => [item.value, item.label]));

  return `
    <section class="hist-more-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="hist-more-options">
        ${values
          .map(
            (value) => `
              <label class="hist-more-option">
                <input type="checkbox" data-filter-key="${key}" value="${escapeHtml(value)}" ${selected.includes(value) ? 'checked' : ''} />
                <span>${escapeHtml(labels.get(value) || value || '—')}</span>
              </label>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function buildFilterPanel() {
  const body = document.getElementById('hist-more-body');
  if (!body) return;

  const all = getAllTickets();
  const operators = uniqueValues(all.flatMap((t) => [t.firstOperator, t.secondOperator]));
  const drivers = uniqueValues(all.map((t) => t.driver));
  const materials = uniqueValues(all.map((t) => t.material));
  const clients = uniqueValues(all.map((t) => t.client));

  body.innerHTML = `
    <p class="hist-filter-note">Leave a section empty to include every value. Filters combine with the search and date range.</p>
    <div class="hist-filter-grid">
      ${filterSection('Status', 'statuses', STATUS_OPTIONS)}
      ${filterSection('Direction', 'directions', ['IN', 'OUT'])}
      ${filterSection('Flags', 'flags', FLAG_OPTIONS)}
      ${filterSection('Drivers', 'drivers', drivers)}
      ${filterSection('Operators', 'operators', operators)}
      ${filterSection('Materials', 'materials', materials)}
      ${filterSection('Clients', 'clients', clients)}
    </div>
  `;

  updateFilterCount();
}

function updateFilterCount() {
  const count = document.getElementById('hist-more-count');
  if (!count) return;
  const total = FILTER_KEYS.reduce((sum, key) => sum + selectedValues(key).length, 0);
  count.textContent = String(total);
  count.hidden = total === 0;
}

function positionFilterPopover() {
  const wrap = document.querySelector('.hist-more-wrap');
  const popover = document.getElementById('hist-more-popover');
  if (!wrap || !popover || popover.hidden) return;

  const wrapRect = wrap.getBoundingClientRect();
  const width = popover.offsetWidth || 460;
  const viewportWidth = document.documentElement.clientWidth;
  const maxLeft = viewportWidth - width - POPOVER_MARGIN;
  const left = Math.max(POPOVER_MARGIN, Math.min(wrapRect.right - width, maxLeft));

  popover.style.left = `${left - wrapRect.left}px`;
  popover.style.right = 'auto';

  const spaceBelow = window.innerHeight - wrapRect.bottom - 6 - POPOVER_MARGIN;
  popover.style.maxHeight = `${Math.min(480, Math.max(0, spaceBelow))}px`;
}

function setFiltersOpen(open) {
  const popover = document.getElementById('hist-more-popover');
  const button = document.getElementById('hist-filters-btn');
  if (!popover || !button) return;
  popover.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) requestAnimationFrame(positionFilterPopover);
}

function applyFilters() {
  const body = document.getElementById('hist-more-body');
  if (!body) return;

  const next = Object.fromEntries(FILTER_KEYS.map((key) => [key, []]));
  body.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    const key = input.dataset.filterKey;
    if (next[key]) next[key].push(input.value);
  });

  state.history.filters = next;
  state.history.currentPage = 0;
  focusedIndex = 0;
  updateFilterCount();
  setFiltersOpen(false);
  render();
}

function clearFilters() {
  state.history.filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, []]));
  state.history.currentPage = 0;
  focusedIndex = 0;
  buildFilterPanel();
  render();
}

function filterLabel(key, value) {
  if (key === 'statuses') {
    return STATUS_OPTIONS.find(([option]) => option === value)?.[1] || value;
  }
  if (key === 'flags') {
    return FLAG_OPTIONS.find(([option]) => option === value)?.[1] || value;
  }
  return value;
}

function renderActiveFilters() {
  const container = document.getElementById('hist-active-filters');
  if (!container) return;

  const chips = [];
  for (const key of FILTER_KEYS) {
    for (const value of selectedValues(key)) {
      chips.push(`
        <button type="button" class="hist-active-chip" data-filter-key="${key}" data-filter-value="${escapeHtml(value)}" aria-label="Remove ${escapeHtml(FILTER_GROUPS[key])} filter ${escapeHtml(filterLabel(key, value))}">
          <span class="hist-active-chip-label">${escapeHtml(FILTER_GROUPS[key])}:</span>
          ${escapeHtml(filterLabel(key, value))}
          <span aria-hidden="true">×</span>
        </button>
      `);
    }
  }

  container.hidden = chips.length === 0;
  container.innerHTML =
    chips.length === 0
      ? ''
      : `${chips.join('')}<button type="button" class="hist-active-clear" id="hist-active-clear">Clear all</button>`;
}

function removeFilter(key, value) {
  if (!FILTER_KEYS.includes(key)) return;
  state.history.filters[key] = selectedValues(key).filter((item) => item !== value);
  state.history.currentPage = 0;
  focusedIndex = 0;
  if (document.getElementById('hist-more-popover')?.hidden === false) buildFilterPanel();
  render();
}

// ─── Actions ────────────────────────────────────────────────────────────────

function ticketById(id) {
  return getAllTickets().find((ticket) => ticket.id === id) || null;
}

function openReport() {
  openHistoryReportModal();
}

function reprintTicket(ticket) {
  if (!ticket) return;
  if (getTicketStatus(ticket) === 'deleted') {
    showToast('Deleted tickets cannot be reprinted', 'warning');
    return;
  }
  openReprintModal(ticket);
}

function voidTicketWithReason(ticket) {
  if (!ticket || getTicketStatus(ticket) !== 'completed') return;

  openReasonDialog({
    id: 'void-ticket-modal',
    title: `Void ticket #${ticket.id}?`,
    metaHtml: `${escapeHtml(ticket.truckNo)} — Net ${formatKg(ticket.netWeight)} kg<br>The record stays in History, struck through.`,
    prompt: 'Why is this ticket being voided?',
    reasons: [
      'Incorrect weight recorded',
      'Wrong vehicle identified',
      'Scale malfunction',
      'Operator error',
      'Other',
    ],
    confirmLabel: 'Void ticket',
    confirmTone: 'danger',
    stateFlag: '_voidDialogOpen',
    onConfirm: async (reason) => {
      const operator = state.activeOperator?.name || 'Unknown';
      try {
        const voided = await voidTicket(ticket.id, reason, operator);
        if (!voided) {
          showToast('Ticket could not be voided', 'error');
          return;
        }
      } catch (err) {
        showToast(err?.message || 'Ticket could not be voided', 'error');
        return;
      }
      showToast(`Ticket #${ticket.id} voided`, 'info');
      render();
    },
  });
}

function focusRow(index) {
  if (filtered.length === 0) return;
  focusedIndex = Math.max(0, Math.min(index, filtered.length - 1));
  state.history.focusedRowIndex = focusedIndex;

  const page = Math.floor(focusedIndex / pageSize);
  if (page !== state.history.currentPage) {
    state.history.currentPage = page;
  }
  render();
  document.querySelector('.hist-row.is-focused')?.scrollIntoView({ block: 'nearest' });
}

function currentFocusedTicket() {
  return filtered[focusedIndex] || null;
}

function toggleDetail(ticket) {
  if (!ticket) return;
  state.history.selectedTicketId = state.history.selectedTicketId === ticket.id ? null : ticket.id;
  render();
}

// ─── Event wiring ───────────────────────────────────────────────────────────

export function initHistoryScreen() {
  const searchInput = document.getElementById('hist-search-input');
  const tbody = document.getElementById('history-tbody');
  const detail = document.getElementById('history-detail');
  const dateSelect = document.getElementById('hist-date-filter');
  const dateFrom = document.getElementById('hist-date-from');
  const dateTo = document.getElementById('hist-date-to');
  const filtersButton = document.getElementById('hist-filters-btn');
  const moreBody = document.getElementById('hist-more-body');
  const activeFilters = document.getElementById('hist-active-filters');
  const tableHead = document.querySelector('.hist-table thead');

  if (!tbody) return;

  buildFilterPanel();

  searchInput?.addEventListener('input', (event) => {
    state.history.searchQuery = event.target.value;
    state.history.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  dateSelect?.addEventListener('change', (event) => {
    state.history.dateFilter = event.target.value;
    const custom = event.target.value === 'custom';
    if (dateFrom) dateFrom.hidden = !custom;
    if (dateTo) dateTo.hidden = !custom;

    if (custom) {
      const today = new Date();
      const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
      if (dateFrom && !dateFrom.value) {
        dateFrom.value = toDateInputValue(monthAgo);
        state.history.customDateFrom = dateFrom.value;
      }
      if (dateTo && !dateTo.value) {
        dateTo.value = toDateInputValue(today);
        state.history.customDateTo = dateTo.value;
      }
    }

    state.history.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  dateFrom?.addEventListener('change', (event) => {
    state.history.customDateFrom = event.target.value || null;
    state.history.currentPage = 0;
    focusedIndex = 0;
    render();
  });
  dateTo?.addEventListener('change', (event) => {
    state.history.customDateTo = event.target.value || null;
    state.history.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  document.getElementById('hist-date-sort')?.addEventListener('click', () => {
    setSort('when');
    render();
  });

  filtersButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const popover = document.getElementById('hist-more-popover');
    const opening = Boolean(popover?.hidden);
    if (opening) buildFilterPanel();
    setFiltersOpen(opening);
  });
  document.getElementById('hist-more-apply')?.addEventListener('click', applyFilters);
  document.getElementById('hist-more-clear')?.addEventListener('click', clearFilters);
  moreBody?.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"]')) updateFilterCount();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.hist-more-wrap')) setFiltersOpen(false);
  });

  activeFilters?.addEventListener('click', (event) => {
    if (event.target.closest('#hist-active-clear')) {
      clearFilters();
      return;
    }
    const chip = event.target.closest('[data-filter-key][data-filter-value]');
    if (!chip) return;
    removeFilter(chip.dataset.filterKey, chip.dataset.filterValue);
  });

  tableHead?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort-key]');
    if (!button) return;
    setSort(button.dataset.sortKey);
    render();
  });

  document.getElementById('hist-report-btn')?.addEventListener('click', openReport);
  document.getElementById('hist-verify-btn')?.addEventListener('click', () => openVerifyReportModal());

  document.getElementById('hist-back')?.addEventListener('click', () => {
    showScreen('dashboard-screen');
  });
  document.getElementById('hist-prev')?.addEventListener('click', () => {
    if (state.history.currentPage > 0) {
      state.history.currentPage--;
      focusedIndex = state.history.currentPage * pageSize;
      render();
    }
  });
  document.getElementById('hist-next')?.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (state.history.currentPage < pageCount - 1) {
      state.history.currentPage++;
      focusedIndex = state.history.currentPage * pageSize;
      render();
    }
  });

  tbody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-ticket-id]');
    if (!row) return;
    const ticket = ticketById(Number(row.dataset.ticketId));
    const index = filtered.findIndex((item) => item.id === Number(row.dataset.ticketId));
    if (index >= 0) focusedIndex = index;
    toggleDetail(ticket);
  });

  detail?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-detail-action]')?.dataset.detailAction;
    if (event.target.closest('#hist-detail-close')) {
      state.history.selectedTicketId = null;
      render();
      return;
    }
    if (!action) return;
    const ticket = ticketById(state.history.selectedTicketId);
    if (action === 'reprint') reprintTicket(ticket);
    if (action === 'void') voidTicketWithReason(ticket);
  });

  // Recalculate row count whenever the screen becomes visible or resizes.
  document.addEventListener('screenchange', (event) => {
    if (event.detail?.screenId !== 'history-screen') return;
    requestAnimationFrame(() => {
      pageSize = calculatePageSize();
      state.history.pageSize = pageSize;
      render();
      positionFilterPopover();
    });
  });

  document.addEventListener('history:refresh', () => {
    if (state.currentScreen === 'history-screen') render();
    buildFilterPanel();
  });

  window.addEventListener('resize', () => {
    if (state.currentScreen !== 'history-screen') return;
    pageSize = calculatePageSize();
    state.history.pageSize = pageSize;
    render();
    positionFilterPopover();
  });

  // Capture phase so History owns Escape/arrows before the global handler.
  document.addEventListener(
    'keydown',
    (event) => {
      if (state.currentScreen !== 'history-screen') return;
      if (document.querySelector('.modal-overlay.open')) return;

      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
      const popoverOpen = !document.getElementById('hist-more-popover')?.hidden;

      if (event.key === 'Escape') {
        if (popoverOpen) {
          setFiltersOpen(false);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (state.history.selectedTicketId !== null) {
          state.history.selectedTicketId = null;
          render();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (inInput && searchInput?.value) {
          searchInput.value = '';
          state.history.searchQuery = '';
          render();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (inInput) {
          event.target.blur();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        return; // global handler returns to the dashboard
      }

      if (inInput) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          searchInput?.blur();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const onControl = event.target?.closest?.('button, a');
      if (onControl && (event.key === 'Enter' || event.key === 'Backspace')) return;

      if (event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        event.stopPropagation();
        reprintTicket(currentFocusedTicket() || ticketById(state.history.selectedTicketId));
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        event.stopPropagation();
        voidTicketWithReason(currentFocusedTicket() || ticketById(state.history.selectedTicketId));
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
        openReport();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        focusRow(focusedIndex + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        focusRow(focusedIndex - 1);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        event.stopPropagation();
        focusRow(Math.min(focusedIndex + pageSize, filtered.length - 1));
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        event.stopPropagation();
        focusRow(Math.max(focusedIndex - pageSize, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        toggleDetail(currentFocusedTicket());
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        event.stopPropagation();
        searchInput?.focus();
        searchInput?.select();
        return;
      }
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key !== ' '
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (searchInput) {
          searchInput.focus();
          searchInput.value = event.key;
          state.history.searchQuery = event.key;
          state.history.currentPage = 0;
          focusedIndex = 0;
          render();
        }
      }
    },
    true
  );

  state.history.pageSize = pageSize;
  render();
}
