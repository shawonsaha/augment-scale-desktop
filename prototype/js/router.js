/**
 * Screen routing and UI navigation manager.
 */
import { state } from './state.js';
import hapticAudio from './audio.js';
import { showToast } from './toast.js';

const NAV_SCREENS = new Set(['dashboard-screen', 'history-screen', 'trucks-screen']);
const WEIGH_SCREENS = new Set(['first-weigh-screen', 'second-weigh-screen']);

export function showScreen(screenId) {
  const current = document.getElementById(state.currentScreen);
  const target = document.getElementById(screenId);

  if (current) {
    current.classList.remove('active');
  }

  if (target) {
    target.classList.add('active');
    state.currentScreen = screenId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Header telemetry visibility
  const telemetryBar = document.getElementById('telemetry-bar');
  if (telemetryBar) {
    telemetryBar.style.display = 'flex';
  }

  // Header lock button visibility: hide on login screen (there is no session to lock)
  const lockBtn = document.getElementById('btn-lock-workstation');
  if (lockBtn) {
    lockBtn.style.display = screenId === 'login-screen' ? 'none' : '';
  }

  // Update operator pill in top bar
  const pill = document.getElementById('active-operator-pill');
  if (pill) {
    if (state.activeOperator) {
      pill.style.display = 'flex';
      const pillImg = document.getElementById('pill-operator-img');
      if (pillImg && state.activeOperator.avatar) {
        pillImg.src = state.activeOperator.avatar;
      }
      document.getElementById('pill-operator-name').textContent = state.activeOperator.name;
    } else {
      pill.style.display = 'none';
    }
  }

  updateAppNav(screenId);

  document.dispatchEvent(new CustomEvent('screenchange', { detail: { screenId } }));

  if (hapticAudio) {
    hapticAudio.playClick();
  }
}

/** True while an operator is mid-weigh; navigation must go through the guards. */
export function isWeighScreen(screenId = state.currentScreen) {
  return WEIGH_SCREENS.has(screenId);
}

/** Nav buttons and chords route through here so weigh flows cannot be bypassed. */
export function requestNavigation(screenId) {
  if (!state.activeOperator) return false;
  if (isWeighScreen()) {
    showToast('Finish or discard the current weigh before leaving', 'warning');
    return false;
  }
  showScreen(screenId);
  return true;
}

/** Shows/hides and highlights the primary navigation tabs. */
export function updateAppNav(screenId = state.currentScreen) {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  const visible = Boolean(state.activeOperator) && NAV_SCREENS.has(screenId);
  nav.hidden = !visible;
  if (!visible) return;

  nav.querySelectorAll('.app-nav-tab').forEach((tab) => {
    const isActive = tab.dataset.screen === screenId;
    tab.classList.toggle('is-active', isActive);
    if (isActive) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  });
}

/** Wires the top-bar nav once after partials are injected. */
export function initAppNav() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  nav.addEventListener('click', (event) => {
    const tab = event.target.closest('.app-nav-tab');
    if (!tab) return;
    requestNavigation(tab.dataset.screen);
  });

  updateAppNav();
}

export function updateClock() {
  const clockEl = document.getElementById('system-clock');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
