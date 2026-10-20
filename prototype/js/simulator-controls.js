/**
 * Simulator Drawer Controls
 * XK3190-D10 bench tools, load simulation presets, motion jitter, and cable disconnect.
 */
import { state } from './state.js';
import scaleSimulator from './scale-simulator.js';
import { showToast } from './toast.js';
import { toggleSimulatedSyncFailure } from './sync.js';

export function toggleSimDock(forceOpen) {
  const dock = document.getElementById('sim-dock');
  const overlay = document.getElementById('sim-dock-overlay');
  if (!dock) return;

  const willOpen = forceOpen !== undefined ? forceOpen : !dock.classList.contains('open');

  if (willOpen) {
    if (!state.devMode) {
      dock.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      showToast(
        'Production Mode: Simulator is disabled. Enable Developer Mode in Settings (⚙️).',
        'info'
      );
      return;
    }
    if (!state.simulationEnabled) {
      dock.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      showToast(
        'Simulation is disabled. Enable "Virtual Hardware Simulator" in Settings (⚙️).',
        'info'
      );
      return;
    }
  }

  dock.classList.toggle('open', willOpen);
  if (overlay) overlay.classList.toggle('open', willOpen);
}

export function initSimulatorControls() {
  const btnEmptyScale = document.getElementById('sim-empty-scale');
  const btnEmptyTruck = document.getElementById('sim-empty-truck');
  const btnLoadedTruck = document.getElementById('sim-loaded-truck');
  const btnInversionTruck = document.getElementById('sim-inversion-truck');
  const btnMotion = document.getElementById('sim-toggle-motion');
  const btnScale = document.getElementById('sim-toggle-scale');
  const btnDrawerSync = document.getElementById('sim-toggle-sync-state');

  const btnToggleSimDock = document.getElementById('btn-toggle-sim-dock');
  const btnFooterSimDock = document.getElementById('btn-footer-sim-dock');
  const btnCloseSimDock = document.getElementById('btn-close-sim-dock');
  const simDockOverlay = document.getElementById('sim-dock-overlay');

  if (btnToggleSimDock) btnToggleSimDock.addEventListener('click', () => toggleSimDock());
  if (btnFooterSimDock) btnFooterSimDock.addEventListener('click', () => toggleSimDock(true));
  if (btnCloseSimDock) btnCloseSimDock.addEventListener('click', () => toggleSimDock(false));
  if (simDockOverlay) simDockOverlay.addEventListener('click', () => toggleSimDock(false));

  if (btnEmptyScale) {
    btnEmptyScale.addEventListener('click', () => {
      scaleSimulator.zeroScale();
      showToast('Simulating Scale Zeroed (0 kg)', 'info');
    });
  }

  if (btnEmptyTruck) {
    btnEmptyTruck.addEventListener('click', () => {
      scaleSimulator.setTargetWeight(12800, true);
      showToast('Simulating Empty Truck Driving on Scale (12,800 kg)', 'info');
    });
  }

  if (btnLoadedTruck) {
    btnLoadedTruck.addEventListener('click', () => {
      scaleSimulator.setTargetWeight(28450, true);
      showToast('Simulating Loaded Truck Driving on Scale (28,450 kg)', 'info');
    });
  }

  if (btnInversionTruck) {
    btnInversionTruck.addEventListener('click', () => {
      scaleSimulator.setTargetWeight(11200, true);
      showToast('Simulating Inversion Test Weight (11,200 kg) — Gross < Tare Test', 'warning');
    });
  }

  if (btnMotion) {
    btnMotion.addEventListener('click', () => {
      const isStable = scaleSimulator.toggleStability();
      btnMotion.classList.toggle('active', !isStable);
      showToast(isStable ? 'Scale Forced Stable' : 'Scale Vibrating in Motion', 'info');
    });
  }

  if (btnScale) {
    btnScale.addEventListener('click', () => {
      const isConnected = scaleSimulator.toggleConnection();
      btnScale.classList.toggle('active', !isConnected);
      btnScale.textContent = isConnected ? 'Disconnect COM1 Serial' : 'Reconnect COM1 Serial';
      showToast(
        isConnected ? 'Scale Hardware COM1 Reconnected' : 'Scale Hardware COM1 Disconnected',
        isConnected ? 'success' : 'error'
      );
    });
  }

  if (btnDrawerSync) {
    btnDrawerSync.addEventListener('click', () => {
      toggleSimulatedSyncFailure();
    });
  }
}
