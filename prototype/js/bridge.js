/**
 * WebView2 Bridge — Public API for C# interop.
 * C# calls: webView.CoreWebView2.ExecuteScriptAsync("window.ScaleApp.methodName(args)")
 */
import { state, pendingTickets } from './state.js';
import { showScreen } from './router.js';
import { showToast } from './toast.js';
import { applyExternalWeight } from './telemetry.js';

export const ScaleApp = {
  // Read state
  getState: () => JSON.parse(JSON.stringify(state)),
  getPendingTickets: () => JSON.parse(JSON.stringify(pendingTickets)),

  // Screen navigation
  showScreen: (screenId) => showScreen(screenId),

  // Toast notifications from C#
  showToast: (message, type) => showToast(message, type),

  // Receive real weight data from C# serial reader (stops the simulator)
  onWeightData: (data) => {
    if (data && typeof data.weight === 'number') {
      applyExternalWeight(data);
    }
  },
};

if (typeof window !== 'undefined') {
  window.ScaleApp = ScaleApp;
}

export default ScaleApp;
