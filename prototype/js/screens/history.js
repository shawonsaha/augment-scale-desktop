/**
 * Screen: History ledger
 * Paginated, no-scroll view of pending + completed + voided + deleted tickets.
 * Date/status/stage filters, optional multi-select filters, detail panel,
 * reprint and void actions. All data is read from the in-memory ledger.
 */
import {
  state,
  OPERATORS,
  getAllTickets,
  getTicketStage,
  getTicketStatus,
  getTicketTimestamp,
  voidTicket,
} from '../state.js';
import { openReprintModal } from '../print.js';
import { openReasonDialog } from '../reason-dialog.js';
import { showToast } from '../toast.js';
import { escapeHtml, formatDateTime12H } from '../utils.js';

const FALLBACK_ROW_HEIGHT = 56;
const MIN_PAGE_SIZE = 5;

let filtered = [];
let pageSize = 20;
let focusedIndex = 0;

// ─── Small formatting helpers ───────────────────────────────────────────────

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatKg(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value).toLocaleString('en-US')}`;
}

function shortTime(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const match = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)/i.exec(input);
    if (match) return `${match[1]}:${match[2]} ${match[3].toUpperCase()}`;
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) input = parsed;
  }
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return '';
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

function directionOf(ticket) {
  const raw = String(ticket.direction || ticket.weightType || '').toUpperCase();
  return raw.includes('OUT') ? 'OUT' : 'IN';
}

/** Gross/tare values, timestamps and operators for either ticket shape. */
function weightParts(ticket) {
  const direction = directionOf(ticket);
  const firstType = ticket.firstWeightType || (direction === 'IN' ? 'Gross' : 'Tare');
  const completed = getTicketStage(ticket) === 'complete';

  const firstOp = operatorFor(ticket, 'first');
  const secondOp = operatorFor(ticket, 'second');

  let gross = ticket.grossWeight ?? null;
  let tare = ticket.tareWeight ?? null;

  if (gross === null && firstType === 'Gross') gross = ticket.firstWeight;
  if (tare === null && firstType === 'Tare') tare = ticket.firstWeight;

  const grossMeta =
    direction === 'IN'
      ? { time: ticket.firstWeightTime, op: firstOp }
      : { time: ticket.secondWeightTime, op: secondOp };
  const tareMeta =
    direction === 'IN'
      ? { time: ticket.secondWeightTime, op: secondOp }
      : { time: ticket.firstWeightTime, op: firstOp };

  return {
    gross,
    tare,
    grossMeta,
    tareMeta,
    completed,
  };
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

function getFilteredTickets() {
  const history = state.history;
  const query = history.searchQuery.trim().toLowerCase();
  const selected = history.moreFilters;

  return getAllTickets().filter((ticket) => {
    if (!withinDateRange(ticket)) return false;

    if (history.statusFilter !== 'all' && getTicketStatus(ticket) !== history.statusFilter) {
      return false;
    }
    if (history.stageFilter !== 'all' && getTicketStage(ticket) !== history.stageFilter) {
      return false;
    }
    if (!matchesSearch(ticket, query)) return false;

    if (selected.operators.length > 0) {
      const names = [ticket.firstOperator, ticket.secondOperator];
      if (!names.some((name) => selected.operators.includes(name))) return false;
    }
    if (selected.materials.length > 0 && !selected.materials.includes(ticket.material)) {
      return false;
    }
    if (selected.clients.length > 0 && !selected.clients.includes(ticket.client)) {
      return false;
    }
    return true;
  });
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

function weightCellHtml(value, meta) {
  if (value === null || value === undefined) {
    return `
      <td class="hist-weight-cell hist-weight-cell--empty">
        <span class="hist-weight-val">—</span>
        <div class="hist-weight-meta"><span>Pending 2nd</span></div>
      </td>
    `;
  }
  return `
    <td class="hist-weight-cell">
      <span class="hist-weight-val">${formatKg(value)}</span>
      <div class="hist-weight-meta">
        <img class="hist-op-avatar" src="${escapeHtml(meta.op.avatar)}" alt="" title="${escapeHtml(meta.op.name)}" />
        <span>${escapeHtml(shortTime(meta.time))}</span>
      </div>
    </td>
  `;
}

function rowHtml(ticket) {
  const status = getTicketStatus(ticket);
  const direction = directionOf(ticket);
  const { gross, tare, grossMeta, tareMeta } = weightParts(ticket);
  const rowClass = [
    'hist-row',
    `hist-row--${status}`,
    ticket.id === state.history.selectedTicketId ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const printCount = ticket.printCount || 1;

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
      ${weightCellHtml(gross, grossMeta)}
      ${weightCellHtml(tare, tareMeta)}
      <td class="hist-col-net">
        <strong>${ticket.netWeight === null || ticket.netWeight === undefined ? '—' : formatKg(ticket.netWeight)}</strong>
        <span class="hist-net-unit">kg</span>
      </td>
      <td class="hist-col-status">
        <span class="hist-status hist-status--${status}">${statusIcon(ticket)} ${statusLabel(ticket)}</span>
      </td>
      <td class="hist-col-prints">
        <span class="hist-print-badge ${printCount > 1 ? 'is-high' : ''}">🖨 ${printCount}</span>
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

  const overrideHtml = ticket.override
    ? `
      <section class="hist-detail-section hist-detail-section--warn">
        <h4>Override</h4>
        <p>${escapeHtml(ticket.override.reason || '')}</p>
        <p class="hist-detail-muted">Authorised by ${escapeHtml(ticket.override.operator || '—')} · ${escapeHtml(ticket.override.timestamp || '')}</p>
        ${ticket.override.anomalyDetails ? `<p class="hist-detail-muted">${escapeHtml(ticket.override.anomalyDetails)}</p>` : ''}
      </section>
    `
    : '';

  const voidHtml =
    status === 'voided'
      ? `
        <section class="hist-detail-section hist-detail-section--danger">
          <h4>Voided</h4>
          <p>${escapeHtml(ticket.voidedReason || 'No reason recorded')}</p>
          <p class="hist-detail-muted">By ${escapeHtml(ticket.voidedBy || '—')} · ${escapeHtml(formatDateTime12H(new Date(ticket.voidedAt)))}</p>
        </section>
      `
      : '';

  const deleteHtml =
    status === 'deleted'
      ? `
        <section class="hist-detail-section hist-detail-section--danger">
          <h4>Deleted while pending</h4>
          <p>${escapeHtml(ticket.deletedReason || 'No reason recorded')}</p>
          <p class="hist-detail-muted">By ${escapeHtml(ticket.deletedBy || '—')} · ${escapeHtml(formatDateTime12H(new Date(ticket.deletedAt)))}</p>
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
                <td>${escapeHtml(formatDateTime12H(new Date(entry.at)))}</td>
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
            <span>1st weigh · ${escapeHtml(shortTime(ticket.firstWeightTime))}</span>
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
            <span>2nd weigh · ${ticket.secondWeightTime ? escapeHtml(shortTime(ticket.secondWeightTime)) : 'Pending'}</span>
            <span>${ticket.secondWeight ? `${formatKg(ticket.secondWeight)} kg` : '—'}</span>
          </div>
        </div>
      </div>
      <div class="hist-detail-weights">
        <div><span>Direction</span><strong>${direction}</strong></div>
        <div><span>Gross</span><strong>${formatKg(gross)} kg</strong></div>
        <div><span>Tare</span><strong>${formatKg(tare)} kg</strong></div>
        <div><span>Net</span><strong>${formatKg(ticket.netWeight)} kg</strong></div>
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

