// @ts-check
/**
 * Central application state and data constants.
 * Single source of truth across all module screens.
 * State is initialized clean and loaded authoritatively from the C# host via the desktop bridge.
 *
 * @typedef {import('./types.js').ProfileDto} ProfileDto
 * @typedef {import('./types.js').VehicleDto} VehicleDto
 * @typedef {import('./types.js').TicketDto} TicketDto
 * @typedef {import('./types.js').BootStateDto} BootStateDto
 * @typedef {import('./types.js').CreateTicketRequest} CreateTicketRequest
 * @typedef {import('./types.js').CompleteTicketRequest} CompleteTicketRequest
 * @typedef {import('./types.js').ProfileWriteRequest} ProfileWriteRequest
 * @typedef {import('./types.js').SetProfilePinRequest} SetProfilePinRequest
 * @typedef {import('./types.js').DeactivateProfileRequest} DeactivateProfileRequest
 */

import { formatDateTime12H } from './utils.js';
import { sendCommand } from './runtime.js';

/** @type {ProfileDto[]} */
export const OPERATORS = [];

/** @type {VehicleDto[]} */
export let REGISTERED_TRUCKS = [];

/** @type {TicketDto[]} */
export let completedTickets = [];

/** @type {TicketDto[]} */
export let voidedTickets = [];

/** @type {TicketDto[]} */
export let deletedTickets = [];

/** @type {TicketDto[]} */
export let pendingTickets = [];

/** @param {TicketDto[]} tickets */
export function setCompletedTickets(tickets) {
  completedTickets = tickets || [];
}

/** @param {TicketDto[]} tickets */
export function setVoidedTickets(tickets) {
  voidedTickets = tickets || [];
}

/** @param {TicketDto[]} tickets */
export function setDeletedTickets(tickets) {
  deletedTickets = tickets || [];
}

/** @param {TicketDto[]} tickets */
export function setPendingTickets(tickets) {
  pendingTickets = tickets || [];
}

/** @param {ProfileDto[]} operators */
export function setOperators(operators) {
  OPERATORS.splice(0, OPERATORS.length, ...(operators || []));
}

/** @param {VehicleDto[]} trucks */
export function setRegisteredTrucks(trucks) {
  REGISTERED_TRUCKS = (trucks || []).map((truck) => ({
    ...truck,
    status: truck.status || 'active',
    tripCount: truck.tripCount || 0,
    lastTare: truck.lastTare ?? null,
    lastWeighed: truck.lastWeighed ?? null,
    archivedAt: truck.archivedAt ?? null,
    archivedBy: truck.archivedBy ?? null,
    archivedReason: truck.archivedReason ?? null,
  }));
}

function notifyVehicleRefresh() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('vehicle:refresh'));
  }
}

/**
 * Registers or updates a truck record in the database.
 * @param {Partial<VehicleDto>} truckData
 * @param {string} [operatorName]
 * @returns {Promise<VehicleDto | null>}
 */
export async function registerTruck(truckData, operatorName = 'MD. RAJU') {
  const plate = (truckData.plate || '').trim().toUpperCase();
  if (!plate) return null;

  const incoming = {
    driver: (truckData.driver || '').trim(),
    phone: (truckData.phone || '').trim(),
    client: (truckData.client || '').trim(),
    material: (truckData.material || '').trim(),
  };

  const record = await sendCommand('registerVehicle', {
    plate,
    ...incoming,
    operatorId: state.activeOperator?.id || '',
    operatorName: operatorName || state.activeOperator?.name || 'Unknown',
  });

  const index = REGISTERED_TRUCKS.findIndex(
    (t) => (t.plate || '').trim().toUpperCase() === plate
  );
  if (index >= 0) REGISTERED_TRUCKS[index] = record;
  else REGISTERED_TRUCKS.unshift(record);

  notifyVehicleRefresh();
  return record;
}

/**
 * Active (non-archived) vehicles used by the list, autocomplete and dialogs.
 * @returns {VehicleDto[]}
 */
export function getActiveTrucks() {
  return REGISTERED_TRUCKS.filter((t) => t.status !== 'archived');
}

/**
 * Archives a vehicle via the C# bridge.
 * @param {string} plate
 * @param {string} reason
 * @param {string} [operatorName]
 * @returns {Promise<{ok: boolean, truck?: VehicleDto, reason?: string}>}
 */
