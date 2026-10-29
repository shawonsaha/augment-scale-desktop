'use client';

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
        return `Today (${todayStr})`;
      case 'yesterday': {
        const yD = new Date(Date.now() - 86400000);
        return `Yesterday (${getDhakaDateString(yD)})`;
      }
      case '7days':
        return 'Last 7 Days';
      case '30days':
        return 'Last 30 Days';
      case 'this_year':
        return `This Year (${todayStr.split('-')[0]})`;
      case 'last_year':
        return `Last Year (${Number(todayStr.split('-')[0]) - 1})`;
      case 'custom':
        return `Custom (${customFrom} — ${customTo})`;
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
