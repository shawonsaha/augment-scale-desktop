/**
 * Screen: Operator Profiles
 * Supervisor-only add/edit/remove and PIN changes. All mutations go through
 * the C# bridge; the supervisor PIN is exchanged for a short-lived token.
 */
import {
  state,
  OPERATORS,
  refreshOperators,
  unlockProfileAdmin,
  createProfile,
  updateProfile,
  setProfilePin,
  deactivateProfile,
} from '../state.js';
import { showScreen, updateActiveOperatorPill, updateAppNav } from '../router.js';
import { showToast } from '../toast.js';
import { openReasonDialog } from '../reason-dialog.js';
import { escapeHtml } from '../utils.js';
import {
  PIN_LENGTH,
  checkLockStatus,
  recordFailedAttempt,
  clearOperatorLock,
  formatCountdown,
} from '../pin-auth.js';

let adminSession = null;
let editingProfileId = null;
let pinProfileId = null;
let isUnlocking = false;

function isSupervisor(profile) {
  return String(profile?.role || '').toLowerCase() === 'supervisor';
}

function hasValidSession() {
  if (!adminSession) return false;
  if (Date.now() < adminSession.expiresAt - 5000) return true;
  adminSession = null;
  return false;
}

function setError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function digitsOnly(input) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
  });
}

function rowHtml(op) {
  const isSelf = op.id === state.activeOperator?.id;
  const pinClass = op.pinSet ? 'truck-status--active' : 'truck-status--archived';

  return `
    <tr class="truck-row" data-profile-id="${escapeHtml(op.id)}">
      <td class="profiles-col-person">
        <div class="profiles-person">
          <span class="profiles-avatar" style="background-color: ${escapeHtml(op.color)}">
            <img src="${escapeHtml(op.avatar)}" alt="" />
          </span>
          <span class="profiles-person-name">${escapeHtml(op.name)}</span>
        </div>
      </td>
      <td class="profiles-col-code"><span class="truck-plate-tag">${escapeHtml(op.code)}</span></td>
      <td class="profiles-col-role">${escapeHtml(op.role)}</td>
      <td class="profiles-col-shift">${escapeHtml(op.shift)}</td>
      <td class="profiles-col-pin">
        <span class="truck-status ${pinClass}">${op.pinSet ? 'Set' : 'Not set'}</span>
      </td>
      <td class="profiles-col-actions">
        <button type="button" class="truck-row-btn" data-action="edit">Edit</button>
        <button type="button" class="truck-row-btn" data-action="pin">Change PIN</button>
        <button
          type="button"
          class="truck-row-btn truck-row-btn--delete"
          data-action="remove"
          ${isSelf ? 'disabled title="You cannot remove your own profile"' : ''}
        >Remove</button>
      </td>
    </tr>
  `;
}

export function renderProfiles() {
  const tbody = document.getElementById('profiles-tbody');
  if (!tbody) return;

  tbody.innerHTML = OPERATORS.length
    ? OPERATORS.map(rowHtml).join('')
    : '<tr class="trucks-empty-row"><td colspan="6">No operator profiles configured</td></tr>';

  const badge = document.getElementById('profiles-count-badge');
  if (badge) badge.textContent = `${OPERATORS.length} active`;

  const summary = document.getElementById('profiles-summary');
  if (summary) summary.textContent = `${OPERATORS.length} operator profiles`;
}

function currentSupervisors() {
  return OPERATORS.filter(isSupervisor);
}

function openUnlockModal() {
  if (!currentSupervisors().length) {
    showToast('No supervisor profile is available to authorize this change', 'error');
    return;
  }

  const modal = document.getElementById('profile-admin-unlock-modal');
  const select = document.getElementById('profile-admin-supervisor');
  const pin = document.getElementById('profile-admin-pin');
  if (!modal || !select || !pin) return;

  select.innerHTML = currentSupervisors()
    .map((op) => `<option value="${escapeHtml(op.id)}">${escapeHtml(op.name)}</option>`)
    .join('');
  pin.value = '';
  setError('profile-admin-error', '');
  state._profileAdminUnlockOpen = true;
  modal.classList.add('open');
  requestAnimationFrame(() => pin.focus());
}

function closeUnlockModal() {
  const modal = document.getElementById('profile-admin-unlock-modal');
  if (modal) modal.classList.remove('open');
  state._profileAdminUnlockOpen = false;
}

