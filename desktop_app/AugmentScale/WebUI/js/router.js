/**
 * Screen routing and UI navigation manager.
 */
import { state } from './state.js';
import hapticAudio from './audio.js';
import { showToast } from './toast.js';

const NAV_SCREENS = new Set([
  'dashboard-screen',
  'history-screen',
  'trucks-screen',
  'profiles-screen',
]);
const WEIGH_SCREENS = new Set(['first-weigh-screen', 'second-weigh-screen']);

export function showScreen(screenId) {
  if (state.sync.licenseActive === false) {
    return false;
  }
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

  // Header lock button visibility: hide when there is no session to lock
  const lockBtn = document.getElementById('btn-lock-workstation');
  if (lockBtn) {
    lockBtn.style.display = state.activeOperator ? '' : 'none';
  }

  updateActiveOperatorPill();
  updateAppNav(screenId);

  document.dispatchEvent(new CustomEvent('screenchange', { detail: { screenId } }));

  if (hapticAudio) {
    hapticAudio.playClick();
  }
}

/** Refreshes the signed-in operator chip after a profile edit. */
export function updateActiveOperatorPill() {
  const pill = document.getElementById('active-operator-pill');
  if (!pill) return;
  if (!state.activeOperator) {
    pill.style.display = 'none';
    return;
  }

  pill.style.display = 'flex';
  const pillImg = document.getElementById('pill-operator-img');
  if (pillImg && state.activeOperator.avatar) {
    pillImg.src = state.activeOperator.avatar;
  }
  const name = document.getElementById('pill-operator-name');
  if (name) name.textContent = state.activeOperator.name;
}

/** True while an operator is mid-weigh; navigation must go through the guards. */
export function isWeighScreen(screenId = state.currentScreen) {
  return WEIGH_SCREENS.has(screenId);
}

export function isSupervisor(operator = state.activeOperator) {
  return String(operator?.role || '').toLowerCase() === 'supervisor';
}

/** Nav buttons and chords route through here so weigh flows cannot be bypassed. */
export function requestNavigation(screenId) {
  if (state.sync.licenseActive === false) return false;
  if (!state.activeOperator) return false;
  if (isWeighScreen()) {
    showToast('Finish or discard the current weigh before leaving', 'warning');
    return false;
  }
  if (screenId === 'profiles-screen') {
    if (!isSupervisor()) {
      showToast('Supervisor access is required to manage profiles', 'warning');
      return false;
    }
    document.dispatchEvent(new CustomEvent('profiles:manage'));
    return true;
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
    if (tab.dataset.screen === 'profiles-screen') {
      tab.hidden = !isSupervisor();
    }
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
    if (requestNavigation(tab.dataset.screen)) tab.blur();
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
