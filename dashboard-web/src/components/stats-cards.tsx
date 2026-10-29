import { WeighTicket } from '@/lib/types';
import { getTicketStatus, formatKg, formatTons } from '@/lib/utils';
import { Scale, Truck, Clock, AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, ShieldAlert } from 'lucide-react';

interface Props {
  tickets: WeighTicket[];
}

export function StatsCards({ tickets }: Props) {
  const completed = tickets.filter((t) => getTicketStatus(t) === 'completed');
  const pending = tickets.filter((t) => getTicketStatus(t) === 'pending');
  const voided = tickets.filter((t) => getTicketStatus(t) === 'voided');
  const deleted = tickets.filter((t) => getTicketStatus(t) === 'deleted');
  const overridden = tickets.filter((t) => t.is_overridden);

  // Net cargo processed ONLY from valid completed tickets
  const totalNetKg = completed.reduce((sum, t) => sum + (t.net_weight_kg || 0), 0);
  const totalGrossKg = tickets.reduce((sum, t) => sum + (t.first_weight_kg || 0), 0);
  const totalTareKg = completed.reduce((sum, t) => sum + (t.second_weight_kg || 0), 0);

  const inboundCount = tickets.filter((t) => t.direction === 'IN').length;
  const outboundCount = tickets.filter((t) => t.direction === 'OUT').length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Net Tonnage */}
      <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group hover:border-emerald-500/30 transition-all shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
          <span>Net Cargo Processed</span>
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <Scale className="w-4 h-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight text-white num-tabular mb-1 font-mono">
          {formatTons(totalNetKg)}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>{formatKg(totalNetKg)}</span>
          <span className="text-emerald-400 font-medium">{completed.length} Completed Trips</span>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
          <span>Gross: {formatTons(totalGrossKg)}</span>
          <span>Tare: {formatTons(totalTareKg)}</span>
        </div>
      </div>

      {/* 2. Total Trips & Completion Rate */}
      <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group hover:border-cyan-500/30 transition-all shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
          <span>Total Scale Transactions</span>
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
            <Truck className="w-4 h-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight text-white num-tabular mb-1 font-mono">
          {tickets.length}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1 text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {completed.length} Done
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-amber-400 font-medium">{pending.length} Pending</span>
          <span className="text-slate-600">•</span>
          <span className="text-rose-400 font-medium">{deleted.length} Del</span>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <ArrowDownLeft className="w-3 h-3 text-cyan-400" /> {inboundCount} Inbound
          </span>
          <span className="flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3 text-indigo-400" /> {outboundCount} Outbound
          </span>
        </div>
      </div>

      {/* 3. Pending 2nd Weight Vehicles */}
      <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group hover:border-amber-500/30 transition-all shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
          <span>Yard In-Progress</span>
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center ${
              pending.length > 0 ? 'bg-amber-500/20 text-amber-300 animate-pulse' : 'bg-slate-800 text-slate-400'
            }`}
          >
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight text-amber-300 num-tabular mb-1 font-mono">
          {pending.length} <span className="text-xs font-normal text-slate-400">trucks</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Awaiting 2nd Tare/Gross Weight capture
        </p>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px]">
          <span className="text-slate-500">Active yard queue:</span>
          <span className="text-amber-400 font-mono font-medium">{pending.length} on-site</span>
        </div>
      </div>

      {/* 4. Audit & Anomaly Sentinel */}
      <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group hover:border-indigo-500/30 transition-all shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
          <span>Security &amp; Audit Sentinel</span>
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight text-amber-300 num-tabular mb-1 font-mono">
          {overridden.length} <span className="text-xs font-normal text-slate-400">overrides</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Supervisor Anomaly Overrides Logged
        </p>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
          <span className="text-slate-400">Voided: <strong className="text-slate-300">{voided.length}</strong></span>
          <span className="text-rose-400">Deleted: <strong>{deleted.length}</strong></span>
        </div>
      </div>
    </div>
  );
}
