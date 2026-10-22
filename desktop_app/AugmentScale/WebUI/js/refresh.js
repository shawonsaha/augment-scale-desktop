import { loadProductionData } from './state.js';
import { renderPendingTicketsTable } from './screens/dashboard.js';
import { updateSyncUI } from './sync.js';
import { showToast } from './toast.js';

let refreshPromise = null;
let refreshButton = null;

function setRefreshing(active) {
  if (!refreshButton) return;
  refreshButton.classList.toggle('is-refreshing', active);
  refreshButton.disabled = active;
  refreshButton.setAttribute('aria-busy', String(active));
}

export async function refreshAllData() {
  if (refreshPromise) return refreshPromise;

  setRefreshing(true);
  refreshPromise = (async () => {
    try {
      await loadProductionData();
      renderPendingTicketsTable();
      document.dispatchEvent(new CustomEvent('data:refresh'));
      document.dispatchEvent(new CustomEvent('vehicle:refresh'));
      document.dispatchEvent(new CustomEvent('history:refresh'));
      updateSyncUI();
      showToast('Data refreshed from database', 'success');
      return true;
    } catch (err) {
      showToast(err?.message || 'Could not refresh data from the database', 'error');
      return false;
    } finally {
      refreshPromise = null;
      setRefreshing(false);
    }
  })();

  return refreshPromise;
}

export function initRefreshControls() {
  refreshButton = document.getElementById('btn-refresh-data');
  refreshButton?.addEventListener('click', () => {
    refreshAllData();
  });
}