export function openProfileManager() {
  if (hasValidSession()) {
    showScreen('profiles-screen');
    renderProfiles();
    return;
  }
  openUnlockModal();
}

function openProfileForm(profile = null) {
  const modal = document.getElementById('profile-form-modal');
  if (!modal) return;

  editingProfileId = profile?.id || null;
  state._profileFormOpen = true;

  document.getElementById('profile-form-title').textContent = profile ? 'Edit Profile' : 'New Profile';
  document.getElementById('profile-form-sub').textContent = profile
    ? 'Changes apply to future tickets; historical records keep their stored names'
    : 'Operator details used on tickets and audit records';
  document.getElementById('profile-form-save').textContent = profile ? 'Save Changes' : 'Save Profile';

  document.getElementById('profile-form-name').value = profile?.name || '';
  document.getElementById('profile-form-first-name').value = profile?.firstName || '';
  document.getElementById('profile-form-code').value = profile?.code || '';
  document.getElementById('profile-form-role').value = profile?.role || 'Operator';
  document.getElementById('profile-form-shift').value = profile?.shift || 'Shift A';
  document.getElementById('profile-form-avatar').value = profile?.avatar || 'avatars/frame-9.svg';
  document.getElementById('profile-form-color').value = profile?.color || '#4C7875';

  const pinField = document.getElementById('profile-form-pin-field');
  const confirmField = document.getElementById('profile-form-pin-confirm-field');
  pinField.hidden = Boolean(profile);
  confirmField.hidden = Boolean(profile);
  document.getElementById('profile-form-pin').value = '';
  document.getElementById('profile-form-pin-confirm').value = '';

  updateAvatarPreview();
  setError('profile-form-error', '');
  modal.classList.add('open');
  requestAnimationFrame(() => document.getElementById('profile-form-name')?.focus());
}

function closeProfileForm() {
  const modal = document.getElementById('profile-form-modal');
  if (modal) modal.classList.remove('open');
  state._profileFormOpen = false;
  editingProfileId = null;
  setError('profile-form-error', '');
}

function updateAvatarPreview() {
  const avatar = document.getElementById('profile-form-avatar')?.value || '';
  const preview = document.getElementById('profile-form-avatar-preview');
  if (preview) preview.src = avatar;
}

function openPinModal(profile) {
  const modal = document.getElementById('profile-pin-modal');
  if (!modal || !profile) return;

  pinProfileId = profile.id;
  state._profilePinOpen = true;
  document.getElementById('profile-pin-sub').textContent =
    `Set a new 4-digit PIN for ${profile.name}`;
  document.getElementById('profile-pin-new').value = '';
  document.getElementById('profile-pin-confirm').value = '';
  setError('profile-pin-error', '');
  modal.classList.add('open');
  requestAnimationFrame(() => document.getElementById('profile-pin-new').focus());
}

function closePinModal() {
  const modal = document.getElementById('profile-pin-modal');
  if (modal) modal.classList.remove('open');
  state._profilePinOpen = false;
  pinProfileId = null;
  setError('profile-pin-error', '');
}

async function submitUnlock(event) {
  event.preventDefault();
  if (isUnlocking) return;

  const operatorId = document.getElementById('profile-admin-supervisor').value;
  const pin = document.getElementById('profile-admin-pin').value;
  if (pin.length !== PIN_LENGTH) {
    setError('profile-admin-error', 'Enter the 4-digit supervisor PIN.');
    return;
  }

  const lock = checkLockStatus(operatorId);
  if (lock.isLocked) {
    setError(
      'profile-admin-error',
      `Too many attempts. Try again in ${formatCountdown(lock.remainingSeconds)}.`
    );
    return;
  }

  isUnlocking = true;
  const submit = document.getElementById('profile-admin-unlock-submit');
  submit.disabled = true;
  setError('profile-admin-error', '');

  try {
    const result = await unlockProfileAdmin(operatorId, pin);
    adminSession = {
      token: result.token,
      actorId: result.actor?.id || operatorId,
      expiresAt: Date.parse(result.expiresAt) || Date.now() + 15 * 60 * 1000,
    };
    clearOperatorLock(operatorId);
    closeUnlockModal();
    showScreen('profiles-screen');
    renderProfiles();
  } catch (err) {
    const message = err?.message || '';
    if (/incorrect/i.test(message)) {
      const result = recordFailedAttempt(operatorId);
      if (result.isLocked) {
        setError(
          'profile-admin-error',
          `Too many attempts. Try again in ${formatCountdown(Math.ceil((result.lockUntil - Date.now()) / 1000))}.`
        );
      } else {
        const word = result.attemptsLeft === 1 ? 'attempt' : 'attempts';
        setError('profile-admin-error', `Wrong PIN. ${result.attemptsLeft} ${word} left.`);
      }
      document.getElementById('profile-admin-pin').value = '';
      document.getElementById('profile-admin-pin').focus();
    } else {
      setError('profile-admin-error', message || 'Could not verify the supervisor PIN.');
    }
  } finally {
    isUnlocking = false;
    submit.disabled = false;
  }
}