export async function archiveTruck(plate, reason, operatorName) {
  const target = (plate || '').trim().toUpperCase();
  const truck = REGISTERED_TRUCKS.find((t) => (t.plate || '').toUpperCase() === target);
  if (!truck) return { ok: false, reason: 'Vehicle not found' };

  try {
    const record = await sendCommand('archiveVehicle', {
      plate: target,
      reason,
      operatorId: state.activeOperator?.id || '',
      operatorName: operatorName || state.activeOperator?.name || 'Unknown',
    });
    const index = REGISTERED_TRUCKS.findIndex(
      (t) => (t.plate || '').toUpperCase() === target
    );
    if (index >= 0) REGISTERED_TRUCKS[index] = record;
    notifyVehicleRefresh();
    return { ok: true, truck: record };
  } catch (error) {
    return { ok: false, reason: /** @type {Error} */ (error).message };
  }
}

/**
 * Restores an archived vehicle via the C# bridge.
 * @param {string} plate
 * @param {string} [operatorName]
 * @returns {Promise<VehicleDto | null>}
 */
export async function restoreTruck(plate, operatorName) {
  const target = (plate || '').trim().toUpperCase();
  const truck = REGISTERED_TRUCKS.find((t) => (t.plate || '').toUpperCase() === target);
  if (!truck) return null;

  const record = await sendCommand('restoreVehicle', {
    plate: target,
    reason: '',
    operatorId: state.activeOperator?.id || '',
    operatorName: operatorName || state.activeOperator?.name || 'Unknown',
  });
  const index = REGISTERED_TRUCKS.findIndex((t) => (t.plate || '').toUpperCase() === target);
  if (index >= 0) REGISTERED_TRUCKS[index] = record;
  notifyVehicleRefresh();
  return record;
}

/**
 * Permanently removes an archived vehicle via the C# bridge.
 * @param {string} plate
 * @param {string} reason
 * @param {string} [operatorName]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function deleteVehicle(plate, reason, operatorName) {
  const target = (plate || '').trim().toUpperCase();
  const truck = REGISTERED_TRUCKS.find((t) => (t.plate || '').toUpperCase() === target);
  if (!truck) return { ok: false, reason: 'Vehicle not found' };
  if (truck.status !== 'archived') {
    return { ok: false, reason: 'Only archived vehicles can be permanently deleted.' };
  }
  if (!reason?.trim()) return { ok: false, reason: 'A deletion reason is required.' };

  try {
    await sendCommand('deleteVehicle', {
      plate: target,
      reason,
      operatorId: state.activeOperator?.id || '',
      operatorName: operatorName || state.activeOperator?.name || 'Unknown',
    });
    const index = REGISTERED_TRUCKS.findIndex(
      (t) => (t.plate || '').toUpperCase() === target
    );
    if (index >= 0) REGISTERED_TRUCKS.splice(index, 1);
    notifyVehicleRefresh();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: /** @type {Error} */ (error).message };
  }
}

/**
 * Refreshes the vehicle cache from the database.
 * @param {boolean} [includeArchived]
 * @returns {Promise<VehicleDto[]>}
 */
export async function refreshVehiclesFromDatabase(includeArchived = false) {
  const vehicles = await sendCommand('getVehicles', { includeArchived });
  setRegisteredTrucks(vehicles || []);
  notifyVehicleRefresh();
  return REGISTERED_TRUCKS;
}

let nextTicketId = 11353;

/**
 * Sets the next ticket ID watermark.
 * @param {number|string} id
 */
export function setNextTicketId(id) {
  const value = Number(id);
  nextTicketId = Number.isFinite(value) ? Math.max(11353, value) : 11353;
}

