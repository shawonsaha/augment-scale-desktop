import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { WeighTicket } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getTicketStatus(t: WeighTicket): 'deleted' | 'voided' | 'completed' | 'pending' {
  if (t.deleted_at) return 'deleted';
  if (t.status_display === 'deleted' || (t.status as string) === 'deleted') return 'deleted';
  if (t.status === 'voided' || t.status_display === 'voided') return 'voided';
  if (t.status === 'completed' || t.status_display === 'completed') return 'completed';
  return 'pending';
}

export function formatWeightNumber(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || isNaN(kg)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(kg);
}

export function formatKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || isNaN(kg)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(kg) + ' kg';
}

export function formatTons(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || isNaN(kg)) return '—';
  const tons = kg / 1000;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tons) + ' MT';
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Dhaka',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Dhaka',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function formatFullDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const day = getPart('day');
    const month = getPart('month');
    const year = getPart('year');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');
    const dayPeriod = getPart('dayPeriod');

    return `${day} ${month} ${year} · ${hour}:${minute}:${second} ${dayPeriod}`;
  } catch {
    return isoString;
  }
}

export function formatDateTime(isoString: string | null | undefined): string {
  return formatFullDateTime(isoString);
}

export function getDhakaDateString(isoStringOrDate: string | Date | null | undefined): string {
  if (!isoStringOrDate) return '';
  try {
    const d = typeof isoStringOrDate === 'string' ? new Date(isoStringOrDate) : isoStringOrDate;
    if (isNaN(d.getTime())) return '';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return '';
  }
}

export type DateFilterType = 'all' | 'today' | 'yesterday' | '7days' | '30days' | 'this_year' | 'last_year' | 'custom';

export function filterTicketsByDate(
  tickets: WeighTicket[],
  period: DateFilterType,
  customFrom?: string,
  customTo?: string
): WeighTicket[] {
  const now = new Date();
  const today = getDhakaDateString(now);

  const yesterdayD = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = getDhakaDateString(yesterdayD);

  const sevenDaysAgoD = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = getDhakaDateString(sevenDaysAgoD);

  const thirtyDaysAgoD = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = getDhakaDateString(thirtyDaysAgoD);

  const curYear = today.split('-')[0];
  const lastYear = String(Number(curYear) - 1);

  return tickets.filter((t) => {
    const raw = t.business_at || t.completed_at || t.first_weight_at || t.created_at;
    const ticketDate = getDhakaDateString(raw);
    if (!ticketDate) return false;

    if (period === 'today') return ticketDate === today;
    if (period === 'yesterday') return ticketDate === yesterday;
    if (period === '7days') return ticketDate >= sevenDaysAgo && ticketDate <= today;
    if (period === '30days') return ticketDate >= thirtyDaysAgo && ticketDate <= today;
    if (period === 'this_year') return ticketDate.startsWith(curYear);
    if (period === 'last_year') return ticketDate.startsWith(lastYear);
    if (period === 'custom') {
      if (customFrom && ticketDate < customFrom) return false;
      if (customTo && ticketDate > customTo) return false;
      return true;
    }
    return true; // 'all'
  });
}
