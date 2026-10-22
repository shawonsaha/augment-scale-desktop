/**
 * Central application state and data constants.
 * Single source of truth across all module screens.
 */

import { formatDateTime12H } from './utils.js';
import { buildSeedHistory } from './seed-data.js';
import { IS_PRODUCTION, sendCommand } from './runtime.js';

export const OPERATORS = [
  {
    id: 'mr',
    code: 'MR',
    name: 'MD. RAJU',
    firstName: 'Raju',
    role: 'Supervisor',
    shift: 'Shift A',
    avatar: 'avatars/frame-9.svg',
    color: '#4C7875',
    pin: '1234',
  },
  {
    id: 'ak',
    code: 'AK',
    name: 'AKHTER K.',
    firstName: 'Akhter',
    role: 'Senior Operator',
    shift: 'Shift A',
    avatar: 'avatars/frame-4.svg',
    color: '#FB9550',
    pin: '1234',
  },
  {
    id: 'sh',
    code: 'SH',
    name: 'SHAFIQ H.',
    firstName: 'Shafiq',
    role: 'Operator',
    shift: 'Shift B',
    avatar: 'avatars/frame-3.svg',
    color: '#475569',
    pin: '1234',
  },
  {
    id: 'rh',
    code: 'RH',
    name: 'RAHIM A.',
    firstName: 'Rahim',
    role: 'Operator',
    shift: 'Shift C',
    avatar: 'avatars/frame-1.svg',
    color: '#F2C2B6',
    pin: '1234',
  },
  {
    id: 'kh',
    code: 'KH',
    name: 'KAMAL H.',
    firstName: 'Kamal',
    role: 'Relief Operator',
    shift: 'Shift B',
    avatar: 'avatars/frame-5.svg',
    color: '#526E7E',
    pin: '1234',
  },
];

export let REGISTERED_TRUCKS = IS_PRODUCTION ? [] : [
  {
    plate: 'DM-T-11-2045',
    driver: 'Kalam Hossain',
    phone: '+880 1711 002233',
    material: 'Scrap Iron',
    client: 'BSRM Steels Ltd',
  },
  {
    plate: 'CTG-4512',
    driver: 'Anwar Ali',
    phone: '+880 1819 445566',
    material: 'MS Plate',
    client: 'Abul Khair Steel',
  },
  {
    plate: 'DM-K-33-1078',
    driver: 'Sumon Mia',
    phone: '+880 1912 778899',
    material: 'Pipe',
    client: 'Apex Cement Mills',
  },
  {
    plate: 'DHAKA-METRO-TA-14-9921',
    driver: 'Rafiqul Islam',
    phone: '+880 1670 112233',
    material: 'Machinery',
    client: 'GPH Ispat',
  },
  {
    plate: 'CTG-TA-12-8844',
    driver: 'Jasmin Uddin',
    phone: '+880 1552 998877',
    material: 'Copper / Cable',
    client: 'Crown Cement',
  },
];

// Operational fields used by the Trucks screen. Kept on every record so the
// first-weigh register and the master-data form share one shape.
REGISTERED_TRUCKS.forEach((truck) => {
  truck.status = truck.status || 'active';
  truck.tripCount = truck.tripCount || 0;
  truck.lastTare = truck.lastTare ?? null;
  truck.lastWeighed = truck.lastWeighed ?? null;
  truck.archivedAt = truck.archivedAt ?? null;
  truck.archivedBy = truck.archivedBy ?? null;
  truck.archivedReason = truck.archivedReason ?? null;
});

// ─── History: completed / voided / deleted (30 days of demo data) ──────────
const seedHistory = IS_PRODUCTION
  ? { completed: [], voided: [], deleted: [] }
  : buildSeedHistory({
      trucks: REGISTERED_TRUCKS,
      operators: OPERATORS,
    });

export let completedTickets = seedHistory.completed;
export let voidedTickets = seedHistory.voided;

export function setCompletedTickets(tickets) {
  completedTickets = tickets;
}

export function setVoidedTickets(tickets) {
  voidedTickets = tickets;
}

