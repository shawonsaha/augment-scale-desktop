import { formatDateTime12H, formatShortDateWithSeconds, calcNet, escapeHtml } from '../js/utils.js';
import {
  peekNextTicketId,
  consumeTicketId,
  OPERATORS,
  deleteTicket,
  pendingTickets,
  deletedTickets,
  completedTickets,
  voidedTickets,
  getAllTickets,
  getTicketStage,
  getTicketStatus,
  getTicketTimestamp,
  voidTicket,
  recordReprint,
  getActiveTrucks,
  archiveTruck,
  restoreTruck,
  registerTruck,
  actionLog,
} from '../js/state.js';
import {
  PIN_LENGTH,
  MAX_ATTEMPTS,
  getOperatorFirstName,
  verifyPin,
  recordFailedAttempt,
  checkLockStatus,
  clearOperatorLock,
  formatCountdown,
} from '../js/pin-auth.js';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Date-time 12H formatter check
const d = new Date(2026, 9, 14, 15, 30, 45);
assert.strictEqual(
  formatDateTime12H(d),
  '14-10-26 03:30:45 PM',
  'Formatter must match 12H scale convention'
);

// 1b. Short date with seconds formatter check
assert.strictEqual(
  formatShortDateWithSeconds('13-10-26 09:14:00 AM'),
  '13 Oct · 09:14:00 AM',
  'String timestamp must retain :00 seconds'
);
assert.strictEqual(
  formatShortDateWithSeconds(new Date(2026, 9, 17, 17, 51, 22)),
  '17 Oct · 05:51:22 PM',
  'Date object must format with seconds'
);

// 2. Net Weight calculation & Anomaly Guard
const normalOutbound = calcNet('Tare', 12800, 28450);
assert.strictEqual(normalOutbound.net, 15650);
assert.strictEqual(normalOutbound.isAnomaly, false);

const anomalyInversion = calcNet('Tare', 15000, 12000);
assert.strictEqual(anomalyInversion.net, -3000);
assert.strictEqual(anomalyInversion.isAnomaly, true);

