/**
 * Augment Scale — Module Entry Point
 * Orchestrates all screen modules, hardware streams, and event handlers.
 */
import { loadPartials } from './html-loader.js';
import { initSyncEngine } from './sync.js';
import { initLoginScreen } from './screens/login.js';
import { initDashboard, renderPendingTicketsTable } from './screens/dashboard.js';
import { initFirstWeighScreen } from './screens/first-weigh.js';
import { initSecondWeighScreen } from './screens/second-weigh.js';
import { initHistoryScreen } from './screens/history.js';
import { initTrucksScreen } from './screens/trucks.js';
import { initPrintModal } from './print.js';
import { initKeyboardShortcuts } from './keyboard.js';
import { initRefreshControls } from './refresh.js';
import { initThemeToggle } from './theme.js';
import { updateClock, initAppNav } from './router.js';
import { IS_PRODUCTION } from './runtime.js';
import { loadProductionData } from './state.js';
import './bridge.js';

async function bootstrap() {
  await loadPartials();

  if (IS_PRODUCTION) {
    try {
      await loadProductionData();
    } catch (err) {
      console.error('Failed to load workstation data from the local database', err);
    }
  }

  initSyncEngine();
  initLoginScreen();
  initDashboard();
  initFirstWeighScreen();
  initSecondWeighScreen();
  initHistoryScreen();
  initTrucksScreen();
  initPrintModal();
  initRefreshControls();
  initKeyboardShortcuts();
  initAppNav();
  initThemeToggle();
  renderPendingTicketsTable();
  updateClock();
  setInterval(updateClock, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bootstrap());
} else {
  bootstrap();
}
