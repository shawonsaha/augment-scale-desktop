const fs = require('fs');
const path = require('path');

const webSrc = path.resolve(__dirname, '../../dashboard-web/src');

// ========================================================
// 1. Update src/lib/utils.ts
// ========================================================
const utilsTs = `import { clsx, type ClassValue } from 'clsx';
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

    return \`\${day} \${month} \${year} · \${hour}:\${minute}:\${second} \${dayPeriod}\`;
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
`;

fs.writeFileSync(path.join(webSrc, 'lib/utils.ts'), utilsTs, 'utf8');
console.log('Updated lib/utils.ts');

// ========================================================
// 2. Create src/components/dashboard-view.tsx
// ========================================================
const dashboardViewTsx = `'use client';

import { useState, useMemo } from 'react';
import { WeighTicket, Workstation, Weighbridge } from '@/lib/types';
import { WorkstationStatusPill } from '@/components/workstation-status-pill';
import { StatsCards } from '@/components/stats-cards';
import { ActivityChart } from '@/components/activity-chart';
import { LiveActivityStream } from '@/components/live-activity-stream';
import { getDhakaDateString, filterTicketsByDate, DateFilterType } from '@/lib/utils';
import { Calendar } from 'lucide-react';

interface Props {
  initialTickets: WeighTicket[];
  workstation: Workstation | null;
  weighbridge: Weighbridge | null;
}

export function DashboardView({ initialTickets, workstation, weighbridge }: Props) {
  // BY DEFAULT: DATE RANGE IS TODAY (Matches User Requirement)
  const [dateFilter, setDateFilter] = useState<DateFilterType>('today');

  const todayStr = useMemo(() => getDhakaDateString(new Date()), []);
  const monthAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return getDhakaDateString(d);
  }, []);

  const [customFrom, setCustomFrom] = useState(monthAgoStr);
  const [customTo, setCustomTo] = useState(todayStr);

  // Tickets dynamically filtered by date range
  const dateFilteredTickets = useMemo(() => {
    return filterTicketsByDate(initialTickets, dateFilter, customFrom, customTo);
  }, [initialTickets, dateFilter, customFrom, customTo]);

  // Descriptive period label
  const periodLabel = useMemo(() => {
    switch (dateFilter) {
      case 'today':
        return \`Today (\${todayStr})\`;
      case 'yesterday': {
        const yD = new Date(Date.now() - 86400000);
        return \`Yesterday (\${getDhakaDateString(yD)})\`;
      }
      case '7days':
        return 'Last 7 Days';
      case '30days':
        return 'Last 30 Days';
      case 'this_year':
        return \`This Year (\${todayStr.split('-')[0]})\`;
      case 'last_year':
        return \`Last Year (\${Number(todayStr.split('-')[0]) - 1})\`;
      case 'custom':
        return \`Custom (\${customFrom} — \${customTo})\`;
      case 'all':
      default:
        return 'All Time';
    }
  }, [dateFilter, todayStr, customFrom, customTo]);

  return (
    <div className="space-y-6">
      {/* Live Scale & Workstation Health Strip */}
      <WorkstationStatusPill workstation={workstation} weighbridge={weighbridge} />

      {/* Date Range Scope Notification Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/5 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span>Active Scope:</span>
          <span className="font-semibold text-white bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2.5 py-0.5 rounded-full text-[11px]">
            {periodLabel}
          </span>
          <span className="text-slate-500">•</span>
          <span>
            <strong className="text-white">{dateFilteredTickets.length}</strong> transactions in period
          </span>
        </div>
        <div className="text-[11px] text-slate-500">
          Summary KPIs and Charts update reactively with the ledger date filter
        </div>
      </div>

      {/* 1. Key Performance Indicators (Directly reactive to dateFilteredTickets!) */}
      <StatsCards tickets={dateFilteredTickets} />

      {/* 2. Analytics Chart (Directly reactive to dateFilteredTickets!) */}
      <ActivityChart tickets={dateFilteredTickets} />

      {/* 3. Live Activity Stream & Inspection Table */}
      <LiveActivityStream
        initialTickets={dateFilteredTickets}
        allTickets={initialTickets}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customFrom={customFrom}
        onCustomFromChange={setCustomFrom}
        customTo={customTo}
        onCustomToChange={setCustomTo}
      />
    </div>
  );
}
`;

fs.writeFileSync(path.join(webSrc, 'components/dashboard-view.tsx'), dashboardViewTsx, 'utf8');
console.log('Created components/dashboard-view.tsx');

