/**
 * Screen: Trucks (registered vehicles master data)
 * Search/paginate the register, add or edit a vehicle, archive/restore with
 * an audit reason. Archiving is blocked while the plate has an open ticket.
 */
import {
  state,
  REGISTERED_TRUCKS,
  registerTruck,
  archiveTruck,
  restoreTruck,
  refreshVehiclesFromDatabase,
} from '../state.js';
import { IS_PRODUCTION } from '../runtime.js';
import { showToast } from '../toast.js';
import { openReasonDialog } from '../reason-dialog.js';
import { openConfirmDialog } from '../confirm-dialog.js';
import { escapeHtml, formatShortDate } from '../utils.js';

const FALLBACK_ROW_HEIGHT = 48;
const MIN_PAGE_SIZE = 5;

let filtered = [];
let pageSize = 15;
let focusedIndex = 0;

function normalize(value) {
  return (value || '').trim().toUpperCase();
}

function activeTrucks() {
  return REGISTERED_TRUCKS.filter((truck) => truck.status !== 'archived');
}

function getFilteredTrucks() {
  const query = state.trucks.searchQuery.trim().toLowerCase();
  const showArchived = state.trucks.showArchived;

  return REGISTERED_TRUCKS.filter((truck) => {
    if (!showArchived && truck.status === 'archived') return false;
    if (!query) return true;
    return [truck.plate, truck.driver, truck.phone, truck.client, truck.material]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  }).sort((a, b) => {
    const aArchived = a.status === 'archived';
    const bArchived = b.status === 'archived';
    if (aArchived !== bArchived) return aArchived ? 1 : -1;
    const aTime = a.lastWeighed ? new Date(a.lastWeighed).getTime() : 0;
    const bTime = b.lastWeighed ? new Date(b.lastWeighed).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return normalize(a.plate).localeCompare(normalize(b.plate));
  });
}

function calculatePageSize() {
  const container = document.getElementById('trucks-table-container');
  if (!container) return pageSize;

  const thead = container.querySelector('thead');
  const row = container.querySelector('tbody tr');
  const rowHeight = row?.getBoundingClientRect().height || FALLBACK_ROW_HEIGHT;
  const headHeight = thead?.getBoundingClientRect().height || 38;
  const usable = container.clientHeight - headHeight;

  if (usable <= 0 || rowHeight <= 0) return pageSize;
  return Math.max(MIN_PAGE_SIZE, Math.floor(usable / rowHeight));
}

function rowHtml(truck) {
  const archived = truck.status === 'archived';
  const direction = archived ? 'restore' : 'archive';

  return `
    <tr class="truck-row ${archived ? 'is-archived' : ''}" data-plate="${escapeHtml(truck.plate)}" tabindex="-1">
      <td class="trucks-col-plate">
        <span class="truck-plate-tag">${escapeHtml(truck.plate)}</span>
        ${archived ? '<span class="truck-archived-chip">Archived</span>' : ''}
      </td>
      <td class="trucks-col-driver">${escapeHtml(truck.driver || '—')}</td>
      <td class="trucks-col-phone">${escapeHtml(truck.phone || '—')}</td>
      <td class="trucks-col-client">${escapeHtml(truck.client || '—')}</td>
      <td class="trucks-col-material">${escapeHtml(truck.material || '—')}</td>
      <td class="trucks-col-last">${truck.lastWeighed ? escapeHtml(formatShortDate(truck.lastWeighed)) : 'Never'}</td>
      <td class="trucks-col-trips">${truck.tripCount || 0}</td>
      <td class="trucks-col-tare">${truck.lastTare ? `${Math.round(truck.lastTare).toLocaleString('en-US')} kg` : '—'}</td>
      <td class="trucks-col-status">
        <span class="truck-status truck-status--${archived ? 'archived' : 'active'}">
          ${archived ? 'Archived' : 'Active'}
        </span>
      </td>
      <td class="trucks-col-action">
        <button type="button" class="truck-row-btn" data-action="edit">Edit</button>
        <button type="button" class="truck-row-btn truck-row-btn--${direction}" data-action="${direction}">
          ${archived ? 'Restore' : 'Archive'}
        </button>
      </td>
    </tr>
  `;
}

