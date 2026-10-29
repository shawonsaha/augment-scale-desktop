'use client';

import { WeighTicket } from '@/lib/types';
import { formatKg, formatTons, formatDateTime } from '@/lib/utils';
import { 
  X, 
  Scale, 
  Truck, 
  User, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Clock, 
  ShieldCheck, 
  AlertCircle,
  Printer
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  ticket: WeighTicket | null;
  onClose: () => void;
}

export function TicketDetailModal({ ticket, onClose }: Props) {
  if (!ticket) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="glass-panel-elevated w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl relative border border-white/15"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center font-bold text-sm">
                #{ticket.ticket_display_id || ticket.ticket_number}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Ticket Details
                  </h2>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase ${
                    ticket.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : ticket.status === 'pending'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    {ticket.status}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {ticket.direction}BOUND
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  Captured at: {formatDateTime(ticket.created_at)}
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

          {/* Body Content */}
          <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
            {/* Vehicle & Customer Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-slate-900/60 border border-white/5">
              <div>
                <span className="text-[11px] text-slate-400 font-medium">Vehicle Plate</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-sm tracking-wide">
                    {ticket.plate_number}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium">Customer / Party</span>
                <p className="mt-1 text-sm font-semibold text-slate-200">
                  {ticket.customer_name || 'Standard Account'}
                </p>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium">Driver</span>
                <p className="mt-1 text-xs text-slate-300">
                  {ticket.driver_name || '—'} {ticket.driver_phone ? `(${ticket.driver_phone})` : ''}
                </p>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-medium">Product / Material</span>
                <p className="mt-1 text-xs text-slate-300">
                  {ticket.product_name || 'Scrap Material'}
                </p>
              </div>
            </div>

            {/* Weights Breakdown Cockpit */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                Scale Weights Telemetry
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                  <span className="text-[11px] text-cyan-300 font-medium">1st Weight ({ticket.first_weight_type || 'Gross'})</span>
                  <div className="text-lg font-bold text-white num-tabular mt-1">
                    {formatKg(ticket.first_weight_kg)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatDateTime(ticket.first_weight_at || ticket.created_at)}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                  <span className="text-[11px] text-indigo-300 font-medium">2nd Weight ({ticket.second_weight_type || 'Tare'})</span>
                  <div className="text-lg font-bold text-white num-tabular mt-1">
                    {formatKg(ticket.second_weight_kg)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {ticket.second_weight_at ? formatDateTime(ticket.second_weight_at) : 'Pending Scale'}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-center">
                  <span className="text-[11px] text-emerald-300 font-medium">Net Weight Cargo</span>
                  <div className="text-xl font-extrabold text-emerald-300 num-tabular mt-1">
                    {formatTons(ticket.net_weight_kg)}
                  </div>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {formatKg(ticket.net_weight_kg)}
                  </span>
                </div>
              </div>
            </div>

            {/* Operator & System Audit */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/5 space-y-1">
                <span className="text-slate-400 text-[11px]">First Operator</span>
                <p className="font-medium text-slate-200">
                  {ticket.first_operator_name || 'MD. RAJU'}
                </p>
                <span className="text-[10px] text-slate-500 font-mono">ID: {ticket.first_operator_id || 'mr'}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/5 space-y-1">
                <span className="text-slate-400 text-[11px]">Second Operator</span>
                <p className="font-medium text-slate-200">
                  {ticket.second_operator_name || (ticket.status === 'completed' ? 'MD. RAJU' : 'Pending')}
                </p>
                <span className="text-[10px] text-slate-500 font-mono">ID: {ticket.second_operator_id || '—'}</span>
              </div>
            </div>

            {ticket.remarks && (
              <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/5 text-xs">
                <span className="text-slate-400 text-[11px] block mb-1">Remarks</span>
                <p className="text-slate-300">{ticket.remarks}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 bg-slate-900/40">
            <span className="font-mono text-[11px]">
              Row Version: {ticket.row_version} • Sync: Supabase Live
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