/**
 * Loads all durable state from C# in one round-trip before any screen is initialised.
 * @param {{ resetHistory?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function loadProductionData({ resetHistory = true } = {}) {
  const boot = await sendCommand('getBootState');

  setOperators(boot.operators || []);
  setRegisteredTrucks(boot.vehicles || []);
  setPendingTickets(boot.pending || []);
  setNextTicketId(boot.nextTicketNumber);

  if (resetHistory) {
    const all = boot.history || [];
    setCompletedTickets(all.filter((ticket) => ticket.status === 'completed'));
    setVoidedTickets(all.filter((ticket) => ticket.status === 'voided'));
    setDeletedTickets(all.filter((ticket) => ticket.status === 'deleted'));
  }

  state.sync.isHealthy = boot.sync?.isHealthy !== false;
  state.sync.pendingQueue = boot.sync?.pendingQueue || 0;
  state.sync.lastSyncTimestamp = boot.sync?.lastSyncTimestamp
    ? new Date(boot.sync.lastSyncTimestamp)
    : new Date();

  document.dispatchEvent(new CustomEvent('data:refresh'));
  document.dispatchEvent(new CustomEvent('vehicle:refresh'));
  document.dispatchEvent(new CustomEvent('operators:refresh'));
}

/**
 * Verifies the PIN in C# (DPAPI-backed hash) when running in the desktop app.
 * @param {string} operatorId
 * @param {string} pin
 * @returns {Promise<ProfileDto | null>}
 */
export async function authenticateOperator(operatorId, pin) {
  return sendCommand('authenticatePin', { operatorId, pin });
}

/**
 * Reloads the operator list and keeps the signed-in profile in sync.
 * @returns {Promise<ProfileDto[]>}
 */
export async function refreshOperators() {
  const operators = await sendCommand('getOperators');
  setOperators(operators || []);
  if (state.activeOperator) {
    const current = OPERATORS.find((op) => op.id === state.activeOperator?.id);
    if (current) state.activeOperator = current;
  }
  document.dispatchEvent(new CustomEvent('operators:refresh'));
  return OPERATORS;
}

/**
 * @param {string} operatorId
 * @param {string} pin
 * @returns {Promise<{ token: string, expiresAt: string, actor: ProfileDto }>}
 */
export function unlockProfileAdmin(operatorId, pin) {
  return sendCommand('unlockProfileAdmin', { operatorId, pin });
}

/**
 * @param {ProfileWriteRequest} payload
 * @returns {Promise<ProfileDto>}
 */
export function createProfile(payload) {
  return sendCommand('createProfile', payload);
}

/**
 * @param {ProfileWriteRequest} payload
 * @returns {Promise<ProfileDto>}
 */
export function updateProfile(payload) {
  return sendCommand('updateProfile', payload);
}

/**
 * @param {SetProfilePinRequest} payload
 * @returns {Promise<boolean>}
 */
export function setProfilePin(payload) {
  return sendCommand('setProfilePin', payload);
}

/**
 * @param {DeactivateProfileRequest} payload
 * @returns {Promise<boolean>}
 */
export function deactivateProfile(payload) {
  return sendCommand('deactivateProfile', payload);
}

export async function captureReading() {
  try {
    await sendCommand('captureReading');
  } catch {}
}

/**
 * Persists a first weigh and returns the durable ticket.
 * @param {Partial<CreateTicketRequest> & { truckNo: string, weightKg: number }} ticketData
 * @returns {Promise<TicketDto>}
 */
export async function commitFirstWeigh(ticketData) {
  const saved = await sendCommand('createTicket', {
    ...ticketData,
    operatorId: state.activeOperator?.id || '',
    operatorName: state.activeOperator?.name || 'Unknown Operator',
    recordFirstPrint: true,
  });
  setNextTicketId(saved.id + 1);
  try {
    await refreshVehiclesFromDatabase();
  } catch {}
  return saved;
}

/**
 * Persists the second weigh and returns the completed certificate record.
 * @param {Partial<CompleteTicketRequest> & { ticketId: number, weightKg: number }} ticketData
 * @returns {Promise<TicketDto>}
 */
export async function commitSecondWeigh(ticketData) {
  const completed = await sendCommand('completeTicket', {
    ...ticketData,
    operatorId: state.activeOperator?.id || '',
    operatorName: state.activeOperator?.name || 'Unknown Operator',
    recordCertificatePrint: true,
  });
  try {
    await refreshVehiclesFromDatabase();
  } catch {}
  return completed;
}

/**
 * @param {number} ticketId
 * @param {string} reason
 * @param {string} [operatorName]
 * @returns {Promise<TicketDto | null>}
 */