// ─── Multi-select filters ("More") ──────────────────────────────────────────

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildMoreFilters() {
  const body = document.getElementById('hist-more-body');
  if (!body) return;

  const all = getAllTickets();
  const operators = uniqueValues(all.flatMap((t) => [t.firstOperator, t.secondOperator]));
  const materials = uniqueValues(all.map((t) => t.material));
  const clients = uniqueValues(all.map((t) => t.client));
  const selected = state.history.moreFilters;

  const section = (title, key, values) => `
    <section class="hist-more-section">
      <h4>${title}</h4>
      <div class="hist-more-options">
        ${values
          .map(
            (value) => `
              <label class="hist-more-option">
                <input type="checkbox" data-filter-key="${key}" value="${escapeHtml(value)}" ${selected[key].includes(value) ? 'checked' : ''} />
                <span>${escapeHtml(value || '—')}</span>
              </label>
            `
          )
          .join('')}
      </div>
    </section>
  `;

  body.innerHTML = [
    section('Operators', 'operators', operators),
    section('Materials', 'materials', materials),
    section('Clients', 'clients', clients),
  ].join('');

  updateMoreCount();
}

function updateMoreCount() {
  const count = document.getElementById('hist-more-count');
  if (!count) return;
  const selected = state.history.moreFilters;
  const total = selected.operators.length + selected.materials.length + selected.clients.length;
  count.textContent = String(total);
  count.hidden = total === 0;
}

