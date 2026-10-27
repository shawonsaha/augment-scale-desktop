/**
 * PIN Authentication & Operator Lockout Logic
 * Client helper module for lockout timers, attempt tracking, and name formatting.
 * Authoritative PIN authentication is performed by the C# workstation host via
 * ConfigService.AuthenticatePin against DPAPI-protected PBKDF2 hashes.
 */

export const PIN_LENGTH = 4;
export const MAX_ATTEMPTS = 5;
export const LOCK_DURATION_SECONDS = 60;
export const LOCK_STORAGE_PREFIX = 'weighbridge_op_lock_';

/**
 * Returns operator's preferred first name for personal greetings (e.g. "Raju", "Akhter").
 */
export function getOperatorFirstName(operator) {
  if (!operator) return '';
  if (operator.firstName) return operator.firstName;
  const parts = operator.name.trim().split(/\s+/);
  if (parts[0].replace(/\./g, '').toUpperCase() === 'MD' && parts.length > 1) {
    return capitalize(parts[1]);
  }
  return capitalize(parts[0]);
}

function capitalize(str) {
  if (!str) return '';
  const clean = str.replace(/[^a-zA-Z]/g, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * Retrieves persisted lockout data for an operator.
 */
export function getOperatorLock(
  operatorId,
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || !operatorId) return { failedAttempts: 0, lockUntil: 0 };
  try {
    const raw = storage.getItem(`${LOCK_STORAGE_PREFIX}${operatorId}`);
    if (!raw) return { failedAttempts: 0, lockUntil: 0 };
    return JSON.parse(raw);
  } catch {
    return { failedAttempts: 0, lockUntil: 0 };
  }
}

/**
 * Persists lockout data for an operator.
 */
export function saveOperatorLock(
  operatorId,
  data,
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || !operatorId) return;
  try {
    storage.setItem(`${LOCK_STORAGE_PREFIX}${operatorId}`, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save operator lock', e);
  }
}

/**
 * Clears lockout data (e.g. on successful sign in or lock expiration).
 */
export function clearOperatorLock(
  operatorId,
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || !operatorId) return;
  try {
    storage.removeItem(`${LOCK_STORAGE_PREFIX}${operatorId}`);
  } catch (e) {
    console.error('Failed to clear operator lock', e);
  }
}

/**
 * Increments failed attempts counter and triggers lockout when MAX_ATTEMPTS is reached.
 */
export function recordFailedAttempt(
  operatorId,
  currentTime = Date.now(),
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const current = getOperatorLock(operatorId, storage);
  const attempts = (current.failedAttempts || 0) + 1;
  const isLocked = attempts >= MAX_ATTEMPTS;
  const lockUntil = isLocked ? currentTime + LOCK_DURATION_SECONDS * 1000 : 0;
  const nextData = { failedAttempts: attempts, lockUntil };
  saveOperatorLock(operatorId, nextData, storage);
  return {
    failedAttempts: attempts,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
    isLocked,
    lockUntil,
  };
}

/**
 * Checks if the operator is currently locked out.
 */
export function checkLockStatus(
  operatorId,
  currentTime = Date.now(),
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const lock = getOperatorLock(operatorId, storage);
  if (lock.lockUntil && lock.lockUntil > currentTime) {
    const remainingSeconds = Math.ceil((lock.lockUntil - currentTime) / 1000);
    return { isLocked: true, remainingSeconds, lockUntil: lock.lockUntil };
  }
  if (lock.lockUntil && lock.lockUntil <= currentTime) {
    clearOperatorLock(operatorId, storage);
  }
  return { isLocked: false, remainingSeconds: 0, lockUntil: 0 };
}

/**
 * Formats countdown seconds into {mm:ss} format.
 */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
