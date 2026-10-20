/**
 * Shared Reason Dialog
 * Reusable modal for reason-based confirmations (ticket deletion, anomaly override, etc.)
 * Traps keyboard navigation, supports Up/Down radio cycling, 'Other' text input, Esc cancel, Enter confirm.
 */

import { state } from './state.js';
import { escapeHtml } from './utils.js';

/**
 * Opens a modal dialog prompting the user to select or enter a reason.
 *
 * @param {Object} config
 * @param {string} [config.id='reason-dialog-modal'] - Modal overlay element ID
 * @param {string} config.title - Dialog heading
 * @param {string} [config.meta] - Metadata text (newlines converted to <br>)
 * @param {string} [config.metaHtml] - Pre-formatted HTML metadata (takes precedence over meta)
 * @param {string} config.prompt - Sub-question prompt
 * @param {string[]} config.reasons - Array of preset reason strings
 * @param {string} [config.confirmLabel='Confirm'] - Label for confirm button
 * @param {string} [config.confirmTone='danger'] - 'danger' | 'warning'
 * @param {string} [config.stateFlag='_reasonDialogOpen'] - Property name on state to flag open status
 * @param {function(string): void} config.onConfirm - Invoked with the selected/entered reason
 * @param {function(): void} [config.onCancel] - Invoked if cancelled
 */
export function openReasonDialog(config) {
  const modalId = config.id || 'reason-dialog-modal';
  const stateFlag = config.stateFlag || '_reasonDialogOpen';

  if (state[stateFlag] || document.getElementById(modalId)) return;
  state[stateFlag] = true;

  const appEl = document.getElementById('app') || document.body;
  const tone = config.confirmTone === 'warning' ? 'warning' : 'danger';
  const confirmClass = tone === 'warning' ? 'btn-confirm-override' : 'btn-confirm-delete';
  const dialogToneClass = tone === 'warning' ? 'reason-dialog--tone-warning' : 'reason-dialog--tone-danger';

  let metaHtml = '';
  if (config.metaHtml) {
    metaHtml = config.metaHtml;
  } else if (config.meta) {
    metaHtml = escapeHtml(config.meta).replace(/\n/g, '<br>');
  }

  const reasonsList = Array.isArray(config.reasons) ? config.reasons : [];
  const reasonsHtml = reasonsList
    .map((r) => {
      const escaped = escapeHtml(r);
      return `
        <label>
          <input type="radio" name="reason-option" value="${escaped}">
          <span>${escaped}</span>
        </label>
      `;
    })
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = modalId;
  overlay.innerHTML = `
    <div class="modal-content delete-dialog ${dialogToneClass}" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
      <div class="delete-dialog-header">
        <h3 id="${modalId}-title">${escapeHtml(config.title || 'Confirm Action')}</h3>
        ${metaHtml ? `<div class="delete-dialog-meta">${metaHtml}</div>` : ''}
      </div>
      <div class="delete-dialog-body">
        <div class="delete-dialog-prompt">${escapeHtml(config.prompt || 'Please select a reason:')}</div>
        <div class="delete-reasons" role="radiogroup" aria-label="${escapeHtml(config.prompt || 'Reason')}">
          ${reasonsHtml}
        </div>
        <input
          type="text"
          class="delete-other-input"
          id="${modalId}-other-input"
          placeholder="Type the reason here..."
          maxlength="100"
          style="display: none;"
          aria-label="Custom reason"
        />
      </div>
      <div class="delete-dialog-footer">
        <button type="button" class="btn-cancel-delete" id="${modalId}-cancel-btn">Cancel</button>
        <button type="button" class="${confirmClass}" id="${modalId}-confirm-btn" disabled>${escapeHtml(config.confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  `;

  appEl.appendChild(overlay);

  const radios = overlay.querySelectorAll('input[name="reason-option"]');
  const otherInput = overlay.querySelector(`#${modalId}-other-input`);
  const confirmBtn = overlay.querySelector(`#${modalId}-confirm-btn`);
  const cancelBtn = overlay.querySelector(`#${modalId}-cancel-btn`);

  function getSelectedReason() {
    const selectedRadio = overlay.querySelector('input[name="reason-option"]:checked');
    if (!selectedRadio) return null;
    if (selectedRadio.value === 'Other') {
      const text = otherInput.value.trim();
      return text.length > 0 ? text : null;
    }
    return selectedRadio.value;
  }

  function validate() {
    const reason = getSelectedReason();
    confirmBtn.disabled = !reason;
  }

  function closeDialog() {
    state[stateFlag] = false;
    document.removeEventListener('keydown', handleDialogKeydown, true);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (typeof config.onCancel === 'function') {
      config.onCancel();
    }
  }

  function handleConfirm() {
    const reason = getSelectedReason();
    if (!reason) return;

    state[stateFlag] = false;
    document.removeEventListener('keydown', handleDialogKeydown, true);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }

    if (typeof config.onConfirm === 'function') {
      config.onConfirm(reason);
    }
  }

  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'Other') {
        otherInput.style.display = 'block';
        otherInput.focus();
      } else {
        otherInput.style.display = 'none';
      }
      validate();
    });
  });

  otherInput.addEventListener('input', () => {
    validate();
  });

  otherInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!confirmBtn.disabled) handleConfirm();
    }
  });

  cancelBtn.addEventListener('click', closeDialog);
  confirmBtn.addEventListener('click', handleConfirm);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  function handleDialogKeydown(e) {
    if (!state[stateFlag]) return;

    // Stop all background screen hotkey handlers
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
      return;
    }

    const isOtherInputFocused = document.activeElement === otherInput;

    if (e.key === 'Enter') {
      if (!confirmBtn.disabled) {
        e.preventDefault();
        handleConfirm();
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const radioList = Array.from(radios);
      const currentSelectedIdx = radioList.findIndex((r) => r.checked);

      let nextIdx;
      if (currentSelectedIdx === -1) {
        nextIdx = e.key === 'ArrowDown' ? 0 : radioList.length - 1;
      } else if (e.key === 'ArrowDown') {
        nextIdx = (currentSelectedIdx + 1) % radioList.length;
      } else {
        nextIdx = (currentSelectedIdx - 1 + radioList.length) % radioList.length;
      }

      radioList[nextIdx].checked = true;
      radioList[nextIdx].focus();

      if (radioList[nextIdx].value === 'Other') {
        otherInput.style.display = 'block';
        otherInput.focus();
      } else {
        otherInput.style.display = 'none';
      }
      validate();
      return;
    }

    if (isOtherInputFocused) {
      // Allow normal typing, arrows, etc. inside text input
      return;
    }
  }

  document.addEventListener('keydown', handleDialogKeydown, true);
}