export async function deleteTicket(ticketId, reason, operatorName) {
  const idx = pendingTickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;

  const updated = await sendCommand('deleteTicket', {
    ticketId,
    reason,
    operatorId: state.activeOperator?.id || '',
    operatorName: operatorName || state.activeOperator?.name || 'Unknown',
  });
  pendingTickets.splice(idx, 1);
  deletedTickets.unshift(updated);
  return updated;
}

/**
 * Weigh stage is derived from the data, not stored: "first" means the ticket
 * only ever had one weight (pending or deleted while waiting), "complete" means
 * a second weight exists (completed or voided).
 * @param {TicketDto | null | undefined} ticket
 * @returns {'first' | 'complete'}
 */
export function getTicketStage(ticket) {
  if (!ticket) return 'first';
  if (ticket.secondWeight !== undefined && ticket.secondWeight !== null) return 'complete';
  if (ticket.netWeight !== undefined && ticket.netWeight !== null) return 'complete';
  return 'first';
}

/**
 * Normalises status across the four ticket collections.
 * @param {TicketDto | null | undefined} ticket
 * @returns {'pending' | 'voided' | 'deleted' | 'completed'}
 */
export function getTicketStatus(ticket) {
  if (!ticket) return 'pending';
  if (ticket.status === 'voided') return 'voided';
  if (ticket.status === 'deleted' || ticket.deleted) return 'deleted';
  if (ticket.status === 'completed') return 'completed';
  return 'pending';
}