// 2b. HTML escaping of operator-typed text (truck/driver/material injected into rows)
assert.strictEqual(
  escapeHtml('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;',
  'Angle brackets must be escaped so typed text cannot inject markup'
);
assert.strictEqual(escapeHtml('AB&CD"E\'F'), 'AB&amp;CD&quot;E&#39;F');
assert.strictEqual(escapeHtml(null), '', 'null becomes empty string');
assert.strictEqual(escapeHtml(0), '0', 'zero is kept, not dropped');

// 3. Ticket ID generator: display peeks must NOT consume IDs; commit consumes exactly one
const p1 = peekNextTicketId();
assert.strictEqual(p1, 11353, 'First peek should start at 11353');
assert.strictEqual(peekNextTicketId(), 11353, 'Repeated peeks must not burn a ticket ID');
assert.strictEqual(consumeTicketId(p1), 11353, 'Consume hands back the reserved ID');
assert.strictEqual(peekNextTicketId(), 11354, 'Counter advances only after a commit');
const c2 = consumeTicketId(peekNextTicketId());
assert.strictEqual(c2, 11354, 'Second committed ticket takes the next ID');
assert.strictEqual(peekNextTicketId(), 11355, 'Next peek reflects the second commit');
assert.notStrictEqual(c2, p1, 'Committed ticket IDs must never repeat');

// 3b. Counter jumps past any manually reserved ID (delete/sync safety)
consumeTicketId(20000);
assert.strictEqual(
  peekNextTicketId(),
  20001,
  'Counter must advance past a manually reserved high ID'
);

// 4. Operator first names extraction check ("Hi, {firstName}")
const expectedFirstNames = ['Raju', 'Akhter', 'Shafiq', 'Rahim', 'Kamal'];
OPERATORS.forEach((op, idx) => {
  assert.strictEqual(
    getOperatorFirstName(op),
    expectedFirstNames[idx],
    `First name for ${op.name} must be ${expectedFirstNames[idx]}`
  );
});

// 5. PIN Verification logic
assert.strictEqual(PIN_LENGTH, 4, 'PIN length must be 4');
const testOp = OPERATORS[0];
assert.strictEqual(verifyPin(testOp, '1234'), true, 'Valid 4-digit PIN must verify true');
assert.strictEqual(verifyPin(testOp, '0000'), false, 'Wrong PIN must verify false');
assert.strictEqual(verifyPin(testOp, '123'), false, 'Short PIN must verify false');
assert.strictEqual(verifyPin(testOp, '12345'), false, 'Long PIN must verify false');
assert.strictEqual(verifyPin(testOp, ''), false, 'Empty PIN must verify false');

// 6. Lockout tracking, persistence & 5-attempt threshold
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

const mockStorage = createMockStorage();
const baseTime = 1000000;

// Attempts 1 to 4 should decrement attempts left without locking
for (let i = 1; i <= 4; i++) {
  const res = recordFailedAttempt(testOp.id, baseTime, mockStorage);
  assert.strictEqual(res.failedAttempts, i);
  assert.strictEqual(res.attemptsLeft, MAX_ATTEMPTS - i);
  assert.strictEqual(res.isLocked, false);
}

// 5th attempt must lock operator for 60 seconds
const res5 = recordFailedAttempt(testOp.id, baseTime, mockStorage);
assert.strictEqual(res5.failedAttempts, 5);
assert.strictEqual(res5.attemptsLeft, 0);
assert.strictEqual(res5.isLocked, true);
assert.strictEqual(res5.lockUntil, baseTime + 60000);

// Lock survives simulated reload (retrieved from storage)
const lockCheck1 = checkLockStatus(testOp.id, baseTime + 15000, mockStorage);
assert.strictEqual(lockCheck1.isLocked, true);
assert.strictEqual(lockCheck1.remainingSeconds, 45);

// Countdown formatting check
assert.strictEqual(formatCountdown(60), '01:00');
assert.strictEqual(formatCountdown(45), '00:45');
assert.strictEqual(formatCountdown(5), '00:05');
assert.strictEqual(formatCountdown(0), '00:00');

// Lock expiry after 60s
const lockCheck2 = checkLockStatus(testOp.id, baseTime + 60001, mockStorage);
assert.strictEqual(lockCheck2.isLocked, false);

// Clearing lock on success
recordFailedAttempt(testOp.id, baseTime, mockStorage);
clearOperatorLock(testOp.id, mockStorage);
const lockCheck3 = checkLockStatus(testOp.id, baseTime, mockStorage);
assert.strictEqual(lockCheck3.isLocked, false);

// 7. Ensure no "1234" is present in UI templates
const screenLoginHtml = fs.readFileSync(
  path.join(__dirname, '../partials/screen-login.html'),
  'utf8'
);
assert.strictEqual(
  screenLoginHtml.includes('1234'),
  false,
  'No "1234" string must appear in screen-login.html UI'
);

// 7b. Seeded history ledger (30-day demo data)
assert.strictEqual(completedTickets.length, 190, 'Seed must create 190 completed tickets');
assert.strictEqual(voidedTickets.length, 6, 'Seed must create 6 voided tickets');
assert.strictEqual(deletedTickets.length, 4, 'Seed must create 4 deleted-pending tickets');
assert.strictEqual(pendingTickets.length, 3, 'Three live pending tickets must remain');

const ledger = getAllTickets();
assert.strictEqual(ledger.length, 203, 'Ledger must combine all four ticket collections');

const ledgerIds = ledger.map((ticket) => ticket.id);
assert.strictEqual(
  new Set(ledgerIds).size,
  ledgerIds.length,
  'Ticket IDs must be unique across the ledger'
);
assert.ok(
  ledgerIds.every((id) => id < 11353),
  'Seed IDs must stay below the next live ticket ID'
);

for (let i = 1; i < ledger.length; i++) {
  assert.ok(
    getTicketTimestamp(ledger[i - 1]) >= getTicketTimestamp(ledger[i]),
    'Ledger must be sorted newest first'
  );
}

assert.ok(pendingTickets.every((ticket) => getTicketStage(ticket) === 'first'));
assert.ok(completedTickets.every((ticket) => getTicketStage(ticket) === 'complete'));
assert.ok(voidedTickets.every((ticket) => getTicketStage(ticket) === 'complete'));
assert.ok(deletedTickets.every((ticket) => getTicketStage(ticket) === 'first'));
assert.ok(completedTickets.every((ticket) => getTicketStatus(ticket) === 'completed'));
assert.ok(
  completedTickets.every((ticket) => ticket.netWeight === ticket.grossWeight - ticket.tareWeight)
);

const todayCount = completedTickets.filter((ticket) => {
  const completed = new Date(ticket.completedAt);
  const now = new Date();
  return (
    completed.getFullYear() === now.getFullYear() &&
    completed.getMonth() === now.getMonth() &&
    completed.getDate() === now.getDate()
  );
}).length;
assert.ok(todayCount >= 15, `Seed should put roughly 20 tickets on today (got ${todayCount})`);

// 7c. Void moves a completed ticket to the voided ledger with audit fields
const voidTarget = completedTickets[0];
const completedBefore = completedTickets.length;
const voidedBefore = voidedTickets.length;
const voided = voidTicket(voidTarget.id, 'Incorrect weight recorded', 'MD. RAJU');
assert.ok(voided, 'Completed ticket must be voidable');
assert.strictEqual(voided.status, 'voided');
assert.strictEqual(voided.voidedBy, 'MD. RAJU');
assert.strictEqual(voided.voidedReason, 'Incorrect weight recorded');
assert.strictEqual(completedTickets.length, completedBefore - 1);
assert.strictEqual(voidedTickets.length, voidedBefore + 1);
assert.strictEqual(getAllTickets().find((ticket) => ticket.id === voidTarget.id).status, 'voided');

// 7d. Reprint logging increments the copy number and appends an audit row
const reprintTarget = voidedTickets[0];
const copiesBefore = reprintTarget.printCount || 1;
const copyNumber = recordReprint(reprintTarget, 'Customer requested copy', 'AKHTER K.');
assert.strictEqual(copyNumber, copiesBefore + 1);
assert.strictEqual(reprintTarget.printCount, copiesBefore + 1);
assert.strictEqual(
  reprintTarget.printLog[reprintTarget.printLog.length - 1].reason,
  'Customer requested copy'
);
assert.ok(
  actionLog.some((entry) => entry.action === 'reprint' && entry.entityId === reprintTarget.id)
);

// 7e. Truck register: add, archive, guard open pending ticket, restore
const activeBefore = getActiveTrucks().length;
const newTruck = registerTruck(
  {
    plate: 'TEST-9001',
    driver: 'Test Driver',
    phone: '+880 1000 000000',
    client: 'Test Client',
    material: 'Other',
  },
  'MD. RAJU'
);
assert.strictEqual(newTruck.plate, 'TEST-9001');
assert.strictEqual(getActiveTrucks().length, activeBefore + 1);

const blockedPlate = pendingTickets[0].truckNo;
const blockedArchive = archiveTruck(blockedPlate, 'Test', 'MD. RAJU');
assert.strictEqual(
  blockedArchive.ok,
  false,
  'Vehicle with an open pending ticket must not be archived'
);
assert.match(blockedArchive.reason, /open ticket/i);

const archived = archiveTruck('TEST-9001', 'Sold / transferred', 'MD. RAJU');
assert.strictEqual(archived.ok, true);
assert.strictEqual(archived.truck.status, 'archived');
assert.ok(!getActiveTrucks().some((truck) => truck.plate === 'TEST-9001'));

const restored = restoreTruck('TEST-9001', 'MD. RAJU');
assert.strictEqual(restored.status, 'active');
assert.ok(getActiveTrucks().some((truck) => truck.plate === 'TEST-9001'));
assert.ok(
  actionLog.some((entry) => entry.action === 'archive_vehicle' && entry.entityId === 'TEST-9001')
);
assert.ok(
  actionLog.some((entry) => entry.action === 'restore_vehicle' && entry.entityId === 'TEST-9001')
);

// 8. Ticket Soft-Delete check
const initialDeletedCount = deletedTickets.length;
const initialPendingCount = pendingTickets.length;
const ticketToDelete = pendingTickets[0];
const targetId = ticketToDelete.id;
const delResult = deleteTicket(targetId, 'Created by mistake', 'MD. RAJU');
assert.strictEqual(delResult.id, targetId);
assert.strictEqual(delResult.deleted, true);
assert.strictEqual(delResult.deletedReason, 'Created by mistake');
assert.strictEqual(delResult.deletedBy, 'MD. RAJU');
assert.ok(delResult.deletedAt);
assert.strictEqual(pendingTickets.length, initialPendingCount - 1);
assert.strictEqual(deletedTickets.length, initialDeletedCount + 1);
assert.strictEqual(deletedTickets[deletedTickets.length - 1].id, targetId);

// 9. Dashboard layout refactor checks: No Second Weigh card, Top band present
const screenDashboardHtml = fs.readFileSync(
  path.join(__dirname, '../partials/screen-dashboard.html'),
  'utf8'
);
assert.strictEqual(
  screenDashboardHtml.includes('card-action-second-weigh'),
  false,
  'Second Weigh card must be removed from screen-dashboard.html'
);
assert.strictEqual(
  screenDashboardHtml.includes('dashboard-top-band'),
  true,
  'dashboard-top-band must be present in screen-dashboard.html'
);
assert.strictEqual(
  screenDashboardHtml.includes('first-weigh-side-card'),
  true,
  'first-weigh-side-card must be present in screen-dashboard.html'
);

// 10. Second Weigh Refinements: 2-column ticket card, Override Anyway, Preview button, cleanups
const screenSecondWeighHtml = fs.readFileSync(
  path.join(__dirname, '../partials/screen-second-weigh.html'),
  'utf8'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('sw-ticket-top-row'),
  true,
  '2-column ticket top row must be present'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('sw-ticket-detail-row'),
  true,
  '2-column ticket detail row must be present'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('sw-btn-override'),
  false,
  'Legacy sw-btn-override must be removed'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('sw-validation-slot'),
  false,
  'Legacy sw-validation-slot must be removed'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('Override Anyway'),
  true,
  'Override button must say Override Anyway'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('Finalize &amp; Print Certificate'),
  false,
  'Finalize button must be renamed to Preview'
);
assert.strictEqual(
  screenSecondWeighHtml.includes('<span>Preview</span>'),
  true,
  'Preview button text must be present'
);

// 11. Supervisor PIN removal check in second-weigh.js
const secondWeighJs = fs.readFileSync(
  path.join(__dirname, '../js/screens/second-weigh.js'),
  'utf8'
);
assert.strictEqual(
  secondWeighJs.includes('prompt('),
  false,
  'prompt() must not be used in second-weigh.js'
);
assert.strictEqual(
  secondWeighJs.includes('9999'),
  false,
  'Hardcoded supervisor PIN 9999 must not exist in second-weigh.js'
);

// 12. Modal button renames in modals.html
const modalsHtml = fs.readFileSync(path.join(__dirname, '../partials/modals.html'), 'utf8');
assert.strictEqual(
  modalsHtml.includes('Cancel (Esc)'),
  true,
  'Done button must be renamed to Cancel (Esc)'
);
assert.strictEqual(
  modalsHtml.includes('Confirm &amp; Print'),
  true,
  'Print Slip button must be renamed to Confirm & Print'
);

console.log('✔ All scale prototype self-checks passed.');
