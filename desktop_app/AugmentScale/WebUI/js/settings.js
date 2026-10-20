/**
 * Hardware & Developer Mode Configuration
 * Settings modal, serial port selector, and environment mode switches.
 */
import { state } from './state.js';
import hapticAudio from './audio.js';
import { showToast } from './toast.js';
import { toggleSimDock } from './simulator-controls.js';

export function applyOperatingMode() {
  const devModePill = document.getElementById('dev-mode-pill');
  const btnToggleSimDock = document.getElementById('btn-toggle-sim-dock');
  const footerSimWrapper = document.getElementById('footer-sim-wrapper');
  // 1. Dev Mode badge in top nav
  if (devModePill) {
    devModePill.style.display = state.devMode ? 'inline-flex' : 'none';
  }

  // 2. Simulator Triggers (Top nav button & Footer bench link)
  const showSimulatorTriggers = state.devMode && state.simulationEnabled;
  if (btnToggleSimDock) {
    btnToggleSimDock.style.display = showSimulatorTriggers ? 'inline-flex' : 'none';
  }
  if (footerSimWrapper) {
    footerSimWrapper.style.display = showSimulatorTriggers ? 'inline-block' : 'none';
  }

  // 3. If Dev Mode is turned OFF while simulator dock is open, close it immediately
  if (!state.devMode || !state.simulationEnabled) {
    const simDock = document.getElementById('sim-dock');
    const simOverlay = document.getElementById('sim-dock-overlay');
    if (simDock && simDock.classList.contains('open')) {
      simDock.classList.remove('open');
      if (simOverlay) simOverlay.classList.remove('open');
    }
  }

  // 5. Update settings modal form state
  const toggleDevMode = document.getElementById('toggle-dev-mode');
  const toggleSimActive = document.getElementById('toggle-sim-active');
  const selectSerialPort = document.getElementById('select-serial-port');
  const badgePortStatus = document.getElementById('badge-port-status');
  const devModeSubpanel = document.getElementById('dev-mode-subpanel');
  const prodModeBanner = document.getElementById('prod-mode-banner');

  if (toggleDevMode) toggleDevMode.checked = state.devMode;
  if (toggleSimActive) toggleSimActive.checked = state.simulationEnabled;
  if (selectSerialPort) selectSerialPort.value = state.serialPort;
  if (badgePortStatus) badgePortStatus.textContent = `PORT ACTIVE (${state.serialPort})`;

  if (devModeSubpanel) {
    devModeSubpanel.style.display = state.devMode ? 'flex' : 'none';
  }
  if (prodModeBanner) {
    prodModeBanner.style.display = state.devMode ? 'none' : 'flex';
  }
}

export function initSettingsModal() {
  const btnSettingsToggle = document.getElementById('btn-settings-toggle');
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const toggleDevMode = document.getElementById('toggle-dev-mode');
  const toggleSimActive = document.getElementById('toggle-sim-active');
  const selectSerialPort = document.getElementById('select-serial-port');
  const btnOpenBench = document.getElementById('btn-settings-open-bench');
  const devModeSubpanel = document.getElementById('dev-mode-subpanel');
  const prodModeBanner = document.getElementById('prod-mode-banner');

  if (!settingsModal) return;

  function openSettings() {
    // Populate form with current state
    if (toggleDevMode) toggleDevMode.checked = state.devMode;
    if (toggleSimActive) toggleSimActive.checked = state.simulationEnabled;
    if (selectSerialPort) selectSerialPort.value = state.serialPort;

    if (devModeSubpanel) devModeSubpanel.style.display = state.devMode ? 'flex' : 'none';
    if (prodModeBanner) prodModeBanner.style.display = state.devMode ? 'none' : 'flex';

    settingsModal.classList.add('open');
  }

  function closeSettings() {
    settingsModal.classList.remove('open');
  }

  if (btnSettingsToggle) {
    btnSettingsToggle.addEventListener('click', openSettings);
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', closeSettings);
  }

  // Backdrop click to close
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettings();
    }
  });

  // Interactive toggle inside modal
  if (toggleDevMode) {
    toggleDevMode.addEventListener('change', () => {
      const isChecked = toggleDevMode.checked;
      if (devModeSubpanel) devModeSubpanel.style.display = isChecked ? 'flex' : 'none';
      if (prodModeBanner) prodModeBanner.style.display = isChecked ? 'none' : 'flex';
    });
  }

  // Open bench directly from developer settings
  if (btnOpenBench) {
    btnOpenBench.addEventListener('click', () => {
      closeSettings();
      state.devMode = true;
      state.simulationEnabled = true;
      localStorage.setItem('weighbridge-dev-mode', 'true');
      localStorage.setItem('weighbridge-sim-active', 'true');
      applyOperatingMode();
      toggleSimDock(true);
    });
  }

  // Save & Apply
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const newDevMode = toggleDevMode ? toggleDevMode.checked : false;
      const newSimActive = toggleSimActive ? toggleSimActive.checked : true;
      const newPort = selectSerialPort ? selectSerialPort.value : 'COM1';

      state.devMode = newDevMode;
      state.simulationEnabled = newSimActive;
      state.serialPort = newPort;

      localStorage.setItem('weighbridge-dev-mode', newDevMode.toString());
      localStorage.setItem('weighbridge-sim-active', newSimActive.toString());
      localStorage.setItem('weighbridge-serial-port', newPort);

      applyOperatingMode();
      closeSettings();

      if (hapticAudio) hapticAudio.playSuccess();

      if (newDevMode) {
        showToast(
          'Developer Mode Enabled: Simulator test bench & diagnostic tools unlocked.',
          'warning'
        );
      } else {
        showToast(
          `Production Certified Mode: Active on ${newPort} (9600 8N1). Simulator hidden.`,
          'success'
        );
      }
    });
  }
}
