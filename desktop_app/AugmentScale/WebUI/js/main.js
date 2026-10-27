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
import { initProfilesScreen } from './screens/profiles.js';
import { initPrintModal } from './print.js';
import { initHistoryReport } from './history-report.js?v=prod18';
import { initVerifyReport } from './verify-report.js';
import { initKeyboardShortcuts } from './keyboard.js';
import { initRefreshControls } from './refresh.js';
import { initThemeToggle } from './theme.js';
import { updateClock, initAppNav } from './router.js';
import { hasDesktopBridge } from './runtime.js';
import { loadProductionData } from './state.js';
import './bridge.js';

async function bootstrap() {
  if (!hasDesktopBridge) {
    const app = document.getElementById('app') || document.body;
    app.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui,-apple-system,sans-serif;background:#0b1120;color:#f8fafc;padding:2rem;text-align:center;">
        <div style="max-width:480px;background:#1e293b;padding:2rem;border-radius:12px;border:1px solid #334155;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);">
          <div style="font-size:2.5rem;margin-bottom:1rem;">⚖️</div>
          <h1 style="font-size:1.4rem;font-weight:600;margin:0 0 0.75rem 0;color:#f1f5f9;">Desktop Host Required</h1>
          <p style="font-size:0.95rem;line-height:1.6;color:#94a3b8;margin:0 0 1.25rem 0;">
            Augment Scale runs exclusively inside the Windows desktop host (WebView2). Standalone browser demo mode has been retired.
          </p>
          <div style="font-size:0.85rem;color:#64748b;background:#0f172a;padding:0.75rem 1rem;border-radius:8px;">
            Please launch the workstation using <strong>AugmentScale.exe</strong>.
          </div>
        </div>
      </div>
    `;
    console.warn('Augment Scale requires the desktop workstation host (WebView2). Standalone browser demo mode has been retired.');
    return;
  }

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
  initProfilesScreen();
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
  if (!hasDesktopBridge) return;
  // Double rAF: first frame flushes layout, second confirms the screen is visible.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.chrome.webview.postMessage({
          type: 'ui-ready',
          theme: document.documentElement.getAttribute('data-theme') || 'dark',
        });
      } catch {}
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bootstrap());
} else {
  bootstrap();
}
