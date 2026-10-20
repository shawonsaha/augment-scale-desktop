/**
 * Deterministic demo history for the prototype.
 *
 * The prototype has no backend, so History/Trucks need realistic volume on first
 * load. Everything here is generated from a fixed PRNG seed (stable values and
 * ordering), while dates are anchored to "now" so the Today/Yesterday/30-day
 * filters always have data.
 *
 * This module deliberately imports nothing from state.js: state.js calls
 * buildSeedHistory() with the live truck/operator pools, which avoids a circular
 * import and keeps the seed free of module-evaluation ordering hazards.
 */

import { formatDateTime12H } from './utils.js';

const MATERIALS = [
  'Scrap Iron',
  'MS Plate',
  'Pipe',
  'Steel Coil',
  'Raw Coal',
  'Copper / Cable',
  'Machinery',
  'Cement',
  'Other',
];

const CLIENTS = [
  'BSRM Steels Ltd',
  'Abul Khair Steel',
  'Apex Cement Mills',
  'GPH Ispat',
  'Crown Cement',
  'KSRM Steel',
];

const REPRINT_REASONS = [
  'Customer requested copy',
  'Original lost',
  'Bad print quality',
  'Gate office copy',
];

const VOID_REASONS = [
  'Incorrect weight recorded',
  'Wrong vehicle identified',
  'Scale malfunction',
  'Operator error',
];

const DELETE_REASONS = [
  'Truck left without second weigh',
  'Wrong truck number or details',
  'Duplicate ticket',
  'Created by mistake',
];

const FIRST_OPERATOR_FALLBACK = {
  id: 'mr',
  name: 'MD. RAJU',
  avatar: 'avatars/frame-9.svg',
};

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function atTime(day, hour, minute, second) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, second);
}

/**
 * Builds completed, voided and deleted-pending tickets.
 *
 * @param {Object} options
 * @param {Array} options.trucks Registered truck pool (plate/driver/phone/material/client)
 * @param {Array} options.operators Operator pool
 * @param {number} [options.days=30] History window in days
 * @param {number} [options.completedCount=190]
 * @param {number} [options.voidedCount=6]
 * @param {number} [options.deletedCount=4]
 * @returns {{completed: Array, voided: Array, deleted: Array}}
 */
