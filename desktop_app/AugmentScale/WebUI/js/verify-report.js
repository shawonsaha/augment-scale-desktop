/**
 * Verify a printed history report against the append-only snapshot recorded
 * by the C# workstation when the report was generated.
 */
import { IS_PRODUCTION, sendCommand } from './runtime.js';

let bound = false;
let busy = false;
let lastFocusedElement = null;

function clearResult() {
  const result = document.getElementById('verify-report-result');
  if (!result) return;
  result.hidden = true;
  result.classList.remove('verify-report-result--ok', 'verify-report-result--fail');
  const title = document.getElementById('verify-report-result-title');
  const message = document.getElementById('verify-report-result-message');
  const computed = document.getElementById('verify-report-computed');
  const stored = document.getElementById('verify-report-stored');
  if (title) title.textContent = '';
  if (message) message.textContent = '';
  if (computed) computed.textContent = '';
  if (stored) stored.textContent = '';
}

function showError(message) {
  const error = document.getElementById('verify-report-error');
  if (error) error.textContent = message;
}

function renderResult(result) {
  const panel = document.getElementById('verify-report-result');
  const title = document.getElementById('verify-report-result-title');
  const message = document.getElementById('verify-report-result-message');
  const computed = document.getElementById('verify-report-computed');
  const stored = document.getElementById('verify-report-stored');
  if (!panel || !title || !message) return;

  const matched = Boolean(result?.matched);
  panel.hidden = false;
  panel.classList.toggle('verify-report-result--ok', matched);
  panel.classList.toggle('verify-report-result--fail', !matched);
  title.textContent = matched ? 'Integrity verified' : 'Verification failed';
  message.textContent = result?.message || 'The workstation did not return a verification result.';
  if (computed) computed.textContent = result?.computedHash || '—';
  if (stored) stored.textContent = result?.storedHash || '—';
}

function setBusy(value) {
  busy = value;
  const button = document.getElementById('verify-report-submit');
  if (!button) return;
  if (value) {
    button.dataset.label = button.textContent.trim();
    button.textContent = 'Verifying…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || 'Verify integrity';
    button.disabled = false;
  }
}

export function openVerifyReportModal(prefill = {}) {
  const modal = document.getElementById('verify-report-modal');
  if (!modal) return;

  lastFocusedElement = document.activeElement;
  const idInput = document.getElementById('verify-report-id');
  const hashInput = document.getElementById('verify-report-hash');
  if (idInput) idInput.value = prefill.reportId || '';
  if (hashInput) hashInput.value = prefill.integrityHash || '';
  showError('');
  clearResult();

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    const target = idInput?.value ? hashInput : idInput;
    target?.focus();
    target?.select?.();
  });
}

export function closeVerifyReportModal() {
  const modal = document.getElementById('verify-report-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  setBusy(false);
  showError('');
  clearResult();
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  lastFocusedElement = null;
}

async function verifyReport() {
  if (busy) return;
  const idInput = document.getElementById('verify-report-id');
  const hashInput = document.getElementById('verify-report-hash');
  const reportId = String(idInput?.value || '').trim().toUpperCase();
  const integrityHash = String(hashInput?.value || '').trim();

  if (!reportId) {
    showError('Enter the report ID printed on the report.');
    idInput?.focus();
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(integrityHash)) {
    showError('Enter the full 64-character SHA-256 hash.');
    hashInput?.focus();
    return;
  }
  if (!IS_PRODUCTION) {
    showError('Report verification requires the Augment Scale desktop app.');
    return;
  }

  showError('');
  clearResult();
  setBusy(true);
  try {
    const result = await sendCommand('verifyHistoryReport', { reportId, integrityHash });
    renderResult(result);
  } catch (error) {
    showError(error?.message || 'The report could not be verified.');
  } finally {
    setBusy(false);
  }
}

export function initVerifyReport() {
  if (bound) return;
  const modal = document.getElementById('verify-report-modal');
  if (!modal) return;
  bound = true;

  document.getElementById('verify-report-close')?.addEventListener('click', closeVerifyReportModal);
  document.getElementById('verify-report-cancel')?.addEventListener('click', closeVerifyReportModal);
  document.getElementById('verify-report-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    verifyReport();
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeVerifyReportModal();
  });

  for (const id of ['verify-report-id', 'verify-report-hash']) {
    document.getElementById(id)?.addEventListener('input', () => {
      showError('');
      clearResult();
    });
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (!modal.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeVerifyReportModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll(
        'button:not([disabled]):not([hidden]), input:not([disabled]), [href]'
      )].filter((element) => !element.closest('[hidden]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true
  );
}