// ========================================================
// 3. Update src/app/dashboard/page.tsx
// ========================================================
const dashboardPageTsx = `export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WeighTicket, Workstation, Weighbridge, PrintJobEntry } from '@/lib/types';
import { DashboardView } from '@/components/dashboard-view';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [ticketsRes, workstationRes, weighbridgeRes, printJobsRes] = await Promise.all([
    supabase
      .from('ticket_history')
      .select('*')
      .order('ticket_number', { ascending: false }),
    supabase.from('workstations').select('*').limit(1).maybeSingle(),
    supabase.from('weighbridges').select('*').limit(1).maybeSingle(),
    supabase.from('print_jobs').select('*'),
  ]);

  const rawTickets = (ticketsRes.data || []) as WeighTicket[];
  const printJobs = (printJobsRes.data || []) as PrintJobEntry[];

  // Attach print_jobs to corresponding tickets
  const tickets: WeighTicket[] = rawTickets.map((t) => {
    const jobs = printJobs.filter((pj) => pj.ticket_id === t.id);
    return {
      ...t,
      print_jobs: jobs,
      print_count: Math.max(t.print_count || 0, jobs.length),
    };
  });

  const workstation = workstationRes.data as Workstation | null;
  const weighbridge = weighbridgeRes.data as Weighbridge | null;

  return (
    <DashboardView
      initialTickets={tickets}
      workstation={workstation}
      weighbridge={weighbridge}
    />
  );
}
`;

fs.writeFileSync(path.join(webSrc, 'app/dashboard/page.tsx'), dashboardPageTsx, 'utf8');
console.log('Updated app/dashboard/page.tsx');