export function buildSeedHistory({
  trucks = [],
  operators = [],
  days = 30,
  completedCount = 190,
  voidedCount = 6,
  deletedCount = 4,
} = {}) {
  const random = mulberry32(20261020);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (min, max) => min + Math.floor(random() * (max - min + 1));
  const truckPool =
    trucks.length > 0 ? trucks : [{ plate: 'DM-T-11-2045', driver: 'Kalam Hossain' }];
  const operatorPool = operators.length > 0 ? operators : [FIRST_OPERATOR_FALLBACK];

  const now = new Date();
  const today = startOfDay(now);
  const todayElapsedMs = Math.max(now.getTime() - today.getTime(), 5 * 60 * 1000);

  function operator(index) {
    const op = operatorPool[index % operatorPool.length] || FIRST_OPERATOR_FALLBACK;
    return {
      id: op.id || 'mr',
      name: op.name || FIRST_OPERATOR_FALLBACK.name,
      avatar: op.avatar || FIRST_OPERATOR_FALLBACK.avatar,
    };
  }

  function buildTicket(id, index) {
    const truck = pick(truckPool);
    const firstOp = operator(index);
    const secondOp = operator(index + 1 + (index % 2));

    // 20 today, 14 yesterday, the rest spread evenly across the remaining days.
    let dayOffset;
    if (index < 20) dayOffset = 0;
    else if (index < 34) dayOffset = 1;
    else dayOffset = 2 + ((index - 34) % Math.max(days - 2, 1));

    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOffset);
    const isToday = dayOffset === 0;

    let firstTs;
    if (isToday) {
      const fraction = (index + 0.5) / 20;
      firstTs = new Date(today.getTime() + todayElapsedMs * fraction);
      firstTs = addMinutes(firstTs, -between(5, 20));
    } else {
      firstTs = atTime(day, between(6, 16), between(0, 59), between(0, 59));
    }

    let secondTs = addMinutes(firstTs, between(25, 180));
    if (isToday && secondTs > now) {
      secondTs = addMinutes(now, -between(1, 4));
    }
    if (secondTs <= firstTs) {
      secondTs = addMinutes(firstTs, 2);
    }

    const direction = random() < 0.55 ? 'IN' : 'OUT';
    const gross = between(28000, 42000);
    const tare = between(11000, 16500);
    const net = gross - tare;

    const firstWeightType = direction === 'IN' ? 'Gross' : 'Tare';
    const firstWeight = direction === 'IN' ? gross : tare;
    const secondWeight = direction === 'IN' ? tare : gross;
    const secondWeightType = direction === 'IN' ? 'Tare' : 'Gross';

    const material = random() < 0.7 && truck.material ? truck.material : pick(MATERIALS);
    const client = random() < 0.7 && truck.client ? truck.client : pick(CLIENTS);

    const printCount = index % 29 === 5 ? 2 : index % 53 === 7 ? 3 : 1;
    const printLog = [
      {
        by: secondOp.name,
        at: secondTs.toISOString(),
        type: 'weighbridge_certificate',
        reason: null,
      },
    ];
    for (let copy = 2; copy <= printCount; copy++) {
      printLog.push({
        by: firstOp.name,
        at: addMinutes(secondTs, between(20, 240)).toISOString(),
        type: 'reprint',
        reason: pick(REPRINT_REASONS),
        copyNumber: copy,
      });
    }

    const overridden = index % 37 === 0;
    const ticket = {
      id,
      ticketId: id,
      truckNo: truck.plate,
      driver: truck.driver || '—',
      phone: truck.phone || '',
      material,
      client,
      weightType: direction === 'IN' ? 'IN WEIGHT' : 'OUT WEIGHT',
      direction,
      firstWeight,
      firstWeightType,
      firstWeightTime: formatDateTime12H(firstTs),
      firstOperator: firstOp.name,
      firstOperatorId: firstOp.id,
      firstOperatorAvatar: firstOp.avatar,
      secondWeight,
      secondWeightType,
      secondWeightTime: formatDateTime12H(secondTs),
      secondOperator: secondOp.name,
      secondOperatorId: secondOp.id,
      secondOperatorAvatar: secondOp.avatar,
      grossWeight: gross,
      tareWeight: tare,
      netWeight: net,
      challan: `CH-${44000 + index}`,
      remarks: index % 11 === 0 ? 'Challan verified at gate' : '',
      completedAt: secondTs.toISOString(),
      createdAt: firstTs.toISOString(),
      status: 'completed',
      printCount,
      printLog,
    };

    if (overridden) {
      ticket.overridden = true;
      ticket.override = {
        reason: 'Negative payload accepted after physical verification',
        operator: operator(index + 2).name,
        timestamp: formatDateTime12H(secondTs),
        anomalyDetails: `Gross ${gross.toLocaleString('en-US')} kg ≤ Tare ${tare.toLocaleString('en-US')} kg`,
      };
    }

    return ticket;
  }

  const completed = [];
  for (let i = 0; i < completedCount; i++) {
    completed.push(buildTicket(11340 - i, i));
  }

  const voided = [];
  for (let i = 0; i < voidedCount; i++) {
    const ticket = buildTicket(11130 - i, i * 3 + 1);
    const voidedAt = addMinutes(new Date(ticket.completedAt), between(30, 600));
    ticket.status = 'voided';
    ticket.voidedAt = voidedAt.toISOString();
    ticket.voidedBy = operator(0).name;
    ticket.voidedReason = VOID_REASONS[i % VOID_REASONS.length];
    voided.push(ticket);
  }

  // Deleted tickets were deleted while still waiting for the second weigh, so
  // they only ever have a first weight (stage = "First only").
  const deleted = [];
  for (let i = 0; i < deletedCount; i++) {
    const id = 11134 - i;
    const truck = pick(truckPool);
    const op = operator(i + 2);
    const direction = random() < 0.5 ? 'IN' : 'OUT';
    const firstWeight = direction === 'IN' ? between(30000, 41000) : between(11000, 16000);
    const firstTs = addMinutes(now, -(i * 180 + between(20, 90)));
    const deletedAt = addMinutes(firstTs, between(10, 240));

    deleted.push({
      id,
      ticketId: id,
      truckNo: truck.plate,
      driver: truck.driver || '—',
      phone: truck.phone || '',
      material: truck.material || pick(MATERIALS),
      client: truck.client || pick(CLIENTS),
      weightType: direction === 'IN' ? 'IN WEIGHT' : 'OUT WEIGHT',
      direction,
      firstWeight,
      firstWeightType: direction === 'IN' ? 'Gross' : 'Tare',
      firstWeightTime: formatDateTime12H(firstTs),
      firstOperator: op.name,
      firstOperatorId: op.id,
      firstOperatorAvatar: op.avatar,
      challan: `CH-${43000 + i}`,
      remarks: '',
      createdAt: firstTs.toISOString(),
      deleted: true,
      deletedAt: deletedAt.toISOString(),
      deletedBy: operator(0).name,
      deletedReason: DELETE_REASONS[i % DELETE_REASONS.length],
      status: 'deleted',
      printCount: 1,
      printLog: [
        {
          by: op.name,
          at: firstTs.toISOString(),
          type: 'first_weigh_slip',
          reason: null,
        },
      ],
    });
  }

  return { completed, voided, deleted };
}