const SCALE_TIMESTAMP_RE =
  /^(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i;

/**
 * Millisecond timestamp for sorting/filtering, tolerant of both stored formats.
 * @param {TicketDto | null | undefined} ticket
 * @returns {number}
 */
export function getTicketTimestamp(ticket) {
  if (!ticket) return 0;
  const iso = ticket.completedAt || ticket.voidedAt || ticket.deletedAt || ticket.createdAt;
  if (iso) {
    const parsed = new Date(iso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  const match = SCALE_TIMESTAMP_RE.exec(ticket.firstWeightTime || '');
  if (match) {
    const [, day, month, yearRaw, hourRaw, minute, second = '0', ampm] = match;
    let year = parseInt(yearRaw, 10);
    if (year < 100) year += 2000;
    let hour = parseInt(hourRaw, 10) % 12;
    if (ampm.toUpperCase() === 'PM') hour += 12;
    return new Date(
      year,
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hour,
      parseInt(minute, 10),
      parseInt(second, 10)
    ).getTime();
  }
  return 0;
}

/**
 * The full ledger used by History: pending, completed, voided and deleted
 * tickets sorted newest first. Returns live references so reprint/void mutate
 * the underlying record.
 * @returns {TicketDto[]}
 */
export function getAllTickets() {
  /** @type {TicketDto[]} */
  const all = [];
  /**
   * @param {TicketDto[]} tickets
   * @param {string} source
   */
  const push = (tickets, source) => {
    for (const ticket of tickets) {
      ticket._source = source;
      all.push(ticket);
    }
  };
  push(pendingTickets, 'pending');
  push(completedTickets, 'completed');
  push(voidedTickets, 'voided');
  push(deletedTickets, 'deleted');
  return all.sort((a, b) => getTicketTimestamp(b) - getTicketTimestamp(a));
}

/**
 * Moves a completed ticket to the voided ledger with its audit metadata.
 * @param {number} ticketId
 * @param {string} reason
 * @param {string} [operatorName]
 * @returns {Promise<TicketDto>}
 */
export async function voidTicket(ticketId, reason, operatorName) {
  const updated = await sendCommand('voidTicket', {
    ticketId,
    reason,
    operatorId: state.activeOperator?.id || '',
    operatorName: operatorName || state.activeOperator?.name || 'Unknown',
  });
  const idx = completedTickets.findIndex((t) => t.id === ticketId);
  if (idx !== -1) completedTickets.splice(idx, 1);
  if (!voidedTickets.some((t) => t.id === updated.id)) voidedTickets.unshift(updated);
  try {
    await refreshVehiclesFromDatabase();
  } catch {}
  return updated;
}

/**
 * Records a reprint on a ticket (completed, voided or pending first-weigh slip).
 * @param {TicketDto} ticket
 * @param {string} reason
 * @param {string} [operatorName]
 * @returns {Promise<number>} the new copy number
 */
export async function recordReprint(ticket, reason, operatorName) {
  if (!ticket) return 0;

  const result = await sendCommand('recordReprint', {
    ticketId: ticket.id,
    reason,
    operatorId: state.activeOperator?.id || '',
    operatorName: operatorName || state.activeOperator?.name || 'Unknown',
  });
  Object.assign(ticket, result.ticket);
  return result.copyNumber;
}

function computeNextTicketId() {
  const maxExisting = pendingTickets.reduce((max, t) => Math.max(max, t.id || 0), 11352);
  return Math.max(nextTicketId, maxExisting + 1);
}

/**
 * Returns the ID the next committed ticket would receive, WITHOUT consuming it.
 * Safe to call for display purposes any number of times.
 * @returns {number}
 */
export function peekNextTicketId() {
  return computeNextTicketId();
}

/**
 * Consumes a reserved ticket ID once its ticket is actually committed.
 * @param {number} [id]
 * @returns {number}
 */
export function consumeTicketId(id) {
  const resolved = Number.isFinite(id) ? /** @type {number} */ (id) : computeNextTicketId();
  nextTicketId = Math.max(computeNextTicketId(), resolved + 1);
  return resolved;
}

export const state = {
  currentScreen: 'login-screen',
  /** @type {ProfileDto | null} */
  selectedOperator: null,
  /** @type {ProfileDto | null} */
  activeOperator: null,
  /** @type {number | null} */
  currentLiveWeight: null,
  isScaleStable: false,
  isScaleConnected: false,

  // First Weigh State
  firstWeigh: {
    /** @type {number | null} */
    capturedWeight: null,
    /** @type {string | null} */
    capturedTime: null,
    /** @type {number | null} */
    capturedTimestamp: null,
    /** @type {string | null} */
    direction: null,
    _blockedByOpenTicket: false,
    /** @type {number | null} */
    _blockedTicketId: null,
  },

  // Second Weigh State
  secondWeigh: {
    /** @type {TicketDto | null} */
    selectedTicket: null,
    /** @type {number | null} */
    capturedWeight: null,
    /** @type {string | null} */
    capturedTime: null,
    /** @type {number | null} */
    capturedTimestamp: null,
    /** @type {number | null} */
    calculatedNet: null,
    isOverridden: false,
    /** @type {string | null} */
    overrideReason: null,
    /** @type {string | null} */
    overrideTimestamp: null,
    /** @type {string | null} */
    overrideOperator: null,
    /** @type {any} */
    overrideAnomalyDetails: null,
  },

  // Cloud Synchronization State
  sync: {
    isHealthy: true,
    lastSyncTimestamp: new Date(),
    pendingQueue: 0,
    syncInProgress: false,
    /** @type {any} */
    archive: null,
  },

  // Filtered tickets cache for keyboard navigation
  /** @type {TicketDto[]} */
  currentFilteredTickets: [],
  focusedTicketIndex: -1,
  pendingTicketsSort: { key: 'waiting', dir: 'desc' },
  _deleteDialogOpen: false,
  _overrideDialogOpen: false,

  // History screen state
  history: {
    currentPage: 0,
    pageSize: 20,
    dateFilter: 'today', // 'today' | 'yesterday' | '7days' | '30days' | 'custom'
    /** @type {string | null} */
    customDateFrom: null,
    /** @type {string | null} */
    customDateTo: null,
    searchQuery: '',
    /** @type {Record<string, string[]>} */
    filters: {
      statuses: [],
      drivers: [],
      operators: [],
      materials: [],
      clients: [],
      directions: [],
      flags: [],
    },
    sortKey: 'when',
    sortDir: 'desc',
    /** @type {number | null} */
    selectedTicketId: null,
    focusedRowIndex: 0,
  },

  // Vehicles screen state
  trucks: {
    currentPage: 0,
    pageSize: 20,
    searchQuery: '',
    showArchived: false,
    focusedRowIndex: 0,
    /** @type {VehicleDto | null} */
    editingTruck: null,
    sortKey: 'lastWeighed',
    sortDir: 'desc',
  },

  // Dialog flags (block global hotkeys while open)
  _reprintDialogOpen: false,
  _voidDialogOpen: false,
  _archiveDialogOpen: false,
  _truckFormOpen: false,
  _deleteVehicleDialogOpen: false,
  _historyReportOpen: false,
};
