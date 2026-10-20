/**
 * Shared Confirm Dialog
 * Reusable two-button confirmation modal (e.g. "Discard and leave").
 * Traps keyboard navigation: Up/Down/Left/Right cycle buttons, Tab is trapped,
 * Enter confirms the focused button, Esc cancels, overlay click cancels.
 */

import { state } from './state.js';
import { escapeHtml } from './utils.js';

/**
 * Opens a confirmation dialog.
 *
 * @param {Object} config
 * @param {string} [config.id='confirm-dialog-modal'] - Modal overlay element ID
 * @param {string} config.title - Dialog heading
 * @param {string} config.message - Body message
 * @param {string} [config.keepLabel='Keep working'] - Label for the cancel/keep button
 * @param {string} [config.confirmLabel='Confirm'] - Label for the confirm button
 * @param {string} [config.stateFlag='_confirmDialogOpen'] - Property name on state to flag open status
 * @param {function(): void} [config.onConfirm] - Invoked when the confirm button is chosen
 * @param {function(): void} [config.onCancel] - Invoked when cancelled (keep/Esc/overlay)
 */
export function openConfirmDialog(config) {
  const modalId = config.id || 'confirm-dialog-modal';
  const stateFlag = config.stateFlag || '_confirmDialogOpen';

  if (state[stateFlag] || document.getElementById(modalId)) return;
  state[stateFlag] = true;

  const appEl = document.getElementById('app') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = modalId;
  overlay.innerHTML = `
    <div class="modal-content delete-dialog" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
      <div class="delete-dialog-header">
        <h3 id="${modalId}-title">${escapeHtml(config.title || 'Are you sure?')}</h3>
      </div>
      <div class="delete-dialog-body">
        <p style="margin: 0; font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5;">
          ${escapeHtml(config.message || '')}
        </p>
      </div>
      <div class="delete-dialog-footer">
        <button type="button" class="btn-cancel-delete" id="${modalId}-keep" autofocus>${escapeHtml(config.keepLabel || 'Keep working')}</button>
        <button type="button" class="btn-confirm-delete" id="${modalId}-confirm">${escapeHtml(config.confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  `;

  appEl.appendChild(overlay);

  const keepBtn = overlay.querySelector(`#${modalId}-keep`);
  const confirmBtn = overlay.querySelector(`#${modalId}-confirm`);

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
    state[stateFlag] = false;
    document.removeEventListener('keydown', handleDialogKeydown, true);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (typeof config.onConfirm === 'function') {
      config.onConfirm();
    }
  }

  function handleDialogKeydown(e) {
    if (!state[stateFlag]) return;
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      (document.activeElement === keepBtn ? confirmBtn : keepBtn).focus();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      (document.activeElement === confirmBtn ? keepBtn : confirmBtn).focus();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        (document.activeElement === confirmBtn ? keepBtn : confirmBtn).focus();
      } else {
        (document.activeElement === keepBtn ? confirmBtn : keepBtn).focus();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (document.activeElement === confirmBtn) {
        handleConfirm();
      } else {
        closeDialog();
      }
      return;
    }
  }

  keepBtn.addEventListener('click', closeDialog);
  confirmBtn.addEventListener('click', handleConfirm);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  document.addEventListener('keydown', handleDialogKeydown, true);
  keepBtn.focus();
}
