'use client';

import { WeighTicket } from '@/lib/types';
import { getTicketStatus, formatKg, formatTons, formatWeightNumber, formatFullDateTime, cn } from '@/lib/utils';
import {
  X,
  Truck,
  User,
  Scale,
  Calendar,
  Phone,
  FileText,
  AlertTriangle,
  Trash2,
  Ban,
  Printer,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  ticket: WeighTicket | null;
  onClose: () => void;
}

export function TicketDetailModal({ ticket, onClose }: Props) {
  if (!ticket) return null;

  const status = getTicketStatus(ticket);
  const printCount = Math.max(1, Number(ticket.print_count) || 0);
  const hasNet = ticket.net_weight_kg !== null && ticket.net_weight_kg !== undefined;
  const isNegativeOrZeroNet = hasNet && (ticket.net_weight_kg as number) <= 0;

  // Anomaly details parser
  let parsedAnomaly: Record<string, any> | null = null;
  if (ticket.override_anomaly_details) {
    try {
      parsedAnomaly = JSON.parse(ticket.override_anomaly_details);
    } catch {
      parsedAnomaly = null;
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="glass-panel-elevated w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl relative border border-white/15 bg-slate-950/90 text-slate-100 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-bold font-mono text-base shadow-sm">
                #{ticket.ticket_display_id || ticket.ticket_number}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Ticket Audit Inspection
                  </h2>
                  {status === 'completed' && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      ✓ Completed
                    </span>
                  )}
                  {status === 'pending' && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                      ◌ Pending 2nd
                    </span>
                  )}
                  {status === 'voided' && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/50">
                      ⊘ Voided
                    </span>
                  )}
                  {status === 'deleted' && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      ✕ Deleted
                    </span>
                  )}
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase',
                      ticket.direction === 'IN'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    )}
                  >
                    {ticket.direction}BOUND
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Business Time: {formatFullDateTime(ticket.business_at || ticket.created_at)}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Scrollable Body */}
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {/* 1. AUDIT CALLOUTS: Override / Deletion / Void Warnings */}
            {ticket.is_overridden && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-amber-300">
                    Supervisor Override Anomaly Logged
                  </h4>
                </div>
                <p className="text-xs font-medium text-amber-100 bg-amber-950/40 p-2.5 rounded-xl border border-amber-500/20">
                  {ticket.override_reason || 'Anomaly overridden by supervisor authorization.'}
                </p>
                <div className="flex flex-wrap items-center justify-between text-[11px] text-amber-300/80 pt-1 font-mono">
                  <span>Authorised by: <strong className="text-amber-200">{ticket.override_operator_name || 'MD. RAJU'}</strong></span>
                  <span>{formatFullDateTime(ticket.override_at)}</span>
                </div>
                {parsedAnomaly ? (
                  <div className="mt-2 pt-2 border-t border-amber-500/20 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                    <div>Type: <strong className="text-white">{parsedAnomaly.type}</strong></div>
                    <div>Gross: <strong className="text-white">{parsedAnomaly.gross} kg</strong></div>
                    <div>Tare: <strong className="text-white">{parsedAnomaly.tare} kg</strong></div>
                    <div>Net: <strong className="text-rose-300">{parsedAnomaly.net} kg</strong></div>
                  </div>
                ) : ticket.override_anomaly_details ? (
                  <p className="text-[11px] text-amber-300/70 font-mono mt-1">
                    {ticket.override_anomaly_details}
                  </p>
                ) : null}
              </div>
            )}

            {ticket.deleted_at && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 space-y-2">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-rose-300">
                    Ticket Deleted While Pending
                  </h4>
                </div>
                <p className="text-xs font-medium text-rose-100 bg-rose-950/40 p-2.5 rounded-xl border border-rose-500/20">
                  {ticket.deleted_reason || 'No deletion reason recorded.'}
                </p>
                <div className="flex flex-wrap items-center justify-between text-[11px] text-rose-300/80 pt-1 font-mono">
                  <span>Deleted by: <strong className="text-rose-200">{ticket.deleted_by || 'MD. RAJU'}</strong></span>
                  <span>{formatFullDateTime(ticket.deleted_at)}</span>
                </div>
              </div>
            )}

            {ticket.voided_at && (
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-rose-500/30 text-rose-200 space-y-2">
                <div className="flex items-center gap-2">
                  <Ban className="w-4 h-4 text-rose-400 shrink-0" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-rose-300">
                    Ticket Voided
                  </h4>
                </div>
                <p className="text-xs font-medium text-rose-100 bg-rose-950/40 p-2.5 rounded-xl border border-rose-500/20">
                  {ticket.voided_reason || 'No void reason recorded.'}
                </p>
                <div className="flex flex-wrap items-center justify-between text-[11px] text-rose-300/80 pt-1 font-mono">
                  <span>Voided by: <strong className="text-rose-200">{ticket.voided_by || 'MD. RAJU'}</strong></span>
                  <span>{formatFullDateTime(ticket.voided_at)}</span>
                </div>
              </div>
            )}

            {/* 2. SCALE WEIGHTS TELEMETRY */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-cyan-400" />
                Scale Weights Telemetry
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1st Weight */}
                <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/20 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] text-cyan-300 font-semibold">
                      1st Weigh ({ticket.first_weight_type || 'Gross'})
                    </span>
                    <div className="text-2xl font-bold text-white num-tabular font-mono mt-1">
                      {formatKg(ticket.first_weight_kg)}
                    </div>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-cyan-500/10 space-y-0.5">
                    <div className="text-[11px] text-slate-300 font-medium">
                      By: {ticket.first_operator_name || 'MD. RAJU'}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {formatFullDateTime(ticket.first_weight_at || ticket.created_at)}
                    </div>
                  </div>
                </div>

                {/* 2nd Weight */}
                <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] text-indigo-300 font-semibold">
                      2nd Weigh ({ticket.second_weight_type || 'Tare'})
                    </span>
                    <div className="text-2xl font-bold text-white num-tabular font-mono mt-1">
                      {ticket.second_weight_kg ? formatKg(ticket.second_weight_kg) : '—'}
                    </div>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-indigo-500/10 space-y-0.5">
                    <div className="text-[11px] text-slate-300 font-medium">
                      {ticket.second_weight_kg ? ('By: ' + (ticket.second_operator_name || 'MD. RAJU')) : 'Awaiting 2nd weigh'}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {ticket.second_weight_at ? formatFullDateTime(ticket.second_weight_at) : 'Pending Scale'}
                    </div>
                  </div>
                </div>

                {/* Net Weight */}
                <div
                  className={cn(
                    'p-4 rounded-2xl flex flex-col justify-between border',
                    isNegativeOrZeroNet
                      ? 'bg-rose-950/40 border-rose-500/40'
                      : 'bg-emerald-950/30 border-emerald-500/30'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'text-[11px] font-semibold',
                          isNegativeOrZeroNet ? 'text-rose-300' : 'text-emerald-300'
                        )}
                      >
                        Net Cargo
                      </span>
                      {isNegativeOrZeroNet && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold uppercase">
                          Anomaly
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'text-2xl font-black num-tabular font-mono mt-1',
                        isNegativeOrZeroNet ? 'text-rose-300' : 'text-emerald-300'
                      )}
                    >
                      {hasNet ? formatKg(ticket.net_weight_kg) : '— kg'}
                    </div>
                  </div>
                  <div
                    className={cn(
                      'mt-3 pt-2.5 border-t text-[11px] font-mono flex items-center justify-between',
                      isNegativeOrZeroNet ? 'border-rose-500/20 text-rose-400' : 'border-emerald-500/20 text-emerald-400'
                    )}
                  >
                    <span>{hasNet ? formatTons(ticket.net_weight_kg) : 'Pending'}</span>
                    <span>Prints: {printCount}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. TRUCK & DRIVER AUDIT */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-cyan-400" />
                Vehicle &amp; Driver Registry
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-900/60 border border-white/5 text-xs">
                <div>
                  <span className="text-[11px] text-slate-500 block">License Plate</span>
                  <span className="mt-1 inline-block px-2 py-0.5 rounded bg-slate-950 border border-white/10 font-mono font-bold text-white text-xs">
                    {ticket.plate_number}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-slate-500 block">Driver Name</span>
                  <p className="mt-1 font-semibold text-slate-200">
                    {ticket.driver_name || '—'}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] text-slate-500 block">Driver Phone</span>
                  <p className="mt-1 font-mono text-slate-300">
                    {ticket.driver_phone || '—'}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] text-slate-500 block">Material</span>
                  <p className="mt-1 text-slate-300 truncate">
                    {ticket.product_name || 'Scrap Material'}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] text-slate-500 block">Challan #</span>
                  <p className="mt-1 font-mono text-slate-300">
                    {ticket.challan || '—'}
                  </p>
                </div>

                <div className="col-span-2 sm:col-span-3">
                  <span className="text-[11px] text-slate-500 block">Remarks</span>
                  <p className="mt-1 text-slate-300 text-xs">
                    {ticket.remarks || 'No special remarks recorded.'}
                  </p>
                </div>
              </div>
            </div>

            {/* 4. PRINT HISTORY AUDIT */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  Print History Log
                </h3>
                <span className="text-xs font-mono text-amber-300 font-semibold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                  Total Prints: {printCount}
                </span>
              </div>

              <div className="rounded-xl border border-white/5 overflow-hidden bg-slate-900/40 text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase font-mono border-b border-white/5">
                    <tr>
                      <th className="py-2 px-3">Copy</th>
                      <th className="py-2 px-3">Document</th>
                      <th className="py-2 px-3">Printed By</th>
                      <th className="py-2 px-3">Timestamp</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[11px]">
                    {ticket.print_jobs && ticket.print_jobs.length > 0 ? (
                      ticket.print_jobs.map((pj, idx) => (
                        <tr key={pj.id || idx}>
                          <td className="py-2 px-3 font-mono font-bold text-cyan-300">#{pj.copy_number || idx + 1}</td>
                          <td className="py-2 px-3 text-slate-200">
                            {pj.is_reprint ? 'Reprint' : pj.document_type || 'Certificate'}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{pj.printed_by || 'MD. RAJU'}</td>
                          <td className="py-2 px-3 font-mono text-slate-400">{formatFullDateTime(pj.printed_at)}</td>
                          <td className="py-2 px-3 text-slate-400">{pj.reprint_reason || '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-2 px-3 font-mono font-bold text-cyan-300">#1</td>
                        <td className="py-2 px-3 text-slate-200">
                          {status === 'completed' ? 'Weighbridge Certificate' : 'First Weigh Slip'}
                        </td>
                        <td className="py-2 px-3 text-slate-300">{ticket.first_operator_name || 'MD. RAJU'}</td>
                        <td className="py-2 px-3 font-mono text-slate-400">
                          {formatFullDateTime(ticket.completed_at || ticket.first_weight_at || ticket.created_at)}
                        </td>
                        <td className="py-2 px-3 text-slate-400">Initial Print</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 shrink-0">
            <span className="font-mono text-[11px]">
              Row Version: {ticket.row_version} · Workstation: {ticket.workstation_id || 'DESKTOP-128GRO4'}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