async function submitProfileForm(event) {
  event.preventDefault();

  const name = document.getElementById('profile-form-name').value.trim();
  const firstName = document.getElementById('profile-form-first-name').value.trim();
  const code = document.getElementById('profile-form-code').value.trim().toUpperCase();
  const role = document.getElementById('profile-form-role').value;
  const shift = document.getElementById('profile-form-shift').value;
  const avatar = document.getElementById('profile-form-avatar').value;
  const color = document.getElementById('profile-form-color').value;
  const pin = document.getElementById('profile-form-pin').value;
  const pinConfirm = document.getElementById('profile-form-pin-confirm').value;

  if (!name) return setError('profile-form-error', 'Enter a display name.');
  if (!/^[A-Z0-9]{1,4}$/.test(code)) {
    return setError('profile-form-error', 'Code must be 1-4 letters or digits.');
  }
  if (!editingProfileId) {
    if (pin.length !== PIN_LENGTH) {
      return setError('profile-form-error', 'PIN must be exactly 4 digits.');
    }
    if (pin !== pinConfirm) {
      return setError('profile-form-error', 'PINs do not match.');
    }
  }
  if (!hasValidSession()) {
    closeProfileForm();
    openUnlockModal();
    return;
  }

  const submit = document.getElementById('profile-form-save');
  submit.disabled = true;
  setError('profile-form-error', '');

  const payload = {
    token: adminSession.token,
    displayName: name,
    firstName,
    code,
    role,
    shift,
    avatar,
    color,
  };

  try {
    if (editingProfileId) {
      await updateProfile({ ...payload, id: editingProfileId });
    } else {
      await createProfile({ ...payload, pin });
    }
    const wasEditing = Boolean(editingProfileId);
    closeProfileForm();
    await refreshOperators();
    renderProfiles();
    updateActiveOperatorPill();
    updateAppNav();
    showToast(wasEditing ? 'Profile updated' : 'Profile added', 'success');
  } catch (err) {
    setError('profile-form-error', err?.message || 'Could not save this profile.');
  } finally {
    submit.disabled = false;
  }
}

async function submitPinForm(event) {
  event.preventDefault();

  const pin = document.getElementById('profile-pin-new').value;
  const confirm = document.getElementById('profile-pin-confirm').value;
  if (pin.length !== PIN_LENGTH) {
    return setError('profile-pin-error', 'PIN must be exactly 4 digits.');
  }
  if (pin !== confirm) {
    return setError('profile-pin-error', 'PINs do not match.');
  }
  if (!pinProfileId || !hasValidSession()) {
    closePinModal();
    openUnlockModal();
    return;
  }

  const submit = document.getElementById('profile-pin-save');
  submit.disabled = true;
  setError('profile-pin-error', '');

  try {
    await setProfilePin({
      token: adminSession.token,
      profileId: pinProfileId,
      pin,
    });
    clearOperatorLock(pinProfileId);
    closePinModal();
    await refreshOperators();
    renderProfiles();
    showToast('PIN updated', 'success');
  } catch (err) {
    setError('profile-pin-error', err?.message || 'Could not update the PIN.');
  } finally {
    submit.disabled = false;
  }
}

