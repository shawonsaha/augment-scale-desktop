'use client';

import { useState } from 'react';
import { WeighTicket } from '@/lib/types';
import { formatKg, formatTons, formatTime } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight, Clock, CheckCircle2, Eye, Filter } from 'lucide-react';
import { TicketDetailModal } from './ticket-detail-modal';

interface Props {
  initialTickets: WeighTicket[];
}

export function LiveActivityStream({ initialTickets }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<WeighTicket | null>(null);
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const filtered = initialTickets.filter(t => {
    if (filterDirection === 'ALL') return true;
    return t.direction === filterDirection;
  });

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* Table Header Controls */}
      <div className="p-5 border-b border-white/8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200">
              Live Scale Activity Stream
            </h3>
            <span className="w-2 h-2 rounded-full bg-emerald-400 radar-live" />
          </div>
          <p className="text-xs text-slate-400">
            Realtime weighings logged at Workstation DESKTOP-128GRO4
          </p>
        </div>

        {/* Direction Filter */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-white/5 text-xs">
          {(['ALL', 'IN', 'OUT'] as const).map((dir) => (
            <button
              key={dir}
              onClick={() => setFilterDirection(dir)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filterDirection === dir
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {dir === 'ALL' ? 'All Activity' : dir === 'IN' ? 'Inbound' : 'Outbound'}
            </button>
          ))}
        </div>
      </div>

      {/* Tickets Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/5 text-slate-400 bg-white/[0.02]">
              <th className="py-3.5 px-4 font-medium">Ticket #</th>
              <th className="py-3.5 px-4 font-medium">Time</th>
              <th className="py-3.5 px-4 font-medium">Direction</th>
              <th className="py-3.5 px-4 font-medium">Plate Number</th>
              <th className="py-3.5 px-4 font-medium">Customer / Party</th>
              <th className="py-3.5 px-4 font-medium text-right">1st Weight</th>
              <th className="py-3.5 px-4 font-medium text-right">2nd Weight</th>
              <th className="py-3.5 px-4 font-medium text-right">Net Cargo</th>
              <th className="py-3.5 px-4 font-medium text-center">Status</th>
              <th className="py-3.5 px-4 font-medium text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-slate-500">
                  No weighings recorded matching this filter.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-white/[0.03] transition-colors group cursor-pointer"
                  onClick={() => setSelectedTicket(t)}
                >
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-200">
                    #{t.ticket_display_id || t.ticket_number}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px] num-tabular">
                    {formatTime(t.created_at)}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                      t.direction === 'IN'
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                        : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25'
                    }`}>
                      {t.direction === 'IN' ? (
                        <ArrowDownLeft className="w-3 h-3 text-cyan-400" />
                      ) : (
                        <ArrowUpRight className="w-3 h-3 text-indigo-400" />
                      )}
                      {t.direction}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="font-mono font-semibold text-slate-100 px-2 py-0.5 rounded bg-slate-900 border border-white/10 text-[11px]">
                      {t.plate_number}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 font-medium truncate max-w-[150px]">
                    {t.customer_name || 'Standard Account'}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 num-tabular">
                    {formatKg(t.first_weight_kg)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 num-tabular">
                    {t.second_weight_kg ? formatKg(t.second_weight_kg) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-300 num-tabular">
                    {t.net_weight_kg ? formatTons(t.net_weight_kg) : <span className="text-slate-600 text-xs font-normal">Pending</span>}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                      t.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : t.status === 'pending'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTicket(t);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                      title="Inspect Ticket"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Ticket Details Sheet / Modal */}
      <TicketDetailModal
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
      />
    </div>
  );
}
