/**
 * Screen 1: Explicit Two-Step Operator Selection & Segmented PIN OTP Sign-In
 * - selectOperator: Choose profile via click or 1-5 shortcuts
 * - enterPin: Highlight profile, auto-focus segmented OTP boxes, auto-submit on 4th digit
 * - Handles lockout after 5 attempts, live countdown surviving reload, accessibility.
 */
import { state, OPERATORS } from '../state.js';
import { showScreen } from '../router.js';
import hapticAudio from '../audio.js';
import { showToast } from '../toast.js';
import {
  PIN_LENGTH,
  LOCK_DURATION_SECONDS,
  getOperatorFirstName,
  verifyPin,
  checkLockStatus,
  recordFailedAttempt,
  clearOperatorLock,
  formatCountdown,
} from '../pin-auth.js';
import { IS_PRODUCTION } from '../runtime.js';
import { authenticateOperator } from '../state.js';

export function initLoginScreen() {
  const grid = document.getElementById('avatar-grid');
  const loginScreen = document.getElementById('login-screen');
  const loginTitle = document.getElementById('login-title');
  const loginSubtitle = document.getElementById('login-subtitle');
  const stepBadge = document.getElementById('login-step-badge');
  const stepLabel = document.getElementById('step-label');
  const pinDrawer = document.getElementById('pin-drawer');
  const pinFieldWrapper = document.getElementById('pin-field-wrapper');
  const pinInput = document.getElementById('pin-input');
  const pinBoxes = document.getElementById('pin-boxes');
  const pinStatus = document.getElementById('pin-status');
  const pinError = document.getElementById('pin-error');
  const signInBtn = document.getElementById('btn-sign-in');
  const backBtn = document.getElementById('btn-back-to-operators');
  const footerHint = document.getElementById('login-footer-hint');
  const lockBtn = document.getElementById('btn-lock-workstation');

  if (!grid || !loginScreen || !pinInput || !pinBoxes) return;

  // Header lock button is hidden on login screen (no active session to lock)
  if (lockBtn) {
    lockBtn.style.display = 'none';
  }

  const boxElements = pinBoxes.querySelectorAll('.pin-box');

  let isVerifying = false;
  let isSuccess = false;
  let isLocked = false;
  let countdownTimer = null;

  function clearActiveCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function setStatus(text) {
    if (pinStatus) pinStatus.textContent = text;
  }

  function setError(text) {
    if (pinError) pinError.textContent = text;
  }

  function updateBoxes() {
    const val = pinInput.value;
    const isFocused = document.activeElement === pinInput;

    boxElements.forEach((box, idx) => {
      box.className = 'pin-box';
      if (idx < val.length) {
        box.classList.add('is-filled');
      } else if (idx === val.length && isFocused && !isVerifying && !isLocked) {
        box.classList.add('is-active');
      }
    });
  }

  function updateSignInBtn() {
    if (!signInBtn) return;
    const isComplete = pinInput.value.length === PIN_LENGTH;
    signInBtn.disabled = !isComplete || isVerifying || isLocked;
  }

  function applyLock(operatorId, initialSeconds) {
    isLocked = true;
    isVerifying = false;
    pinInput.disabled = true;
    pinInput.value = '';
    updateBoxes();
    updateSignInBtn();
    pinBoxes.classList.remove('verifying', 'error', 'shake', 'success');
    pinBoxes.classList.add('locked');
    setStatus('');

    clearActiveCountdown();

    const seconds = Math.max(1, Math.round(initialSeconds));
    setError(`Too many attempts. Try again in ${formatCountdown(seconds)}.`);

    countdownTimer = setInterval(() => {
      const status = checkLockStatus(operatorId);
      if (!status.isLocked) {
        clearActiveCountdown();
        isLocked = false;
        pinInput.disabled = false;
        pinBoxes.classList.remove('locked');
        setError('');
        updateBoxes();
        pinInput.focus();
        updateSignInBtn();
        return;
      }
      setError(`Too many attempts. Try again in ${formatCountdown(status.remainingSeconds)}.`);
    }, 1000);
  }

  // Render Operator Avatars with SVG Artwork & Hotkey Badges
  grid.innerHTML = '';
  OPERATORS.forEach((op, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'avatar-card';
    card.dataset.operatorId = op.id;
    card.setAttribute('aria-label', `Select operator ${op.name} (Key ${index + 1})`);

    card.innerHTML = `
      <div class="avatar-box" style="background-color: ${op.color}; position: relative;">
        <span class="avatar-hotkey-badge">${index + 1}</span>
        <img src="${op.avatar}" alt="${op.name}" class="avatar-img">
      </div>
      <div class="avatar-name">${op.name}</div>
      <div class="avatar-role">${op.role} • ${op.shift}</div>
    `;

    card.addEventListener('click', () => {
      if (state.selectedOperator?.id === op.id) {
        if (!isLocked) pinInput.focus();
        return;
      }
      selectOperator(op, card);
    });

    grid.appendChild(card);
  });

  // "Add New" operator tile
  const addNewCard = document.createElement('button');
  addNewCard.type = 'button';
  addNewCard.className = 'avatar-card avatar-card-add-new';
  addNewCard.setAttribute('aria-label', 'Add New Operator');
  addNewCard.innerHTML = `
    <div class="avatar-box avatar-box-add-new">
      <svg class="avatar-plus-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </div>
    <div class="avatar-name">Add New</div>
    <div class="avatar-role">Operator</div>
  `;
  addNewCard.addEventListener('click', () => {
    if (hapticAudio) hapticAudio.playClick();
    showToast('Adding new operators requires Supervisor authorization', 'info');
  });
  grid.appendChild(addNewCard);

  // Step 1: selectOperator -> Step 2: enterPin
  function selectOperator(op, cardElement) {
    if (hapticAudio) hapticAudio.playClick();
    state.selectedOperator = op;

    clearActiveCountdown();

    // Transition styles: selected card highlighted, others dimmed to 40%
    loginScreen.classList.add('has-selection');

    const allCards = grid.querySelectorAll('.avatar-card');
    allCards.forEach((c) => {
      if (c === cardElement) {
        c.classList.add('selected');
        c.classList.remove('unselected');
      } else {
        c.classList.add('unselected');
        c.classList.remove('selected');
      }
    });

    // Update Header & Step Indicator
    if (stepBadge) {
      const pill = stepBadge.querySelector('.step-indicator-pill');
      if (pill) pill.textContent = 'Step 2 of 2';
    }
    if (stepLabel) stepLabel.textContent = 'Enter PIN';

    const firstName = getOperatorFirstName(op);
    if (loginTitle) loginTitle.textContent = `Hi, ${firstName}`;
    if (loginSubtitle) {
      loginSubtitle.textContent = `Enter your ${PIN_LENGTH}-digit PIN`;
      loginSubtitle.style.display = '';
    }

    // Update Footer Hint
    if (footerHint) {
      footerHint.innerHTML =
        'Type your PIN, it signs in automatically. <kbd class="kbd-key">Esc</kbd> to switch operator.';
    }

    // Show PIN Drawer
    if (pinDrawer) {
      pinDrawer.style.display = 'flex';
      // Trigger CSS transition
      requestAnimationFrame(() => pinDrawer.classList.add('visible'));
    }

    // Clear PIN and any existing error when switching/selecting operator
    pinInput.value = '';
    isVerifying = false;
    isSuccess = false;
    pinInput.readOnly = false;
    setStatus('');
    setError('');
    pinBoxes.className = 'pin-boxes';
    updateBoxes();
    updateSignInBtn();

    // Check if this operator is locked out
    const lockStatus = checkLockStatus(op.id);
    if (lockStatus.isLocked) {
      applyLock(op.id, lockStatus.remainingSeconds);
    } else {
      isLocked = false;
      pinInput.disabled = false;
      pinBoxes.classList.remove('locked');
      setTimeout(() => {
        pinInput.focus();
        updateBoxes();
      }, 50);
    }
  }

  // Return from enterPin to selectOperator
  function deselectOperator() {
    if (hapticAudio) hapticAudio.playClick();
    clearActiveCountdown();

    state.selectedOperator = null;
    loginScreen.classList.remove('has-selection');

    // Reset card highlight/dimming
    const allCards = grid.querySelectorAll('.avatar-card');
    allCards.forEach((c) => {
      c.classList.remove('selected', 'unselected');
    });

    // Reset Header & Step Indicator
    if (stepBadge) {
      const pill = stepBadge.querySelector('.step-indicator-pill');
      if (pill) pill.textContent = 'Step 1 of 2';
    }
    if (stepLabel) stepLabel.textContent = 'Select Operator';

    if (loginTitle) loginTitle.textContent = "Who's weighing?";
    if (loginSubtitle) {
      loginSubtitle.textContent = 'Press 1–5 or click your profile';
      loginSubtitle.style.display = '';
    }

    // Reset Footer Hint
    if (footerHint) {
      footerHint.innerHTML =
        'Press <kbd class="kbd-key">1</kbd>–<kbd class="kbd-key">5</kbd> or click your profile';
    }

    // Hide PIN Drawer
    if (pinDrawer) {
      pinDrawer.classList.remove('visible');
      pinDrawer.style.display = 'none';
    }

    // Clear PIN memory and states
    pinInput.value = '';
    isVerifying = false;
    isSuccess = false;
    isLocked = false;
    pinInput.readOnly = false;
    pinInput.disabled = false;
    setStatus('');
    setError('');
    pinBoxes.className = 'pin-boxes';
    updateBoxes();
    updateSignInBtn();
  }

  // PIN submission and single-flight verification
  async function submitPin(pin) {
    if (isVerifying || isSuccess || isLocked) return;
    if (!state.selectedOperator) return;
    if (pin.length !== PIN_LENGTH) return;

    isVerifying = true;
    pinInput.readOnly = true;
    updateSignInBtn();
    setStatus('Verifying');
    setError('');
    pinBoxes.classList.remove('error', 'shake');
    pinBoxes.classList.add('verifying');

    const op = state.selectedOperator;
    let verified = null;

    if (IS_PRODUCTION) {
      try {
        verified = await authenticateOperator(op.id, pin);
      } catch (err) {
        pinBoxes.classList.remove('verifying');
        setStatus('');
        setError(err?.message || 'Verification failed. Try again.');
        pinInput.value = '';
        pinInput.readOnly = false;
        isVerifying = false;
        updateBoxes();
        updateSignInBtn();
        return;
      }
    } else {
      verified = verifyPin(op, pin) ? op : null;
    }

    if (verified) {
      isSuccess = true;
      handleSuccess({ ...op, ...verified });
    } else {
      handleError(op);
    }
  }

  function handleSuccess(op) {
    pinBoxes.classList.remove('verifying');
    pinBoxes.classList.add('success');
    setStatus('');

    if (hapticAudio) hapticAudio.playSuccess();

    // Clear PIN from memory immediately
    pinInput.value = '';

    // Flash success color for 200ms max, then proceed
    setTimeout(() => {
      pinBoxes.classList.remove('success');
      updateBoxes();
      isVerifying = false;
      isSuccess = false;

      // Reset failed attempts upon successful login
      clearOperatorLock(op.id);

      state.activeOperator = op;
      showToast(`Signed in as ${state.activeOperator.name}`, 'success');
      deselectOperator();
      showScreen('dashboard-screen');
    }, 200);
  }

  function handleError(op) {
    pinBoxes.classList.remove('verifying');
    pinBoxes.classList.add('error', 'shake');
    setStatus('');

    if (hapticAudio) hapticAudio.playError();

    const result = recordFailedAttempt(op.id);

    if (result.isLocked) {
      setTimeout(() => {
        pinBoxes.classList.remove('shake', 'error');
        pinInput.value = '';
        updateBoxes();
        applyLock(op.id, LOCK_DURATION_SECONDS);
      }, 300);
    } else {
      const attemptsWord = result.attemptsLeft === 1 ? 'attempt' : 'attempts';
      setError(`Wrong PIN. ${result.attemptsLeft} ${attemptsWord} left.`);

      // Shake (~300ms), clear PIN after shake, put focus back in input
      setTimeout(() => {
        pinBoxes.classList.remove('shake', 'error');
        pinInput.value = '';
        updateBoxes();
        pinInput.readOnly = false;
        isVerifying = false;
        pinInput.focus();
        updateSignInBtn();
      }, 300);
    }
  }

  // Keyboard navigation & Shortcuts
  document.addEventListener('keydown', (e) => {
    if (state.currentScreen !== 'login-screen') return;

    // Keys 1-5 select operator ONLY in selectOperator state
    if (!state.selectedOperator) {
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= OPERATORS.length) {
          const cards = grid.querySelectorAll('.avatar-card');
          if (cards[num - 1]) {
            selectOperator(OPERATORS[num - 1], cards[num - 1]);
          }
        }
      }
      return;
    }

    // In enterPin state: Esc returns to selectOperator and clears PIN
    if (e.key === 'Escape') {
      e.preventDefault();
      deselectOperator();
    }
  });

  // PIN Input events
  pinInput.addEventListener('keydown', (e) => {
    // If verifying or locked, ignore all keystrokes (not queued)
    if (isVerifying || isLocked) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      deselectOperator();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (pinInput.value.length === PIN_LENGTH && !isVerifying && !isLocked) {
        submitPin(pinInput.value);
      }
      return;
    }

    // Ignore arrow / Home / End / Page keys when Num Lock is off
    const numLockOffKeys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Insert',
      'Clear',
    ];
    if (numLockOffKeys.includes(e.key)) {
      e.preventDefault();
      return;
    }

    // Allow backspace, delete, tab
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab') {
      return;
    }

    // Allow browser modifier combinations (copy, paste, reload)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    // Ignore non-digits
    if (e.key.length === 1 && !/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      return;
    }

    // Prevent entering more than PIN_LENGTH digits
    if (e.key.length === 1 && /^[0-9]$/.test(e.key) && pinInput.value.length >= PIN_LENGTH) {
      e.preventDefault();
    }
  });

  pinInput.addEventListener('input', () => {
    if (isVerifying || isLocked) {
      pinInput.value = '';
      updateBoxes();
      return;
    }

    const clean = pinInput.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    pinInput.value = clean;
    updateBoxes();
    updateSignInBtn();

    // Auto-submits on the last digit without pressing Enter
    if (clean.length === PIN_LENGTH) {
      submitPin(clean);
    }
  });

  pinInput.addEventListener('paste', (e) => {
    if (isVerifying || isLocked) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const clean = pasted.replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!clean) return;

    pinInput.value = clean;
    updateBoxes();
    updateSignInBtn();

    // Pasting a full PIN auto-submits
    if (clean.length === PIN_LENGTH) {
      submitPin(clean);
    }
  });

  pinInput.addEventListener('focus', () => updateBoxes());
  pinInput.addEventListener('blur', () => updateBoxes());

  if (pinFieldWrapper) {
    pinFieldWrapper.addEventListener('click', () => {
      if (!pinInput.disabled) {
        pinInput.focus();
      }
    });
  }

  if (signInBtn) {
    signInBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (pinInput.value.length === PIN_LENGTH && !isVerifying && !isLocked) {
        submitPin(pinInput.value);
      }
    });
  }

  if (pinDrawer) {
    pinDrawer.addEventListener('submit', (e) => {
      e.preventDefault();
      if (pinInput.value.length === PIN_LENGTH && !isVerifying && !isLocked) {
        submitPin(pinInput.value);
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', deselectOperator);
  }
}
