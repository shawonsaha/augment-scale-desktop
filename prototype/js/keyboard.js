/**
 * Global Keyboard Shortcuts
 * Industrial single-key hotkeys for rapid weighbridge workflow:
 * 1 (First Weigh), 2 (Second Weigh), I (Inbound), O (Outbound),
 * Spacebar (Capture/Recapture), Enter (Finalize/Print), Escape (Back/Close),
 * M (Material input), Ctrl+S (Register truck), Ctrl+Enter (Open pending ticket),
 * ~ (Simulator Drawer), ? (Cheat Sheet modal), Ctrl+L (Lock workstation).
 */
import { state, pendingTickets } from './state.js';
import { showScreen, requestNavigation } from './router.js';
import { showToast } from './toast.js';
import { toggleSimDock } from './simulator-controls.js';
import { closePrintModal } from './print.js';
import {
  setFirstWeighDirection,
  handleFirstWeighBack,
  doCaptureFirstWeigh,
  doRegisterOrUpdateTruck,
  openPendingTicketForCurrentTruck,
  updateBackButtonState,
} from './screens/first-weigh.js';
import { openDiscardWeightDialog } from './screens/second-weigh.js';

/**
 * Alt in the browser prototype; flip to 'ctrl' in the WebView2 host where
 * browser accelerators are disabled. One place to change, labels follow.
 */
export const NAV_MODIFIER = 'alt';

const NAV_LETTERS = { dashboard: 'D', history: 'H', trucks: 'T' };

function navChord(e, letter) {
  if (e.key?.toLowerCase() !== letter.toLowerCase()) return false;
  if (NAV_MODIFIER === 'alt') return e.altKey && !e.ctrlKey && !e.metaKey;
  return (e.ctrlKey || e.metaKey) && !e.altKey;
}

function applyNavChordLabels() {
  const chord = NAV_MODIFIER === 'alt' ? 'Alt' : 'Ctrl';
  document.querySelectorAll('[data-nav-chord]').forEach((el) => {
    const letter = NAV_LETTERS[el.dataset.navChord];
    if (!letter) return;
    const label = el.querySelector('.app-nav-label')?.textContent || el.dataset.navChord;
    if (el.classList.contains('app-nav-tab')) {
      el.title = `${label} (${chord}+${letter})`;
    }
    const kbd = el.querySelector('.shortcut-kbd');
    if (kbd) kbd.textContent = `${chord} + ${letter}`;
  });
}