function setMoreOpen(open) {
  const popover = document.getElementById('hist-more-popover');
  const button = document.getElementById('hist-more-btn');
  if (!popover || !button) return;
  popover.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

function applyMoreFilters() {
  const body = document.getElementById('hist-more-body');
  if (!body) return;

  const next = { operators: [], materials: [], clients: [] };
  body.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    next[input.dataset.filterKey]?.push(input.value);
  });

  state.history.moreFilters = next;
  state.history.currentPage = 0;
  updateMoreCount();
  setMoreOpen(false);
  render();
}

function clearMoreFilters() {
  state.history.moreFilters = { operators: [], materials: [], clients: [] };
  state.history.currentPage = 0;
  buildMoreFilters();
  render();
}

// ─── Actions ────────────────────────────────────────────────────────────────

function ticketById(id) {
  return getAllTickets().find((ticket) => ticket.id === id) || null;
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
    onConfirm: (reason) => {
      const operator = state.activeOperator?.name || 'Unknown';
      const voided = voidTicket(ticket.id, reason, operator);
      if (!voided) {
        showToast('Ticket could not be voided', 'error');
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
  const statusSelect = document.getElementById('hist-status-filter');
  const moreBody = document.getElementById('hist-more-body');

  if (!tbody) return;

  buildMoreFilters();

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
        dateFrom.value = monthAgo.toISOString().slice(0, 10);
        state.history.customDateFrom = dateFrom.value;
      }
      if (dateTo && !dateTo.value) {
        dateTo.value = today.toISOString().slice(0, 10);
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
    render();
  });
  dateTo?.addEventListener('change', (event) => {
    state.history.customDateTo = event.target.value || null;
    state.history.currentPage = 0;
    render();
  });

  statusSelect?.addEventListener('change', (event) => {
    state.history.statusFilter = event.target.value;
    state.history.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  document.querySelectorAll('.hist-chip[data-stage]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.hist-chip[data-stage]').forEach((other) => {
        other.classList.toggle('is-active', other === chip);
      });
      state.history.stageFilter = chip.dataset.stage;
      state.history.currentPage = 0;
      focusedIndex = 0;
      render();
    });
  });

  document.getElementById('hist-more-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const popover = document.getElementById('hist-more-popover');
    const opening = Boolean(popover?.hidden);
    if (opening) buildMoreFilters();
    setMoreOpen(opening);
  });
  document.getElementById('hist-more-apply')?.addEventListener('click', applyMoreFilters);
  document.getElementById('hist-more-clear')?.addEventListener('click', clearMoreFilters);
  moreBody?.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"]')) updateMoreCount();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.hist-more-wrap')) setMoreOpen(false);
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
    });
  });

  document.addEventListener('history:refresh', () => {
    if (state.currentScreen === 'history-screen') render();
    buildMoreFilters();
  });

  window.addEventListener('resize', () => {
    if (state.currentScreen !== 'history-screen') return;
    pageSize = calculatePageSize();
    state.history.pageSize = pageSize;
    render();
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
          setMoreOpen(false);
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