function removeProfile(profile) {
  if (!profile || profile.id === state.activeOperator?.id) {
    showToast('You cannot remove your own profile', 'warning');
    return;
  }
  if (!hasValidSession()) {
    openUnlockModal();
    return;
  }

  openReasonDialog({
    id: 'remove-profile-modal',
    title: `Remove ${profile.name}?`,
    metaHtml:
      'The profile disappears from sign-in. Past tickets keep their stored operator name.<br>' +
      'The PIN is removed and a new one is required if the profile is re-added.',
    prompt: 'Why is this profile being removed?',
    reasons: ['Left the company', 'Duplicate profile', 'Test profile', 'Other'],
    confirmLabel: 'Remove profile',
    confirmTone: 'danger',
    stateFlag: '_profileRemoveDialogOpen',
    onConfirm: async (reason) => {
      if (!hasValidSession()) {
        openUnlockModal();
        return;
      }
      try {
        await deactivateProfile({
          token: adminSession.token,
          profileId: profile.id,
          reason,
        });
        await refreshOperators();
        renderProfiles();
        updateActiveOperatorPill();
        updateAppNav();
        showToast(`${profile.name} removed`, 'success');
      } catch (err) {
        showToast(err?.message || 'Could not remove this profile', 'error');
      }
    },
  });
}

function leaveProfiles() {
  adminSession = null;
  showScreen(state.activeOperator ? 'dashboard-screen' : 'login-screen');
}

export function initProfilesScreen() {
  const tbody = document.getElementById('profiles-tbody');
  if (!tbody) return;

  document.getElementById('profiles-new-btn')?.addEventListener('click', () => {
    if (hasValidSession()) openProfileForm();
    else openUnlockModal();
  });
  document.getElementById('profiles-back')?.addEventListener('click', leaveProfiles);

  document.getElementById('profile-form-close')?.addEventListener('click', closeProfileForm);
  document.getElementById('profile-form-cancel')?.addEventListener('click', closeProfileForm);
  document.getElementById('profile-form')?.addEventListener('submit', submitProfileForm);
  document.getElementById('profile-form-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'profile-form-modal') closeProfileForm();
  });
  document.getElementById('profile-form-avatar')?.addEventListener('change', updateAvatarPreview);

  document.getElementById('profile-pin-close')?.addEventListener('click', closePinModal);
  document.getElementById('profile-pin-cancel')?.addEventListener('click', closePinModal);
  document.getElementById('profile-pin-form')?.addEventListener('submit', submitPinForm);
  document.getElementById('profile-pin-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'profile-pin-modal') closePinModal();
  });

  document.getElementById('profile-admin-unlock-form')?.addEventListener('submit', submitUnlock);
  document.getElementById('profile-admin-unlock-close')?.addEventListener('click', closeUnlockModal);
  document.getElementById('profile-admin-unlock-cancel')?.addEventListener('click', closeUnlockModal);
  document.getElementById('profile-admin-unlock-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'profile-admin-unlock-modal') closeUnlockModal();
  });

  ['profile-admin-pin', 'profile-form-pin', 'profile-form-pin-confirm', 'profile-pin-new', 'profile-pin-confirm']
    .forEach((id) => {
      const input = document.getElementById(id);
      if (input) digitsOnly(input);
    });

  tbody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-profile-id]');
    if (!row) return;
    const profile = OPERATORS.find((op) => op.id === row.dataset.profileId);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!profile) return;

    if (action === 'edit') openProfileForm(profile);
    else if (action === 'pin') openPinModal(profile);
    else if (action === 'remove') removeProfile(profile);
  });

  document.addEventListener('profiles:manage', openProfileManager);
  document.addEventListener('operators:refresh', () => {
    if (state.currentScreen === 'profiles-screen') renderProfiles();
  });
  document.addEventListener('screenchange', (event) => {
    if (event.detail?.screenId === 'profiles-screen') {
      renderProfiles();
      return;
    }
    adminSession = null;
    closeUnlockModal();
    closeProfileForm();
    closePinModal();
  });

  document.addEventListener(
    'keydown',
    (event) => {
      const unlockOpen = document.getElementById('profile-admin-unlock-modal')?.classList.contains('open');
      const formOpen = document.getElementById('profile-form-modal')?.classList.contains('open');
      const pinOpen = document.getElementById('profile-pin-modal')?.classList.contains('open');

      if (event.key === 'Escape') {
        if (formOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeProfileForm();
          return;
        }
        if (pinOpen) {
          event.preventDefault();
          event.stopPropagation();
          closePinModal();
          return;
        }
        if (unlockOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeUnlockModal();
          return;
        }
      }

      if (formOpen || pinOpen || unlockOpen) return;
      if (state._profileRemoveDialogOpen) return;
      if (document.querySelector('.modal-overlay.open')) return;
      if (state.currentScreen !== 'profiles-screen') return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        leaveProfiles();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        event.stopPropagation();
        if (hasValidSession()) openProfileForm();
        else openUnlockModal();
      }
    },
    true
  );
}
