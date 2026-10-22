/**
 * Pure utility functions for the weighbridge prototype.
 * No DOM access, no state mutation — safe to import anywhere.
 */

/** 12-Hour Timestamp: DD-MM-YY hh:mm:ss AM/PM */
export function formatDateTime12H(d = new Date()) {
  const dt = d instanceof Date && !isNaN(d) ? d : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const h = dt.getHours() % 12 || 12;
  const ampm = dt.getHours() >= 12 ? 'PM' : 'AM';
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${String(dt.getFullYear()).slice(-2)} ${pad(h)}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ampm}`;
}

function parseAppTimestamp(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (!value) return null;

  const match = value.match(
    /^(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i
  );
  if (match) {
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    const hour12 = parseInt(match[4], 10);
    const hour = (hour12 % 12) + (/^p/i.test(match[7]) ? 12 : 0);
    const parsed = new Date(
      year,
      parseInt(match[2], 10) - 1,
      parseInt(match[1], 10),
      hour,
      parseInt(match[5], 10),
      parseInt(match[6] || '0', 10)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatElapsed(input) {
  const then = parseAppTimestamp(input);
  if (!then) return '';

  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} mins`;

  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} hrs`;
  }

  return `${Math.floor(hours / 24)} days`;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Short Date Format for operator screens: "13 Oct · 09:14 AM".
 * Leaves out seconds, adds full year only if not the current year.
 * Handles Date objects, ISO strings, and "DD-MM-YY hh:mm:ss AM/PM" strings.
 */
export function formatShortDate(input = new Date()) {
  if (!input) return '';
  const currentYear = new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');

  // Case 1: "DD-MM-YY[YY] hh:mm[:ss] AM/PM" string format
  if (typeof input === 'string') {
    const match = input.match(
      /^(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)/i
    );
    if (match) {
      const day = parseInt(match[1], 10);
      const monthIdx = parseInt(match[2], 10) - 1;
      let yr = parseInt(match[3], 10);
      if (yr < 100) yr += 2000;
      const monthName = MONTH_NAMES[monthIdx] || match[2];
      const h = pad(parseInt(match[4], 10));
      const m = match[5];
      const ampm = match[6].toUpperCase();
      const yrPart = yr !== currentYear ? ` ${yr}` : '';
      return `${day} ${monthName}${yrPart} · ${h}:${m} ${ampm}`;
    }
  }

  // Case 2: Date object or date-parseable string
  const dt = input instanceof Date ? input : new Date(input);
  if (!isNaN(dt.getTime())) {
    const day = dt.getDate();
    const monthName = MONTH_NAMES[dt.getMonth()];
    const yr = dt.getFullYear();
    const h = dt.getHours() % 12 || 12;
    const m = pad(dt.getMinutes());
    const ampm = dt.getHours() >= 12 ? 'PM' : 'AM';
    const yrPart = yr !== currentYear ? ` ${yr}` : '';
    return `${day} ${monthName}${yrPart} · ${pad(h)}:${m} ${ampm}`;
  }

  return String(input);
}

/**
 * Short Date Format with Seconds for operator screens: "13 Oct · 09:14:22 AM".
 * Includes seconds if available (or from Date object), adds full year only if not current year.
 * Handles Date objects, ISO strings, and "DD-MM-YY hh:mm[:ss] AM/PM" strings.
 */
export function formatShortDateWithSeconds(input = new Date()) {
  if (!input) return '';
  const currentYear = new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');

  // Case 1: "DD-MM-YY[YY] hh:mm[:ss] AM/PM" string format
  if (typeof input === 'string') {
    const match = input.match(
      /^(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)/i
    );
    if (match) {
      const day = parseInt(match[1], 10);
      const monthIdx = parseInt(match[2], 10) - 1;
      let yr = parseInt(match[3], 10);
      if (yr < 100) yr += 2000;
      const monthName = MONTH_NAMES[monthIdx] || match[2];
      const h = pad(parseInt(match[4], 10));
      const m = match[5];
      const s = match[6] !== undefined ? `:${match[6]}` : '';
      const ampm = match[7].toUpperCase();
      const yrPart = yr !== currentYear ? ` ${yr}` : '';
      return `${day} ${monthName}${yrPart} · ${h}:${m}${s} ${ampm}`;
    }
  }

  // Case 2: Date object or date-parseable string
  const dt = input instanceof Date ? input : new Date(input);
  if (!isNaN(dt.getTime())) {
    const day = dt.getDate();
    const monthName = MONTH_NAMES[dt.getMonth()];
    const yr = dt.getFullYear();
    const h = dt.getHours() % 12 || 12;
    const m = pad(dt.getMinutes());
    const s = pad(dt.getSeconds());
    const ampm = dt.getHours() >= 12 ? 'PM' : 'AM';
    const yrPart = yr !== currentYear ? ` ${yr}` : '';
    return `${day} ${monthName}${yrPart} · ${pad(h)}:${m}:${s} ${ampm}`;
  }

  return String(input);
}

/**
 * Full timestamp for ledgers and reports: "22 Oct 2026 · 03:04:05 PM".
 * Accepts Date objects, ISO strings and "DD-MM-YY hh:mm:ss AM/PM" strings.
 */
export function formatFullDateTime(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : parseAppTimestamp(input);
  if (!dt || Number.isNaN(dt.getTime())) return String(input);

  const pad = (n) => String(n).padStart(2, '0');
  const h = dt.getHours() % 12 || 12;
  const ampm = dt.getHours() >= 12 ? 'PM' : 'AM';
  return `${pad(dt.getDate())} ${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()} · ${pad(h)}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ampm}`;
}

/** Ensure timestamp is formatted or returns null if pending */
export function ensureFullTimestamp(t) {
  if (!t || String(t).startsWith('Pending')) return null;
  return typeof t === 'string' && t.includes('-') ? t : formatDateTime12H();
}

/** Normalized ticket direction: 'IN' or 'OUT' (handles direction/weightType ticket shapes). */
export function directionOf(ticket) {
  const raw = String(ticket?.direction || ticket?.weightType || '').toUpperCase();
  return raw.includes('OUT') ? 'OUT' : 'IN';
}

/** Escape text before it is placed in an HTML string (operator-typed truck/driver/material). */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Calculate net weight and anomaly flag */
export function calcNet(firstType, firstWeight, secondWeight) {
  const gross = firstType === 'Gross' ? firstWeight : secondWeight;
  const tare = firstType === 'Tare' ? firstWeight : secondWeight;
  return { gross, tare, net: gross - tare, isAnomaly: gross - tare <= 0 };
}