function render() {
  const tbody = document.getElementById('trucks-tbody');
  if (!tbody) return;

  filtered = getFilteredTrucks();

  const measured = calculatePageSize();
  if (measured !== pageSize) {
    pageSize = measured;
    state.trucks.pageSize = measured;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (state.trucks.currentPage > pageCount - 1) state.trucks.currentPage = pageCount - 1;
  if (state.trucks.currentPage < 0) state.trucks.currentPage = 0;
  if (focusedIndex > filtered.length - 1) focusedIndex = Math.max(0, filtered.length - 1);

  const start = state.trucks.currentPage * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  tbody.innerHTML =
    pageRows.length > 0
      ? pageRows.map(rowHtml).join('')
      : `<tr class="trucks-empty-row"><td colspan="10">No vehicles match this search</td></tr>`;

  tbody.querySelectorAll('tr[data-plate]').forEach((row, index) => {
    row.classList.toggle('is-focused', start + index === focusedIndex);
  });

  const range = document.getElementById('trucks-range');
  if (range) {
    range.textContent =
      filtered.length === 0
        ? '0 of 0'
        : `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`;
  }

  const badge = document.getElementById('trucks-count-badge');
  if (badge) badge.textContent = `${activeTrucks().length} active`;

  const summary = document.getElementById('trucks-summary');
  if (summary) {
    const archived = REGISTERED_TRUCKS.length - activeTrucks().length;
    summary.textContent = `${REGISTERED_TRUCKS.length} vehicles · ${archived} archived`;
  }

  const prev = document.getElementById('trucks-prev');
  const next = document.getElementById('trucks-next');
  if (prev) prev.disabled = state.trucks.currentPage <= 0;
  if (next) next.disabled = state.trucks.currentPage >= pageCount - 1;
}

// ─── Add / edit form ────────────────────────────────────────────────────────

function setFormError(message) {
  const error = document.getElementById('truck-form-error');
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function openTruckForm(truck = null) {
  const modal = document.getElementById('truck-form-modal');
  const title = document.getElementById('truck-form-title');
  const sub = document.getElementById('truck-form-sub');
  const plateInput = document.getElementById('truck-form-plate');
  const saveBtn = document.getElementById('truck-form-save');
  if (!modal) return;

  state.trucks.editingTruck = truck ? truck.plate : null;
  state._truckFormOpen = true;
  setFormError('');

  title.textContent = truck ? 'Edit Vehicle' : 'New Vehicle';
  sub.textContent = truck
    ? 'Changes apply to future first-weigh entries'
    : 'Master data used to pre-fill first weigh';
  saveBtn.textContent = truck ? 'Save Changes' : 'Save Vehicle';

  plateInput.value = truck?.plate || '';
  plateInput.disabled = Boolean(truck);
  document.getElementById('truck-form-driver').value = truck?.driver || '';
  document.getElementById('truck-form-phone').value = truck?.phone || '';
  document.getElementById('truck-form-client').value = truck?.client || '';
  document.getElementById('truck-form-material').value = truck?.material || '';

  modal.classList.add('open');
  requestAnimationFrame(() =>
    (truck ? document.getElementById('truck-form-driver') : plateInput)?.focus()
  );
}

function closeTruckForm() {
  const modal = document.getElementById('truck-form-modal');
  if (!modal) return;
  modal.classList.remove('open');
  state._truckFormOpen = false;
  state.trucks.editingTruck = null;
  setFormError('');
}

async function submitTruckForm(event) {
  event.preventDefault();
  if (state.trucks.editingTruck) {
    const existing = REGISTERED_TRUCKS.find(
      (truck) => normalize(truck.plate) === normalize(state.trucks.editingTruck)
    );
    if (!existing) {
      setFormError('This vehicle no longer exists');
      return;
    }
  }

  const plate = document.getElementById('truck-form-plate').value;
  const driver = document.getElementById('truck-form-driver').value;
  const phone = document.getElementById('truck-form-phone').value;
  const client = document.getElementById('truck-form-client').value;
  const material = document.getElementById('truck-form-material').value;

  if (!plate.trim() || plate.trim().length < 3) {
    setFormError('Enter a valid truck registration number');
    return;
  }

  if (!state.trucks.editingTruck) {
    const duplicate = REGISTERED_TRUCKS.find(
      (truck) => normalize(truck.plate) === normalize(plate)
    );
    if (duplicate) {
      setFormError(`${duplicate.plate} is already registered`);
      return;
    }
  }

  const operator = state.activeOperator?.name || 'Unknown';
  const wasEditing = Boolean(state.trucks.editingTruck);
  let record;
  try {
    record = await registerTruck({ plate, driver, phone, client, material }, operator);
  } catch (err) {
    setFormError(err?.message || 'Could not save this vehicle');
    return;
  }
  if (!record) {
    setFormError('Could not save this vehicle');
    return;
  }

  closeTruckForm();
  showToast(wasEditing ? `${record.plate} updated` : `${record.plate} registered`, 'success');
  render();
}

// ─── Archive / restore ──────────────────────────────────────────────────────

function archiveVehicle(truck) {
  if (!truck || truck.status === 'archived') return;

  openReasonDialog({
    id: 'archive-truck-modal',
    title: `Archive ${truck.plate}?`,
    metaHtml: `The vehicle stays in history and reports.<br>It is hidden from first-weigh autocomplete.`,
    prompt: 'Why is this vehicle being archived?',
    reasons: ['Sold / transferred', 'No longer in service', 'Duplicate record', 'Other'],
    confirmLabel: 'Archive vehicle',
    confirmTone: 'danger',
    stateFlag: '_archiveDialogOpen',
    onConfirm: async (reason) => {
      const operator = state.activeOperator?.name || 'Unknown';
      const result = await archiveTruck(truck.plate, reason, operator);
      if (!result.ok) {
        showToast(result.reason || 'Vehicle could not be archived', 'error');
        return;
      }
      showToast(`${truck.plate} archived`, 'info');
      render();
    },
  });
}

function restoreVehicle(truck) {
  if (!truck || truck.status !== 'archived') return;

  openConfirmDialog({
    id: 'restore-truck-modal',
    title: `Restore ${truck.plate}?`,
    message: 'The vehicle returns to first-weigh autocomplete and the active register.',
    keepLabel: 'Keep archived',
    confirmLabel: 'Restore vehicle',
    stateFlag: '_truckRestoreOpen',
    onConfirm: async () => {
      const operator = state.activeOperator?.name || 'Unknown';
      try {
        await restoreTruck(truck.plate, operator);
      } catch (err) {
        showToast(err?.message || 'Vehicle could not be restored', 'error');
        return;
      }
      showToast(`${truck.plate} restored`, 'success');
      render();
    },
  });
}

function truckByPlate(plate) {
  return REGISTERED_TRUCKS.find((truck) => normalize(truck.plate) === normalize(plate)) || null;
}

function focusRow(index) {
  if (filtered.length === 0) return;
  focusedIndex = Math.max(0, Math.min(index, filtered.length - 1));
  state.trucks.focusedRowIndex = focusedIndex;

  const page = Math.floor(focusedIndex / pageSize);
  if (page !== state.trucks.currentPage) state.trucks.currentPage = page;
  render();
  document.querySelector('.truck-row.is-focused')?.scrollIntoView({ block: 'nearest' });
}

function focusedTruck() {
  return filtered[focusedIndex] || null;
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

export function initTrucksScreen() {
  const tbody = document.getElementById('trucks-tbody');
  const searchInput = document.getElementById('trucks-search-input');
  const archivedToggle = document.getElementById('trucks-show-archived');
  const form = document.getElementById('truck-form');
  if (!tbody) return;

  searchInput?.addEventListener('input', (event) => {
    state.trucks.searchQuery = event.target.value;
    state.trucks.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  archivedToggle?.addEventListener('change', (event) => {
    state.trucks.showArchived = event.target.checked;
    state.trucks.currentPage = 0;
    focusedIndex = 0;
    render();
  });

  document.getElementById('trucks-new-btn')?.addEventListener('click', () => openTruckForm());
  document.getElementById('truck-form-close')?.addEventListener('click', closeTruckForm);
  document.getElementById('truck-form-cancel')?.addEventListener('click', closeTruckForm);
  document.getElementById('truck-form-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'truck-form-modal') closeTruckForm();
  });
  form?.addEventListener('submit', submitTruckForm);

  document.getElementById('trucks-prev')?.addEventListener('click', () => {
    if (state.trucks.currentPage > 0) {
      state.trucks.currentPage--;
      focusedIndex = state.trucks.currentPage * pageSize;
      render();
    }
  });
  document.getElementById('trucks-next')?.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (state.trucks.currentPage < pageCount - 1) {
      state.trucks.currentPage++;
      focusedIndex = state.trucks.currentPage * pageSize;
      render();
    }
  });

  tbody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-plate]');
    if (!row) return;
    const truck = truckByPlate(row.dataset.plate);
    const index = filtered.findIndex((item) => item.plate === row.dataset.plate);
    if (index >= 0) focusedIndex = index;

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') openTruckForm(truck);
    else if (action === 'archive') archiveVehicle(truck);
    else if (action === 'restore') restoreVehicle(truck);
    else render();
  });

  document.addEventListener('screenchange', (event) => {
    if (event.detail?.screenId !== 'trucks-screen') return;
    if (IS_PRODUCTION) {
      refreshVehiclesFromDatabase().catch(() => {});
    }
    requestAnimationFrame(() => {
      pageSize = calculatePageSize();
      state.trucks.pageSize = pageSize;
      render();
    });
  });

  document.addEventListener('history:refresh', () => render());
  document.addEventListener('vehicle:refresh', () => render());

  window.addEventListener('resize', () => {
    if (state.currentScreen !== 'trucks-screen') return;
    pageSize = calculatePageSize();
    state.trucks.pageSize = pageSize;
    render();
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (state.currentScreen !== 'trucks-screen') return;
      if (document.getElementById('truck-form-modal')?.classList.contains('open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeTruckForm();
        }
        return;
      }
      if (document.querySelector('.modal-overlay.open')) return;

      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
      const popupOpen = ['archive-truck-modal', 'restore-truck-modal'].some((id) =>
        document.getElementById(id)
      );
      if (popupOpen) return;

      if (event.key === 'Escape') {
        if (inInput && searchInput?.value) {
          searchInput.value = '';
          state.trucks.searchQuery = '';
          state.trucks.currentPage = 0;
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
        return;
      }

      if (inInput) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          searchInput?.blur();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        event.stopPropagation();
        openTruckForm();
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
        const truck = focusedTruck();
        if (truck) openTruckForm(truck);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        const truck = focusedTruck();
        if (!truck) return;
        if (truck.status === 'archived') restoreVehicle(truck);
        else archiveVehicle(truck);
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
          state.trucks.searchQuery = event.key;
          state.trucks.currentPage = 0;
          focusedIndex = 0;
          render();
        }
      }
    },
    true
  );

  state.trucks.pageSize = pageSize;
  render();
}