// Roll the seeded history up into each truck's master record.
for (const truck of REGISTERED_TRUCKS) {
  const plate = (truck.plate || '').toUpperCase();
  const rows = completedTickets.filter((t) => (t.truckNo || '').toUpperCase() === plate);
  truck.tripCount += rows.length;
  if (rows.length > 0) {
    const latest = rows.reduce((a, b) =>
      new Date(a.completedAt).getTime() >= new Date(b.completedAt).getTime() ? a : b
    );
    truck.lastWeighed = latest.completedAt;
    truck.lastTare = latest.tareWeight;
  }
}

export const actionLog = [];

/**
 * Appends an audit entry. Write-only in the prototype; maps to audit_events.
 */
export function logAction(action, entityType, entityId, details = {}) {
  actionLog.push({
    action,
    entityType,
    entityId,
    operatorId: state.activeOperator?.id || 'unknown',
    operatorName: state.activeOperator?.name || 'Unknown',
    timestamp: new Date().toISOString(),
    details,
  });
}

/**
 * Registers or updates a truck record in memory.
 */
export async function registerTruck(truckData, operatorName = 'MD. RAJU') {
  const plate = (truckData.plate || '').trim().toUpperCase();
  if (!plate) return null;
  const existingIndex = REGISTERED_TRUCKS.findIndex(
    (t) => (t.plate || '').trim().toUpperCase() === plate
  );

  const incoming = {
    driver: (truckData.driver || '').trim(),
    phone: (truckData.phone || '').trim(),
    client: (truckData.client || '').trim(),
    material: (truckData.material || '').trim(),
  };

  if (IS_PRODUCTION) {
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

  if (existingIndex >= 0) {
    const old = REGISTERED_TRUCKS[existingIndex];
    const record = {
      ...old,
      plate,
      driver: incoming.driver || old.driver,
      phone: incoming.phone || old.phone,
      client: incoming.client || old.client,
      material: incoming.material || old.material || 'Other',
      registeredBy: operatorName,
      registeredAt: new Date().toISOString(),
    };
    REGISTERED_TRUCKS[existingIndex] = record;
    logAction('edit_vehicle', 'vehicle', plate, { before: { ...old }, after: { ...record } });
    notifyVehicleRefresh();
    return record;
  }

  const record = {
    plate,
    ...incoming,
    material: incoming.material || 'Other',
    status: 'active',
    tripCount: 0,
    lastTare: null,
    lastWeighed: null,
    archivedAt: null,
    archivedBy: null,
    archivedReason: null,
    registeredBy: operatorName,
    registeredAt: new Date().toISOString(),
  };
  REGISTERED_TRUCKS.unshift(record);
  logAction('add_vehicle', 'vehicle', plate, { plate });
  notifyVehicleRefresh();
  return record;
}

/** Active (non-archived) vehicles used by the list, autocomplete and dialogs. */
export function getActiveTrucks() {
  return REGISTERED_TRUCKS.filter((t) => t.status !== 'archived');
}

/**
 * Archives a vehicle unless it still has an open pending ticket.
 * @returns {{ok: boolean, truck?: Object, reason?: string}}
 */
export async function archiveTruck(plate, reason, operatorName) {
  const target = (plate || '').trim().toUpperCase();
  const truck = REGISTERED_TRUCKS.find((t) => (t.plate || '').toUpperCase() === target);
  if (!truck) return { ok: false, reason: 'Vehicle not found' };

  if (IS_PRODUCTION) {
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
      return { ok: false, reason: error.message };
    }
  }

  const openTicket = pendingTickets.find((t) => (t.truckNo || '').toUpperCase() === target);
  if (openTicket) {
    return {
      ok: false,
      reason: `Vehicle has open ticket #${openTicket.id}. Complete or delete it first.`,
    };
  }

  truck.status = 'archived';
  truck.archivedAt = new Date().toISOString();
  truck.archivedBy = operatorName || 'Unknown';
  truck.archivedReason = reason || '';
  logAction('archive_vehicle', 'vehicle', target, { reason });
  notifyVehicleRefresh();
  return { ok: true, truck };
}

