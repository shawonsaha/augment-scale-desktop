/**
 * WebView2 Bridge — Public API for C# interop.
 * C# calls: webView.CoreWebView2.ExecuteScriptAsync("window.ScaleApp.methodName(args)")
 */
import { state, pendingTickets } from './state.js';
import { showScreen } from './router.js';
import { showToast } from './toast.js';
import { applyExternalWeight } from './telemetry.js';
import { IS_PRODUCTION, sendCommand } from './runtime.js';

export const ScaleApp = {
  IS_PRODUCTION,
  sendCommand,

  // Read state
  getState: () => JSON.parse(JSON.stringify(state)),
  getPendingTickets: () => JSON.parse(JSON.stringify(pendingTickets)),

  // Screen navigation
  showScreen: (screenId) => showScreen(screenId),

  // Toast notifications from C#
  showToast: (message, type) => showToast(message, type),

  // Receive live weight data from the C# scale reader
  onWeightData: (data) => {
    if (data && typeof data.weight === 'number') {
      applyExternalWeight(data);
    }
  },

  // Connection changes from the serial reader (cable pulled, port busy, etc.)
  onScaleStatus: (data) => {
    if (!data) return;
    applyExternalWeight({
      weight: state.currentLiveWeight,
      isStable: false,
      isConnected: data.isConnected !== false,
      source: data.isSimulator ? 'simulator' : 'hardware',
    });
    if (!data.isConnected && data.message) {
      showToast(data.message, 'warning');
    }
  },
};

if (typeof window !== 'undefined') {
  window.ScaleApp = ScaleApp;
}

export default ScaleApp;
