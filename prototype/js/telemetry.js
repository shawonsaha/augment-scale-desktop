/**
 * Scale Telemetry Stream Listener
 * Listens to continuous stream from XK3190-D10 Scale Simulator / Serial reader.
 */
import { state } from './state.js';
import scaleSimulator from './scale-simulator.js';
import { updateSecondWeighPreview } from './screens/second-weigh.js';
import { updateFirstWeighPreview } from './screens/first-weigh.js';

const hudRenderers = new Set();

export function registerHudRenderer(renderer) {
  hudRenderers.add(renderer);
  if (state.currentLiveWeight !== null && state.currentLiveWeight !== undefined) {
    renderer({
      weight: state.currentLiveWeight,
      formatted: Number.isFinite(state.currentLiveWeight)
        ? state.currentLiveWeight.toLocaleString('en-US')
        : '------',
      isStable: state.isScaleStable,
      isConnected: state.isScaleConnected,
    });
  }
}

export function unregisterHudRenderer(renderer) {
  hudRenderers.delete(renderer);
}

const renderScaleData = (data) => {
  state.currentLiveWeight = data.weight;
  state.isScaleStable = data.isStable;
  state.isScaleConnected = data.isConnected;

  // 1. Notify registered HUD instances
  hudRenderers.forEach((renderer) => renderer(data));

  // 2. Telemetry Bar indicators (Clean operator-facing status)
  const scaleDot = document.getElementById('scale-status-dot');
  const scaleText = document.getElementById('scale-status-text');

  if (scaleDot && scaleText) {
    if (data.isConnected) {
      scaleDot.className = 'telemetry-dot' + (data.isStable ? '' : ' pulse');
      scaleText.textContent = 'Connected';
    } else {
      scaleDot.className = 'telemetry-dot red';
      scaleText.textContent = 'Disconnected';
    }
  }

  // 3. Synchronize workflow screen previews.
  // Each screen's preview updater owns its own capture-button disabled/title state,
  // because the guards differ per screen (direction, open-ticket block, recapture).
  if (state.currentScreen === 'first-weigh-screen') {
    updateFirstWeighPreview(
      state.firstWeigh.capturedWeight !== null
        ? state.firstWeigh.capturedWeight
        : data.weight
    );
  } else if (
    state.currentScreen === 'second-weigh-screen' &&
    state.secondWeigh.selectedTicket
  ) {
    updateSecondWeighPreview(
      state.secondWeigh.capturedWeight !== null
        ? state.secondWeigh.capturedWeight
        : data.weight
    );
  }
};

export function initScaleStream() {
  scaleSimulator.subscribe(renderScaleData);
}

/**
 * Real hardware feed via the C# WebView2 bridge. Stops the simulator so it
 * cannot overwrite real weight 15 times per second.
 */
export function applyExternalWeight(data) {
  scaleSimulator.stop();
  renderScaleData({
    weight: data.weight,
    formatted: Number.isFinite(data.weight) ? data.weight.toLocaleString('en-US') : '------',
    isStable: !!data.isStable,
    isConnected: data.isConnected !== false,
  });
}