export function initKeyboardShortcuts() {
  applyNavChordLabels();

  document.addEventListener('keydown', (e) => {
    // Block all global hotkeys while modal dialogs are open (except print modal Enter/Esc)
    if (state._deleteDialogOpen || state._discardDialogOpen || state._overrideDialogOpen) return;

    // Check if currently focused inside a text input or textarea
    const activeEl = document.activeElement;
    const inInput =
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) ||
      Boolean(activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName));

    // Primary navigation: Alt+D / Alt+H / Alt+T (Ctrl in the WebView2 host)
    if (navChord(e, 'd')) {
      e.preventDefault();
      requestNavigation('dashboard-screen');
      return;
    }
    if (navChord(e, 'h')) {
      e.preventDefault();
      requestNavigation('history-screen');
      return;
    }
    if (navChord(e, 't')) {
      e.preventDefault();
      requestNavigation('trucks-screen');
      return;
    }

    // Ctrl+S: Register / Update truck shortcut (never opens browser Save Page)
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      if (state.currentScreen === 'first-weigh-screen') {
        e.preventDefault();
        const regStrip = document.getElementById('fw-register-strip');
        if (regStrip && !regStrip.hidden) {
          doRegisterOrUpdateTruck();
        }
        return;
      }
    }

    // Ctrl+Enter or Cmd+Enter: Open pending ticket if truck has open ticket
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (state.currentScreen === 'first-weigh-screen') {
        const pendingNotice = document.getElementById('fw-truck-pending-notice');
        const truckInput = document.getElementById('fw-truck-input');
        const plate = truckInput ? truckInput.value.trim().toUpperCase() : '';
        const hasOpen = plate && pendingTickets.some(
          (t) => (t.truckNo || '').trim().toUpperCase() === plate
        );

        if ((pendingNotice && !pendingNotice.hidden) || hasOpen) {
          e.preventDefault();
          openPendingTicketForCurrentTruck();
          return;
        }
      }
    }

    // Escape: Innermost-first layering
    if (e.key === 'Escape') {
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal && settingsModal.classList.contains('open')) {
        settingsModal.classList.remove('open');
        return;
      }
      const simDock = document.getElementById('sim-dock');
      if (simDock && simDock.classList.contains('open')) {
        toggleSimDock(false);
        return;
      }
      const printModal = document.getElementById('print-modal');
      const shortcutsModal = document.getElementById('shortcuts-modal');
      if (printModal && printModal.classList.contains('open')) {
        closePrintModal();
        return;
      }
      if (shortcutsModal && shortcutsModal.classList.contains('open')) {
        shortcutsModal.classList.remove('open');
        return;
      }

      // First Weigh: 1. Close open suggestions list, 2. Blur active field, 3. Discard/Back
      if (state.currentScreen === 'first-weigh-screen') {
        const truckSug = document.getElementById('fw-truck-suggestions');
        const matDrop = document.getElementById('fw-material-dropdown');
        const isListOpen = (truckSug && !truckSug.hidden) || (matDrop && !matDrop.hidden);

        if (isListOpen) {
          if (truckSug) truckSug.hidden = true;
          if (matDrop) matDrop.hidden = true;
          updateBackButtonState();
          return;
        }

        if (inInput) {
          if (activeEl && typeof activeEl.blur === 'function') {
            activeEl.blur();
          } else if (e.target && typeof e.target.blur === 'function') {
            e.target.blur();
          }
          updateBackButtonState();
          return;
        }

        handleFirstWeighBack();
        return;
      }

      if (state.currentScreen === 'second-weigh-screen') {
        if (state.secondWeigh.capturedWeight !== null) {
          openDiscardWeightDialog();
          return;
        }
      }

      if (state.currentScreen !== 'dashboard-screen' && state.currentScreen !== 'login-screen') {
        showScreen('dashboard-screen');
      }
      return;
    }

    // Toggle Simulator Dock: `~` or Ctrl+Shift+D
    if (
      (e.key === '`' ||
        e.key === '~' ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd')) &&
      !inInput
    ) {
      e.preventDefault();
      toggleSimDock();
      return;
    }

    // Lock Workstation: Ctrl+L
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (state.currentScreen === 'login-screen') return;
      state.activeOperator = null;
      showToast('Workstation locked', 'info');
      showScreen('login-screen');
      return;
    }

    // First Weigh Direction hotkeys (I for Inbound, O for Outbound)
    if (state.currentScreen === 'first-weigh-screen') {
      const key = e.key.toLowerCase();
      if ((key === 'o' && !inInput) || (e.altKey && key === 'o')) {
        e.preventDefault();
        setFirstWeighDirection('OUT', true);
        return;
      }
      if ((key === 'i' && !inInput) || (e.altKey && key === 'i')) {
        e.preventDefault();
        setFirstWeighDirection('IN', true);
        return;
      }

      // M key: Focus Material input when nothing is focused
      if ((key === 'm' && !inInput) || (e.altKey && key === 'm')) {
        e.preventDefault();
        const matInput = document.getElementById('fw-material-input');
        if (matInput) {
          matInput.focus();
          matInput.select();
        }
        return;
      }
    }

    // Spacebar: Dual-purpose Capture & Recapture Weight
    if (e.key === ' ' && !inInput && !e.repeat) {
      e.preventDefault();
      if (state.currentScreen === 'first-weigh-screen') {
        doCaptureFirstWeigh();
        return;
      } else if (state.currentScreen === 'second-weigh-screen') {
        const captureBtn = document.getElementById('sw-btn-capture');
        if (captureBtn && !captureBtn.disabled) {
          captureBtn.click();
        }
      }
      return;
    }

    // Shift+Enter: Override shortcut (Second Weigh)
    if (e.key === 'Enter' && e.shiftKey && !e.repeat) {
      if (state.currentScreen === 'second-weigh-screen') {
        const overrideBtn = document.getElementById('sw-status-override-btn');
        if (overrideBtn && !overrideBtn.hidden) {
          e.preventDefault();
          overrideBtn.click();
          return;
        }
      }
    }

    // Enter Key: When print modal is open -> Confirm & Print; Otherwise -> Preview / Finalize
    if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
      const printModal = document.getElementById('print-modal');
      if (printModal && printModal.classList.contains('open')) {
        e.preventDefault();
        const confirmBtn = document.getElementById('btn-print-slip');
        if (confirmBtn && !confirmBtn.disabled && window._printConfirmReady) {
          confirmBtn.click();
        }
        return;
      }

      if (!inInput) {
        if (state.currentScreen === 'first-weigh-screen') {
          const previewBtn = document.getElementById('fw-btn-preview');
          if (previewBtn && !previewBtn.disabled) {
            e.preventDefault();
            previewBtn.click();
            return;
          } else {
            e.preventDefault();
            const dir = state.firstWeigh.direction;
            const truckInput = document.getElementById('fw-truck-input');
            const truck = truckInput ? truckInput.value.trim() : '';

            if (state.firstWeigh._blockedByOpenTicket) {
              showToast(
                `Capture blocked: this truck has open ticket #${state.firstWeigh._blockedTicketId}`,
                'error'
              );
            } else if (!dir) {
              showToast('Please select weight direction (I for Inbound, O for Outbound)', 'warning');
            } else if (!truck) {
              if (truckInput) truckInput.focus();
              showToast('Enter truck registration number', 'warning');
            } else if (state.firstWeigh.capturedWeight === null) {
              showToast('Capture weight first (Press Spacebar)', 'warning');
            }
            return;
          }
        } else if (state.currentScreen === 'second-weigh-screen') {
          const finalizeBtn = document.getElementById('sw-btn-finalize');
          if (finalizeBtn && !finalizeBtn.disabled) {
            e.preventDefault();
            finalizeBtn.click();
            return;
          }
        }
      }
    }

    if (e.key === '?' && !inInput) {
      e.preventDefault();
      const modal = document.getElementById('shortcuts-modal');
      if (modal) modal.classList.toggle('open');
    }
  });

  const shortcutsBtn = document.getElementById('btn-shortcuts-help');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const closeShortcuts = document.getElementById('btn-close-shortcuts');

  if (shortcutsBtn && shortcutsModal) {
    shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.add('open'));
  }
  if (closeShortcuts && shortcutsModal) {
    closeShortcuts.addEventListener('click', () => shortcutsModal.classList.remove('open'));
  }
}
