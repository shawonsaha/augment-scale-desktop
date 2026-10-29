const fs = require('fs');
const path = require('path');

const webSrc = path.resolve(__dirname, '../../dashboard-web/src');

// ==========================================
// 1. types.ts
// ==========================================
const typesTs = `export interface WeighTicket {
  id: string;
  organization_id: string;
  site_id: string;
  weighbridge_id: string;
  workstation_id: string;
  ticket_number: number;
  ticket_display_id: string;
  direction: 'IN' | 'OUT';
  status: 'pending' | 'completed' | 'voided';
  vehicle_id?: string | null;
  plate_number: string;
  product_id?: string | null;
  product_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  challan?: string | null;
  remarks?: string | null;
  first_weight_kg?: number | null;
  first_weight_type?: string | null;
  first_weight_at?: string | null;
  first_weight_capture_id?: string | null;
  first_operator_id?: string | null;
  first_operator_name?: string | null;
  second_weight_kg?: number | null;
  second_weight_type?: string | null;
  second_weight_at?: string | null;
  second_weight_capture_id?: string | null;
  second_operator_id?: string | null;
  second_operator_name?: string | null;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  net_weight_kg?: number | null;
  is_overridden: boolean;
  override_reason?: string | null;
  override_operator_id?: string | null;
  override_operator_name?: string | null;
  override_anomaly_details?: string | null;
  override_at?: string | null;
  completed_at?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  voided_reason?: string | null;
  row_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
  synced_at: string;
  status_display?: string;
  stage?: string;
  business_at?: string;
  last_status_at?: string;
  print_count?: number;
  first_operator_avatar?: string | null;
  second_operator_avatar?: string | null;
  print_jobs?: PrintJobEntry[];
}

export interface PrintJobEntry {
  id: string;
  ticket_id: string;
  document_type: string;
  is_reprint: boolean;
  copy_number: number;
  reprint_reason?: string | null;
  printed_by?: string | null;
  printed_at: string;
}

export interface Vehicle {
  id: string;
  organization_id: string;
  plate_number: string;
  plate_normalized: string;
  default_driver_name?: string | null;
  default_driver_phone?: string | null;
  default_client?: string | null;
  default_material?: string | null;
  notes?: string | null;
  trip_count: number;
  last_weighed_at?: string | null;
  last_tare_kg?: number | null;
  registered_by?: string | null;
  updated_by?: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface TicketCorrection {
  id: string;
  ticket_id: string;
  organization_id: string;
  correction_type: string;
  field_changed?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  reason: string;
  requested_by: string;
  requested_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_status?: string | null;
  created_at: string;
  synced_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  display_name: string;
  first_name?: string | null;
  initials?: string | null;
  avatar_url?: string | null;
  color?: string | null;
  shift?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  profile_id: string;
  organization_id: string;
  site_id?: string | null;
  role: string;
  granted_at: string;
  granted_by?: string | null;
}

export interface Weighbridge {
  id: string;
  site_id: string;
  name: string;
  max_capacity_kg?: number | null;
  min_division_kg?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Workstation {
  id: string;
  organization_id: string;
  site_id: string;
  weighbridge_id: string;
  hostname?: string | null;
  device_key_thumbprint?: string | null;
  registered_at: string;
  last_seen_at?: string | null;
  settings?: string | null;
  created_at: string;
  updated_at: string;
}
`;

// ==========================================
// 2. utils.ts
// ==========================================
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
`;

// ==========================================
// 3. live-activity-stream.tsx
// ==========================================
const liveActivityStreamTsx = `'use client';

import { useState } from 'react';
import { WeighTicket } from '@/lib/types';
import { getTicketStatus, formatWeightNumber, formatFullDateTime, cn } from '@/lib/utils';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  SlidersHorizontal,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { TicketDetailModal } from './ticket-detail-modal';

interface Props {
  initialTickets: WeighTicket[];
}