export async function restoreTruck(plate, operatorName) {
  const target = (plate || '').trim().toUpperCase();
  const truck = REGISTERED_TRUCKS.find((t) => (t.plate || '').toUpperCase() === target);
  if (!truck) return null;

  if (IS_PRODUCTION) {
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

  truck.status = 'active';
  truck.archivedAt = null;
  truck.archivedBy = null;
  truck.archivedReason = null;
  logAction('restore_vehicle', 'vehicle', target, {});
  notifyVehicleRefresh();
  return truck;
}

export let pendingTickets = IS_PRODUCTION ? [] : [
  {
    id: 11352,
    truckNo: 'DM-T-11-2045',
    driver: 'Kalam Hossain',
    phone: '+880 1711 002233',
    material: 'Scrap Iron',
    client: 'BSRM Steels Ltd',
    weightType: 'OUT WEIGHT',
    firstWeight: 12800,
    firstWeightType: 'Tare',
    firstWeightTime: '13-10-26 09:14:00 AM',
    firstOperator: 'MD. RAJU',
    timeElapsed: '24 mins',
    lastTare: 12780,
    lastGross: 18150,
    lastPayload: 5370,
    lastWeighAt: '12 Oct',
  },
  {
    id: 11351,
    truckNo: 'CTG-4512',
    driver: 'Anwar Ali',
    phone: '+880 1819 445566',
    material: 'Steel Coil',
    client: 'Abul Khair Steel',
    weightType: 'IN WEIGHT',
    firstWeight: 38450,
    firstWeightType: 'Gross',
    firstWeightTime: '13-10-26 08:30:00 AM',
    firstOperator: 'MD. RAJU',
    timeElapsed: '1.2 hrs',
    lastTare: 14700,
    lastGross: 38400,
    lastPayload: 23700,
    lastWeighAt: '12 Oct',
  },
  {
    id: 11350,
    truckNo: 'DM-K-33-1078',
    driver: 'Sumon Mia',
    phone: '+880 1912 778899',
    material: 'Raw Coal',
    client: 'Apex Cement Mills',
    weightType: 'OUT WEIGHT',
    firstWeight: 15100,
    firstWeightType: 'Tare',
    firstWeightTime: '13-10-26 07:15:00 AM',
    firstOperator: 'AKHTER K.',
    timeElapsed: '2.5 hrs',
    lastTare: 15240,
    lastGross: 20980,
    lastPayload: 5740,
    lastWeighAt: '11 Oct',
  },
];

// Keep the three demo pending tickets anchored to "now" so the dashboard
// waiting times and the History "Today" filter stay coherent.
const PENDING_AGE_MINUTES = [24, 72, 150];
pendingTickets.forEach((ticket, index) => {
  const createdAt = new Date(Date.now() - (PENDING_AGE_MINUTES[index] ?? 60) * 60 * 1000);
  ticket.createdAt = createdAt.toISOString();
  ticket.firstWeightTime = formatDateTime12H(createdAt);
  ticket.printCount = 1;
  ticket.printLog = [
    {
      by: ticket.firstOperator || 'Unknown',
      at: createdAt.toISOString(),
      type: 'first_weigh_slip',
      reason: null,
    },
  ];
});

export function setPendingTickets(tickets) {
  pendingTickets = tickets;
}

export let deletedTickets = seedHistory.deleted;

export function setDeletedTickets(tickets) {
  deletedTickets = tickets;
}

export function setOperators(operators) {
  OPERATORS.splice(0, OPERATORS.length, ...(operators || []));
}

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

export async function refreshVehiclesFromDatabase() {
  if (!IS_PRODUCTION) {
    notifyVehicleRefresh();
    return REGISTERED_TRUCKS;
  }

  const vehicles = await sendCommand('getVehicles');
  setRegisteredTrucks(vehicles || []);
  notifyVehicleRefresh();
  return REGISTERED_TRUCKS;
}

export function setNextTicketId(id) {
  const value = Number(id);
  nextTicketId = Number.isFinite(value) ? Math.max(11353, value) : 11353;
}

/** Loads all durable state from C# before any screen is initialised. */
export async function loadProductionData() {
  if (!IS_PRODUCTION) return;

  const [operators, vehicles, pending, history, nextId, sync] = await Promise.all([
    sendCommand('getOperators'),
    sendCommand('getVehicles'),
    sendCommand('getPendingTickets'),
    sendCommand('getHistory'),
    sendCommand('getNextTicketNumber'),
    sendCommand('getSyncStatus'),
  ]);

  setOperators(operators || []);
  setRegisteredTrucks(vehicles || []);
  setPendingTickets(pending || []);

  const all = history || [];
  setCompletedTickets(all.filter((ticket) => ticket.status === 'completed'));
  setVoidedTickets(all.filter((ticket) => ticket.status === 'voided'));
  setDeletedTickets(all.filter((ticket) => ticket.status === 'deleted'));
  setNextTicketId(nextId);

  state.sync.isHealthy = sync?.isHealthy !== false;
  state.sync.pendingQueue = sync?.pendingQueue || 0;
  state.sync.lastSyncTimestamp = sync?.lastSyncTimestamp
    ? new Date(sync.lastSyncTimestamp)
    : new Date();
}

/** Verifies the PIN in C# (DPAPI-backed hash) when running in the desktop app. */
export async function authenticateOperator(operatorId, pin) {
  return sendCommand('authenticatePin', { operatorId, pin });
}

/** Persists a first weigh and returns the durable ticket. */
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

/** Persists the second weigh and returns the completed certificate record. */
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

export async function deleteTicket(ticketId, reason, operatorName) {
  const idx = pendingTickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;

  if (IS_PRODUCTION) {
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

  const ticket = pendingTickets[idx];
  ticket.deleted = true;
  ticket.deletedAt = new Date().toISOString();
  ticket.deletedBy = operatorName || 'Unknown Operator';
  ticket.deletedReason = reason;
  deletedTickets.push(ticket);
  pendingTickets.splice(idx, 1);
  logAction('delete_pending', 'ticket', ticketId, { reason });
  return ticket;
}

/**
 * Weigh stage is derived from the data, not stored: "first" means the ticket
 * only ever had one weight (pending or deleted while waiting), "complete" means
 * a second weight exists (completed or voided).
 */
export function getTicketStage(ticket) {
  if (!ticket) return 'first';
  if (ticket.secondWeight !== undefined && ticket.secondWeight !== null) return 'complete';
  if (ticket.netWeight !== undefined && ticket.netWeight !== null) return 'complete';
  return 'first';
}

/** Normalises status across the four ticket collections. */
export function getTicketStatus(ticket) {
  if (!ticket) return 'pending';
  if (ticket.status === 'voided') return 'voided';
  if (ticket.status === 'deleted' || ticket.deleted) return 'deleted';
  if (ticket.status === 'completed') return 'completed';
  return 'pending';
}

const SCALE_TIMESTAMP_RE =
  /^(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i;

/** Millisecond timestamp for sorting/filtering, tolerant of both stored formats. */
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
 */
export function getAllTickets() {
  const all = [];
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

/** Moves a completed ticket to the voided ledger with its audit metadata. */
export async function voidTicket(ticketId, reason, operatorName) {
  const idx = completedTickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;

  if (IS_PRODUCTION) {
    const updated = await sendCommand('voidTicket', {
      ticketId,
      reason,
      operatorId: state.activeOperator?.id || '',
      operatorName: operatorName || state.activeOperator?.name || 'Unknown',
    });
    completedTickets.splice(idx, 1);
    voidedTickets.unshift(updated);
    try {
      await refreshVehiclesFromDatabase();
    } catch {}
    return updated;
  }

  const ticket = completedTickets[idx];
  ticket.status = 'voided';
  ticket.voidedAt = new Date().toISOString();
  ticket.voidedBy = operatorName || 'Unknown';
  ticket.voidedReason = reason || '';
  voidedTickets.unshift(ticket);
  completedTickets.splice(idx, 1);
  logAction('void', 'ticket', ticketId, { reason });
  notifyVehicleRefresh();
  return ticket;
}

/**
 * Records a reprint on a ticket (completed, voided or pending first-weigh slip).
 * @returns {number} the new copy number
 */
export async function recordReprint(ticket, reason, operatorName) {
  if (!ticket) return 0;

  if (IS_PRODUCTION) {
    const result = await sendCommand('recordReprint', {
      ticketId: ticket.id,
      reason,
      operatorId: state.activeOperator?.id || '',
      operatorName: operatorName || state.activeOperator?.name || 'Unknown',
    });
    Object.assign(ticket, result.ticket);
    return result.copyNumber;
  }

  if (!Array.isArray(ticket.printLog)) ticket.printLog = [];
  const previous = ticket.printCount || 1;
  const copyNumber = previous + 1;
  ticket.printLog.push({
    by: operatorName || 'Unknown',
    at: new Date().toISOString(),
    type: 'reprint',
    reason: reason || '',
    copyNumber,
  });
  ticket.printCount = copyNumber;
  logAction('reprint', 'ticket', ticket.id, { reason, copyNumber });
  return copyNumber;
}

let nextTicketId = 11353;

function computeNextTicketId() {
  const maxExisting = pendingTickets.reduce((max, t) => Math.max(max, t.id || 0), 11352);
  return Math.max(nextTicketId, maxExisting + 1);
}

/**
 * Returns the ID the next committed ticket would receive, WITHOUT consuming it.
 * Safe to call for display purposes any number of times.
 */
export function peekNextTicketId() {
  return computeNextTicketId();
}

/**
 * Consumes a reserved ticket ID once its ticket is actually committed, advancing
 * the counter so the next peek returns a fresh, unique ID. Call exactly once per
 * committed ticket, using the same ID that was peeked for display/preview.
 */
export function consumeTicketId(id) {
  const resolved = Number.isFinite(id) ? id : computeNextTicketId();
  nextTicketId = Math.max(computeNextTicketId(), resolved + 1);
  return resolved;
}

export const state = {
  currentScreen: 'login-screen',
  selectedOperator: null,
  activeOperator: null,
  currentLiveWeight: null,
  isScaleStable: false,
  isScaleConnected: false,

  // First Weigh State
  firstWeigh: {
    capturedWeight: null,
    capturedTime: null,
    capturedTimestamp: null,
    direction: null,
    _blockedByOpenTicket: false,
    _blockedTicketId: null,
  },

  // Second Weigh State
  secondWeigh: {
    selectedTicket: null,
    capturedWeight: null,
    capturedTime: null,
    capturedTimestamp: null,
    calculatedNet: null,
    isOverridden: false,
    overrideReason: null,
    overrideTimestamp: null,
    overrideOperator: null,
    overrideAnomalyDetails: null,
  },

  // Cloud Synchronization State
  sync: {
    isHealthy: true,
    lastSyncTimestamp: new Date(),
    pendingQueue: 0,
    syncInProgress: false,
  },

  // Filtered tickets cache for keyboard navigation
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
    customDateFrom: null,
    customDateTo: null,
    statusFilter: 'all', // 'all' | 'pending' | 'completed' | 'voided' | 'deleted'
    stageFilter: 'all', // 'all' | 'first' | 'complete'
    searchQuery: '',
    moreFilters: { operators: [], materials: [], clients: [] },
    selectedTicketId: null,
    focusedRowIndex: 0,
  },

  // Trucks screen state
  trucks: {
    currentPage: 0,
    pageSize: 20,
    searchQuery: '',
    showArchived: false,
    focusedRowIndex: 0,
    editingTruck: null,
  },

  // Dialog flags (block global hotkeys while open)
  _reprintDialogOpen: false,
  _voidDialogOpen: false,
  _archiveDialogOpen: false,
  _truckFormOpen: false,
};