// ========================================================
// 4. Update src/components/live-activity-stream.tsx
// ========================================================
const liveActivityStreamTsx = `'use client';

import { useState, useMemo } from 'react';
import { WeighTicket } from '@/lib/types';
import { getTicketStatus, formatWeightNumber, formatFullDateTime, getDhakaDateString, filterTicketsByDate, DateFilterType, cn } from '@/lib/utils';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Calendar,
} from 'lucide-react';
import { TicketDetailModal } from './ticket-detail-modal';
import { HistoryReportModal } from './history-report-modal';

interface Props {
  initialTickets: WeighTicket[];
  allTickets?: WeighTicket[];
  dateFilter?: DateFilterType;
  onDateFilterChange?: (opt: DateFilterType) => void;
  customFrom?: string;
  onCustomFromChange?: (from: string) => void;
  customTo?: string;
  onCustomToChange?: (to: string) => void;
}

export function LiveActivityStream({
  initialTickets,
  allTickets,
  dateFilter: controlledDateFilter,
  onDateFilterChange,
  customFrom: controlledCustomFrom,
  onCustomFromChange,
  customTo: controlledCustomTo,
  onCustomToChange,
}: Props) {
  const [selectedTicket, setSelectedTicket] = useState<WeighTicket | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  // Uncontrolled fallback (defaults to 'today' as requested by user)
  const [internalDateFilter, setInternalDateFilter] = useState<DateFilterType>('today');
  const todayStr = useMemo(() => getDhakaDateString(new Date()), []);
  const monthAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return getDhakaDateString(d);
  }, []);
  const [internalCustomFrom, setInternalCustomFrom] = useState(monthAgoStr);
  const [internalCustomTo, setInternalCustomTo] = useState(todayStr);

  const activeDateFilter = controlledDateFilter !== undefined ? controlledDateFilter : internalDateFilter;
  const setDateFilter = onDateFilterChange || setInternalDateFilter;

  const activeCustomFrom = controlledCustomFrom !== undefined ? controlledCustomFrom : internalCustomFrom;
  const setCustomFrom = onCustomFromChange || setInternalCustomFrom;

  const activeCustomTo = controlledCustomTo !== undefined ? controlledCustomTo : internalCustomTo;
  const setCustomTo = onCustomToChange || setInternalCustomTo;

  // Other filters
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'completed' | 'pending' | 'voided' | 'deleted' | 'overridden'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Source tickets: if controlled, initialTickets is already date-filtered.
  // If uncontrolled, we filter initialTickets by activeDateFilter here.
  const ticketsToFilter = useMemo(() => {
    if (controlledDateFilter !== undefined) {
      return initialTickets;
    }
    return filterTicketsByDate(initialTickets, activeDateFilter, activeCustomFrom, activeCustomTo);
  }, [controlledDateFilter, initialTickets, activeDateFilter, activeCustomFrom, activeCustomTo]);

  // Compute final filtered list
  const filtered = useMemo(() => {
    return ticketsToFilter.filter((t) => {
      // 1. Direction Filter
      if (directionFilter !== 'ALL' && t.direction !== directionFilter) return false;

      // 2. Status Filter
      const status = getTicketStatus(t);
      if (statusFilter === 'overridden') {
        if (!t.is_overridden) return false;
      } else if (statusFilter !== 'ALL') {
        if (status !== statusFilter) return false;
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPlate = t.plate_number?.toLowerCase().includes(q);
        const matchDriver = t.driver_name?.toLowerCase().includes(q);
        const matchTicket = String(t.ticket_number).includes(q) || t.ticket_display_id?.toLowerCase().includes(q);
        if (!matchPlate && !matchDriver && !matchTicket) return false;
      }

      return true;
    });
  }, [ticketsToFilter, directionFilter, statusFilter, searchQuery]);

  // Calculate live ledger summary
  const completedTickets = filtered.filter((t) => getTicketStatus(t) === 'completed');
  const totalNetSumKg = completedTickets.reduce((sum, t) => sum + (t.net_weight_kg || 0), 0);
  const totalNetMT = (totalNetSumKg / 1000).toFixed(1);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl border border-white/10">
      {/* Top Filter and Search Bar */}
      <div className="p-4 sm:p-5 border-b border-white/8 space-y-3.5 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-white tracking-tight">
              Weighbridge Activity Ledger
            </h3>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>

          {/* Quick Action: Print report Button (matches Desktop App!) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/35 text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
              title="Open Printable A4 History Ledger Report"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-400" />
              <span>Print report</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar: Date Dropdown, Direction, Status */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {/* 1. Date Range Dropdown (Default Today) */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs">
            <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <select
              value={activeDateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterType)}
              className="bg-transparent text-white font-medium text-xs focus:outline-none cursor-pointer"
            >
              <option value="today" className="bg-slate-900 text-white">Today</option>
              <option value="yesterday" className="bg-slate-900 text-white">Yesterday</option>
              <option value="7days" className="bg-slate-900 text-white">Last 7 days</option>
              <option value="30days" className="bg-slate-900 text-white">Last 30 days</option>
              <option value="this_year" className="bg-slate-900 text-white">This year</option>
              <option value="last_year" className="bg-slate-900 text-white">Last year</option>
              <option value="custom" className="bg-slate-900 text-white">Custom range...</option>
              <option value="all" className="bg-slate-900 text-white">All time</option>
            </select>
          </div>

          {/* Custom Date Pickers (Shown if "custom" is selected) */}
          {activeDateFilter === 'custom' && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-900/90 border border-cyan-500/30 text-xs">
              <span className="text-slate-400 text-[11px]">From:</span>
              <input
                type="date"
                value={activeCustomFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-slate-950 px-2 py-0.5 rounded border border-white/10 text-white font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              />
              <span className="text-slate-400 text-[11px]">To:</span>
              <input
                type="date"
                value={activeCustomTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-slate-950 px-2 py-0.5 rounded border border-white/10 text-white font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          {/* 2. Direction Filter */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-white/5 text-xs">
            {(['ALL', 'IN', 'OUT'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => setDirectionFilter(dir)}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition-all text-[11px]',
                  directionFilter === dir
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {dir === 'ALL' ? 'All' : dir === 'IN' ? 'Inbound' : 'Outbound'}
              </button>
            ))}
          </div>

          {/* 3. Status Filter */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-white/5 text-xs">
            {(
              [
                { id: 'ALL', label: 'All Status' },
                { id: 'completed', label: 'Completed' },
                { id: 'pending', label: 'Pending' },
                { id: 'overridden', label: 'Overridden' },
                { id: 'voided', label: 'Voided' },
                { id: 'deleted', label: 'Deleted' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition-all text-[11px]',
                  statusFilter === tab.id
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ticket #, license plate, driver name..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-slate-900/60 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              <th className="py-3 px-4 w-[110px]">TICKET</th>
              <th className="py-3 px-4 w-[180px]">TRUCK / DRIVER</th>
              <th className="py-3 px-4 w-[200px]">FIRST WEIGHT</th>
              <th className="py-3 px-4 w-[200px]">SECOND WEIGHT</th>
              <th className="py-3 px-4 w-[140px]">NET</th>
              <th className="py-3 px-4">STATUS</th>
              <th className="py-3 px-4 text-right w-[90px]">PRINTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <p className="text-sm">No tickets found for this period.</p>
                  <p className="text-xs text-slate-600 mt-1">Try switching date range to &quot;All time&quot; or clearing search filters.</p>
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const status = getTicketStatus(t);
                const isDimmed = status === 'deleted' || status === 'voided';
                const isVoided = status === 'voided';
                const hasNet = t.net_weight_kg !== null && t.net_weight_kg !== undefined;
                const isNegativeOrZeroNet = hasNet && (t.net_weight_kg as number) <= 0;
                const printCount = Math.max(1, Number(t.print_count) || 0);

                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTicket(t)}
                    className={cn(
                      'group cursor-pointer hover:bg-white/[0.04] transition-all select-none',
                      isDimmed && 'opacity-40 hover:opacity-85'
                    )}
                  >
                    {/* TICKET COLUMN: #ID + IN/OUT BADGE */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'font-mono font-bold text-sm text-cyan-400',
                            isVoided && 'line-through text-slate-400'
                          )}
                        >
                          #{t.ticket_display_id || t.ticket_number}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase',
                            t.direction === 'IN'
                              ? 'text-cyan-300 bg-cyan-950/60 border border-cyan-500/30'
                              : 'text-indigo-300 bg-indigo-950/60 border border-indigo-500/30'
                          )}
                        >
                          {t.direction}
                        </span>
                      </div>
                    </td>

                    {/* TRUCK / DRIVER */}
                    <td className="py-3.5 px-4 align-top">
                      <div>
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-900 border border-white/10 font-mono font-bold text-white text-xs tracking-wide">
                          {t.plate_number}
                        </span>
                        <span className="block text-slate-400 text-xs mt-1 font-medium truncate max-w-[170px]">
                          {t.driver_name || '—'}
                        </span>
                      </div>
                    </td>

                    {/* FIRST WEIGHT */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="space-y-0.5">
                        <div
                          className={cn(
                            'font-mono font-bold text-sm text-white num-tabular',
                            isVoided && 'line-through text-slate-400'
                          )}
                        >
                          {formatWeightNumber(t.first_weight_kg)}
                        </div>
                        <div className="text-[11px] text-slate-300 font-medium">
                          {t.first_operator_name || 'MD. RAJU'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {formatFullDateTime(t.first_weight_at || t.created_at)}
                        </div>
                      </div>
                    </td>

                    {/* SECOND WEIGHT */}
                    <td className="py-3.5 px-4 align-top">
                      {t.second_weight_kg !== null && t.second_weight_kg !== undefined ? (
                        <div className="space-y-0.5">
                          <div
                            className={cn(
                              'font-mono font-bold text-sm text-white num-tabular',
                              isVoided && 'line-through text-slate-400'
                            )}
                          >
                            {formatWeightNumber(t.second_weight_kg)}
                          </div>
                          <div className="text-[11px] text-slate-300 font-medium">
                            {t.second_operator_name || 'MD. RAJU'}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {formatFullDateTime(t.second_weight_at)}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-slate-500 font-mono text-sm">—</div>
                          <div className="text-[11px] text-slate-500">Pending 2nd</div>
                        </div>
                      )}
                    </td>

                    {/* NET */}
                    <td className="py-3.5 px-4 align-top">
                      {hasNet ? (
                        isNegativeOrZeroNet ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/15 border border-rose-500/35 text-rose-300 font-bold font-mono text-xs num-tabular shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                            {formatWeightNumber(t.net_weight_kg)} kg
                          </span>
                        ) : (
                          <div className="font-mono font-bold text-white text-sm num-tabular">
                            {formatWeightNumber(t.net_weight_kg)}{' '}
                            <span className="text-slate-400 text-xs font-normal">kg</span>
                          </div>
                        )
                      ) : (
                        <div className="text-slate-500 font-mono text-xs">— kg</div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {status === 'completed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Completed
                          </span>
                        )}

                        {status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                            <Clock className="w-3 h-3 text-amber-400" />
                            Pending
                          </span>
                        )}

                        {status === 'voided' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/40">
                            <XCircle className="w-3 h-3 text-slate-400" />
                            Voided
                          </span>
                        )}

                        {status === 'deleted' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            Deleted
                          </span>
                        )}

                        {t.is_overridden && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                            Overridden
                          </span>
                        )}
                      </div>
                    </td>

                    {/* PRINTS */}
                    <td className="py-3.5 px-4 align-top text-right">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] border',
                          printCount > 1
                            ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 font-semibold'
                            : 'bg-slate-900 border-white/10 text-slate-400'
                        )}
                      >
                        <Printer className="w-3 h-3 text-amber-400/80" />
                        {printCount}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Ledger Bar */}
      <div className="px-5 py-3 border-t border-white/8 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span>Showing <strong className="text-white">{filtered.length}</strong> of {(allTickets || initialTickets).length} tickets</span>
          <span className="text-slate-600">•</span>
          <span>Net Cargo: <strong className="text-emerald-400 font-mono">{totalNetMT} MT</strong></span>
        </div>
        <div className="text-[11px] text-slate-500">
          Click any ticket row for full audit trail &amp; scale telemetry
        </div>
      </div>

      {/* Ticket Audit & Inspection Modal */}
      <TicketDetailModal
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
      />

      {/* History Ledger A4 Print Report Modal */}
      <HistoryReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        allTickets={allTickets || initialTickets}
      />
    </div>
  );
}
`;

fs.writeFileSync(path.join(webSrc, 'components/live-activity-stream.tsx'), liveActivityStreamTsx, 'utf8');
console.log('Updated components/live-activity-stream.tsx');
console.log('All date filter sync changes written successfully!');
