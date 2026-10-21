/**
 * Screen 2: Dashboard
 * Central operation hub, active pending tickets table, search, keyboard table navigation,
 * ticket deletion with audit metadata and reason confirmation.
 */
import { state, pendingTickets, deleteTicket } from '../state.js';
import { showScreen } from '../router.js';
import { showToast } from '../toast.js';
import { escapeHtml } from '../utils.js';
import { openFirstWeigh } from './first-weigh.js';
import { openSecondWeighWithTicket } from './second-weigh.js';
import { mountHud } from '../hud.js';
import { openReasonDialog } from '../reason-dialog.js';

export function initDashboard() {
  const hudSlot = document.getElementById('dashboard-hud-slot');
  if (hudSlot) mountHud(hudSlot);

  const cardFirst = document.getElementById('card-action-first-weigh');
  const btnIn = document.getElementById('dashboard-btn-in');
  const btnOut = document.getElementById('dashboard-btn-out');

  // Direct Inbound First Weigh button (Key I)
  if (btnIn) {
    btnIn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFirstWeigh('IN');
    });
  }

  // Direct Outbound First Weigh button (Key O)
  if (btnOut) {
    btnOut.addEventListener('click', (e) => {
      e.stopPropagation();
      openFirstWeigh('OUT');
    });
  }

  // Clicking anywhere else on First Weigh card opens with direction unselected for operator safety
  if (cardFirst) {
    cardFirst.addEventListener('click', (e) => {
      if (e.target.closest('#dashboard-btn-out') || e.target.closest('#dashboard-btn-in')) return;
      openFirstWeigh(null);
    });
  }

  // Search input for active tickets table
  const searchInput = document.getElementById('tickets-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderPendingTicketsTable(e.target.value.trim());
    });
  }

  // Delegated click on tickets table: Complete Weigh button, Row click, or Delete [X]
  const pendingTbody = document.getElementById('pending-tickets-tbody');
  if (pendingTbody) {
    pendingTbody.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.table-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const ticketId = Number(deleteBtn.dataset.ticketId);
        const ticket = pendingTickets.find((t) => t.id === ticketId);
        if (ticket) openDeleteDialog(ticket);
        return;
      }

      const tr = e.target.closest('tr[data-ticket-id]');
      if (!tr) return;
      const ticket = pendingTickets.find((t) => t.id === Number(tr.dataset.ticketId));
      if (ticket) openSecondWeighWithTicket(ticket);
    });
  }

  // Unified 3-Layer Keyboard Navigation for dashboard screen
  document.addEventListener('keydown', (e) => {
    if (state.currentScreen !== 'dashboard-screen') return;

    // Layer 1: Dialog/modal open -> abort (modal traps keys)
    if (
      state._deleteDialogOpen ||
      document.getElementById('delete-ticket-modal') ||
      document.querySelector('.modal-overlay.open')
    ) {
      return;
    }

    const activeEl = document.activeElement;
    const isSearchFocused = activeEl === searchInput;
    const inOtherInput =
      activeEl &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
      !isSearchFocused;

    if (inOtherInput) {
      if (e.key === 'Escape') {
        activeEl.blur();
        updateTableRowFocus();
      }
      return;
    }

    const tickets = state.currentFilteredTickets || [];

    // Layer 2: Search field has focus
    if (isSearchFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        searchInput.value = '';
        renderPendingTicketsTable('');
        searchInput.blur();
        updateTableRowFocus();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (tickets.length > 0) {
          state.focusedTicketIndex =
            typeof state.focusedTicketIndex === 'number'
              ? Math.min(state.focusedTicketIndex + 1, tickets.length - 1)
              : 0;
          updateTableRowFocus();
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (tickets.length > 0) {
          state.focusedTicketIndex =
            typeof state.focusedTicketIndex === 'number'
              ? Math.max(state.focusedTicketIndex - 1, 0)
              : 0;
          updateTableRowFocus();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (
          tickets.length > 0 &&
          typeof state.focusedTicketIndex === 'number' &&
          state.focusedTicketIndex >= 0 &&
          state.focusedTicketIndex < tickets.length
        ) {
          const ticket = tickets[state.focusedTicketIndex];
          if (ticket) openSecondWeighWithTicket(ticket);
        }
        return;
      }

      // Any other character typed in search input passes through to native input event
      return;
    }

    // Layer 3: Dashboard general (no input focused)

    // Number keys (0-9) immediately start search
    if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.value = e.key;
        renderPendingTicketsTable(e.key);
      }
      return;
    }

    // 'F' or 'f' focuses search input and selects text
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // 'I' or 'i' opens Inbound First Weigh
    if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openFirstWeigh('IN');
      return;
    }

    // 'O' or 'o' opens Outbound First Weigh
    if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openFirstWeigh('OUT');
      return;
    }

    // Escape outside inputs clears any active search query
    if (e.key === 'Escape') {
      if (searchInput && searchInput.value) {
        e.preventDefault();
        searchInput.value = '';
        renderPendingTicketsTable('');
        updateTableRowFocus();
        return;
      }
    }

    // Backspace on selected row opens delete dialog
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (
        tickets.length > 0 &&
        typeof state.focusedTicketIndex === 'number' &&
        state.focusedTicketIndex >= 0 &&
        state.focusedTicketIndex < tickets.length
      ) {
        const ticket = tickets[state.focusedTicketIndex];
        if (ticket) openDeleteDialog(ticket);
      }
      return;
    }

    if (tickets.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.focusedTicketIndex =
        typeof state.focusedTicketIndex === 'number'
          ? Math.min(state.focusedTicketIndex + 1, tickets.length - 1)
          : 0;
      updateTableRowFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.focusedTicketIndex =
        typeof state.focusedTicketIndex === 'number'
          ? Math.max(state.focusedTicketIndex - 1, 0)
          : 0;
      updateTableRowFocus();
    } else if (
      e.key === 'Enter' &&
      typeof state.focusedTicketIndex === 'number' &&
      state.focusedTicketIndex >= 0 &&
      state.focusedTicketIndex < tickets.length
    ) {
      e.preventDefault();
      const ticket = tickets[state.focusedTicketIndex];
      if (ticket) openSecondWeighWithTicket(ticket);
    }
  });

  // Lock workstation button
  const lockBtn = document.getElementById('btn-lock-workstation');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      state.activeOperator = null;
      showToast('Workstation locked', 'info');
      showScreen('login-screen');
    });
  }
}