export function LiveActivityStream({ initialTickets }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<WeighTicket | null>(null);
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'completed' | 'pending' | 'voided' | 'deleted' | 'overridden'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = initialTickets.filter((t) => {
    const status = getTicketStatus(t);

    if (directionFilter !== 'ALL' && t.direction !== directionFilter) {
      return false;
    }

    if (statusFilter === 'overridden') {
      if (!t.is_overridden) return false;
    } else if (statusFilter !== 'ALL') {
      if (status !== statusFilter) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchPlate = t.plate_number?.toLowerCase().includes(q);
      const matchDriver = t.driver_name?.toLowerCase().includes(q);
      const matchTicket = String(t.ticket_number).includes(q) || t.ticket_display_id?.toLowerCase().includes(q);
      if (!matchPlate && !matchDriver && !matchTicket) return false;
    }

    return true;
  });

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

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Direction Filter */}
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

            {/* Status Filter */}
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
                  <p className="text-sm">No tickets found matching current criteria.</p>
                  <p className="text-xs text-slate-600 mt-1">Try clearing filters or search query.</p>
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

                    {/* TRUCK / DRIVER: Plate badge + Driver name underneath */}
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

                    {/* FIRST WEIGHT: Value, Operator name, Full timestamp */}
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

                    {/* SECOND WEIGHT: Value/Pending, Operator name, Timestamp */}
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

                    {/* NET: Negative/zero highlighted in rose pill, normal bold, pending dash */}
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

                    {/* STATUS: Pill + Overridden badge */}
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

                    {/* PRINTS BADGE */}
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

      {/* Footer Ledger Bar (Matches Desktop: "X tickets · Y MT net") */}
      <div className="px-5 py-3 border-t border-white/8 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span>Showing <strong className="text-white">{filtered.length}</strong> of {initialTickets.length} tickets</span>
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
    </div>
  );
}
`;

// ==========================================
// 4. ticket-detail-modal.tsx
// ==========================================
const ticketDetailModalTsx = `'use client';

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
`;

// ==========================================
// 5. stats-cards.tsx
// ==========================================
const statsCardsTsx = `import { WeighTicket } from '@/lib/types';
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
            className={\`w-8 h-8 rounded-xl flex items-center justify-center \${
              pending.length > 0 ? 'bg-amber-500/20 text-amber-300 animate-pulse' : 'bg-slate-800 text-slate-400'
            }\`}
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
`;

// ==========================================
// 6. dashboard/page.tsx
// ==========================================
const dashboardPageTsx = `export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WorkstationStatusPill } from '@/components/workstation-status-pill';
import { StatsCards } from '@/components/stats-cards';
import { ActivityChart } from '@/components/activity-chart';
import { LiveActivityStream } from '@/components/live-activity-stream';
import { WeighTicket, Workstation, Weighbridge, PrintJobEntry } from '@/lib/types';

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
    <div className="space-y-6">
      {/* Live Scale & Workstation Health Strip */}
      <WorkstationStatusPill workstation={workstation} weighbridge={weighbridge} />

      {/* Key Performance Indicators */}
      <StatsCards tickets={tickets} />

      {/* Middle Row: Analytics Chart & Live Monitor */}
      <ActivityChart tickets={tickets} />

      {/* Live Activity Stream & Inspection Table */}
      <LiveActivityStream initialTickets={tickets} />
    </div>
  );
}
`;

// ==========================================
// 7. dashboard/tickets/page.tsx
// ==========================================
const ticketsPageTsx = `export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WeighTicket, PrintJobEntry } from '@/lib/types';
import { LiveActivityStream } from '@/components/live-activity-stream';
import { HardDriveDownload } from 'lucide-react';
import Link from 'next/link';

export default async function TicketsPage() {
  const supabase = await createClient();

  const [ticketsRes, printJobsRes] = await Promise.all([
    supabase
      .from('ticket_history')
      .select('*')
      .order('ticket_number', { ascending: false }),
    supabase.from('print_jobs').select('*'),
  ]);

  const rawTickets = (ticketsRes.data || []) as WeighTicket[];
  const printJobs = (printJobsRes.data || []) as PrintJobEntry[];

  const tickets: WeighTicket[] = rawTickets.map((t) => {
    const jobs = printJobs.filter((pj) => pj.ticket_id === t.id);
    return {
      ...t,
      print_jobs: jobs,
      print_count: Math.max(t.print_count || 0, jobs.length),
    };
  });

  return (
    <div className="space-y-6">
      {/* Page Title & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Weight Tickets Ledger
          </h1>
          <p className="text-xs text-slate-400">
            Comprehensive audit registry for all weighbridge captures, overrides, and transactions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/backup"
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white/10 hover:bg-white/15 text-white flex items-center gap-2 transition-all border border-white/10"
          >
            <HardDriveDownload className="w-3.5 h-3.5 text-emerald-400" />
            Backup Database
          </Link>
        </div>
      </div>

      {/* Tickets Ledger Table */}
      <LiveActivityStream initialTickets={tickets} />
    </div>
  );
}
`;

// Write all files
fs.writeFileSync(path.join(webSrc, 'lib/types.ts'), typesTs, 'utf8');
console.log('Written: lib/types.ts');

fs.writeFileSync(path.join(webSrc, 'lib/utils.ts'), utilsTs, 'utf8');
console.log('Written: lib/utils.ts');

fs.writeFileSync(path.join(webSrc, 'components/live-activity-stream.tsx'), liveActivityStreamTsx, 'utf8');
console.log('Written: components/live-activity-stream.tsx');

fs.writeFileSync(path.join(webSrc, 'components/ticket-detail-modal.tsx'), ticketDetailModalTsx, 'utf8');
console.log('Written: components/ticket-detail-modal.tsx');

fs.writeFileSync(path.join(webSrc, 'components/stats-cards.tsx'), statsCardsTsx, 'utf8');
console.log('Written: components/stats-cards.tsx');

fs.writeFileSync(path.join(webSrc, 'app/dashboard/page.tsx'), dashboardPageTsx, 'utf8');
console.log('Written: app/dashboard/page.tsx');

fs.writeFileSync(path.join(webSrc, 'app/dashboard/tickets/page.tsx'), ticketsPageTsx, 'utf8');
console.log('Written: app/dashboard/tickets/page.tsx');

console.log('All dashboard history updates written successfully!');
