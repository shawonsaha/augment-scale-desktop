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
import { initHistoryReport } from './history-report.js';
import { initVerifyReport } from './verify-report.js';
import { initKeyboardShortcuts } from './keyboard.js';
import { initRefreshControls } from './refresh.js';
import { initThemeToggle } from './theme.js';
import { updateClock, initAppNav } from './router.js';
import { IS_PRODUCTION } from './runtime.js';
import { loadProductionData } from './state.js';
import './bridge.js';

async function bootstrap() {
  // Pull workstation data from C# while the HTML partials are still being
  // fetched; both run concurrently so the login screen is ready sooner.
  const dataTask = loadProductionData().catch((err) => {
    console.error('Failed to load workstation data from the local database', err);
  });

  await loadPartials();
  await dataTask;

  initSyncEngine();
  initLoginScreen();
  initDashboard();
  initFirstWeighScreen();
  initSecondWeighScreen();
  initHistoryScreen();
  initTrucksScreen();
  initPrintModal();
  initHistoryReport();
  initVerifyReport();
  initRefreshControls();
  initKeyboardShortcuts();
  initAppNav();
  initThemeToggle();
  renderPendingTicketsTable();
  updateClock();
  setInterval(updateClock, 1000);

  // Everything is bound and the operator list is rendered: let the desktop
  // shell drop its WebView2 loading mask now instead of a fixed guess.
  notifyUiReady();
}

/** Signals the WPF host that the interface can be shown (best effort). */
function notifyUiReady() {
  if (!IS_PRODUCTION) return;
  // Double rAF: first frame flushes layout, second confirms the screen is visible.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.chrome.webview.postMessage({ type: 'ui-ready' });
      } catch {}
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bootstrap());
} else {
  bootstrap();
}