export function updateTableRowFocus() {
  const tbody = document.getElementById('pending-tickets-tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  rows.forEach((r, idx) => {
    if (idx === state.focusedTicketIndex) {
      r.classList.add('keyboard-focused');
      r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      r.classList.remove('keyboard-focused');
    }
  });
}

function directionOf(ticket) {
  const raw = String(ticket.direction || ticket.weightType || '').toUpperCase();
  return raw.includes('OUT') ? 'OUT' : 'IN';
}

export function renderPendingTicketsTable(query = '') {
  const tbody = document.getElementById('pending-tickets-tbody');
  const countBadge = document.getElementById('tickets-count-badge');
  const searchInput = document.getElementById('tickets-search-input');
  if (!tbody) return;

  if (
    query === '' &&
    searchInput &&
    document.activeElement !== searchInput &&
    searchInput.value !== ''
  ) {
    searchInput.value = '';
  }

  const filtered = pendingTickets.filter((t) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      t.truckNo.toLowerCase().includes(q) ||
      t.id.toString().includes(q) ||
      t.material.toLowerCase().includes(q) ||
      t.driver.toLowerCase().includes(q)
    );
  });

  state.currentFilteredTickets = filtered;

  if (filtered.length === 0) {
    state.focusedTicketIndex = -1;
  } else if (
    typeof state.focusedTicketIndex !== 'number' ||
    state.focusedTicketIndex < 0 ||
    state.focusedTicketIndex >= filtered.length
  ) {
    state.focusedTicketIndex = 0;
  }

  if (countBadge) {
    countBadge.textContent = `${pendingTickets.length} Pending`;
  }

  tbody.innerHTML = '';
  if (pendingTickets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted); font-size: var(--text-sm);">No pending tickets</td></tr>`;
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted); font-size: var(--text-sm);">No match</td></tr>`;
    return;
  }

  filtered.forEach((ticket, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.ticketId = ticket.id;
    if (idx === state.focusedTicketIndex) tr.classList.add('keyboard-focused');
    const waitingStr = ticket.timeElapsed ? ticket.timeElapsed.replace(/\s*ago\b/i, '') : '';
    const direction = directionOf(ticket);
    tr.innerHTML = `
      <td class="col-ticket-id"><span class="ticket-id-tag">#${ticket.id}</span><span class="hist-dir hist-dir--${direction.toLowerCase()}">${direction}</span></td>
      <td class="col-truck-no"><span class="truck-plate-tag">${escapeHtml(ticket.truckNo)}</span></td>
      <td class="col-driver" title="${escapeHtml(ticket.driver)}">${escapeHtml(ticket.driver) || '—'}</td>
      <td class="col-operator" title="${escapeHtml(ticket.firstOperator || '')}">${escapeHtml(ticket.firstOperator) || '—'}</td>
      <td class="col-material" title="${escapeHtml(ticket.material)}">${escapeHtml(ticket.material)}</td>
      <td class="col-weight"><strong style="font-family: var(--font-mono);">${ticket.firstWeight.toLocaleString()} kg</strong></td>
      <td class="col-waiting">${waitingStr}</td>
      <td class="col-action td-actions">
        <button class="table-action-btn" data-ticket-id="${ticket.id}">
          Complete →
        </button>
      </td>
      <td class="col-delete">
        <button class="table-delete-btn" data-ticket-id="${ticket.id}" title="Delete (Backspace)" aria-label="Delete ticket #${ticket.id}">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Opens modal dialog to confirm ticket deletion with preset reasons or custom text.
 * Uses the shared openReasonDialog component.
 */
export function openDeleteDialog(ticket) {
  const currentIdx = state.focusedTicketIndex;
  openReasonDialog({
    id: 'delete-ticket-modal',
    title: `Delete ticket #${ticket.id}?`,
    metaHtml: `${[ticket.truckNo, ticket.driver, ticket.material].filter(Boolean).map(escapeHtml).join(', ')}<br>First weight: ${ticket.firstWeight.toLocaleString()} kg`,
    prompt: 'Why are you deleting it?',
    reasons: [
      'Truck left without second weigh',
      'Wrong truck number or details',
      'Duplicate ticket',
      'Created by mistake',
      'Other',
    ],
    confirmLabel: 'Delete ticket',
    confirmTone: 'danger',
    stateFlag: '_deleteDialogOpen',
    onConfirm: async (reason) => {
      const operatorName = (state.activeOperator && state.activeOperator.name) || 'MD. RAJU';
      try {
        const deleted = await deleteTicket(ticket.id, reason, operatorName);
        if (!deleted) {
          showToast('Ticket could not be deleted', 'error');
          return;
        }
      } catch (err) {
        showToast(err?.message || 'Ticket could not be deleted', 'error');
        return;
      }
      showToast(`Ticket #${ticket.id} deleted`, 'info');

      // Re-render pending list with cleared search
      const searchInput = document.getElementById('tickets-search-input');
      if (searchInput) searchInput.value = '';
      renderPendingTicketsTable('');

      // Select next row (or previous if it was the last row)
      const remaining = state.currentFilteredTickets || [];
      if (remaining.length > 0) {
        state.focusedTicketIndex = Math.min(Math.max(0, currentIdx), remaining.length - 1);
        updateTableRowFocus();
      } else {
        state.focusedTicketIndex = -1;
      }
    },
    onCancel: () => {
      updateTableRowFocus();
    },
  });
}
