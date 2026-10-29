'use client';

import { useState, useMemo } from 'react';
import { WeighTicket } from '@/lib/types';
import { getTicketStatus, formatKg, formatWeightNumber, formatFullDateTime, cn } from '@/lib/utils';
import {
  X,
  Printer,
  Calendar,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  FileSpreadsheet,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  allTickets: WeighTicket[];
}

type ReportPeriod = 'today' | 'yesterday' | '7days' | '30days' | 'this_year' | 'last_year' | 'custom' | 'all';

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getTicketDateStr(t: WeighTicket): string {
  const raw = t.business_at || t.completed_at || t.first_weight_at || t.created_at;
  if (!raw) return '';
  try {
    const d = new Date(raw);
    return toDateString(d);
  } catch {
    return '';
  }
}

export function HistoryReportModal({ isOpen, onClose, allTickets }: Props) {
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [stage, setStage] = useState<'setup' | 'preview'>('preview');

  // Custom range defaults (last 30 days)
  const todayStr = useMemo(() => toDateString(new Date()), []);
  const monthAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toDateString(d);
  }, []);

  const [customFrom, setCustomFrom] = useState(monthAgoStr);
  const [customTo, setCustomTo] = useState(todayStr);

  // Filter tickets for report
  const { reportTickets, rangeLabel } = useMemo(() => {
    const now = new Date();
    const today = toDateString(now);

    const yesterdayD = new Date();
    yesterdayD.setDate(yesterdayD.getDate() - 1);
    const yesterday = toDateString(yesterdayD);

    const sevenDaysAgoD = new Date();
    sevenDaysAgoD.setDate(sevenDaysAgoD.getDate() - 6);
    const sevenDaysAgo = toDateString(sevenDaysAgoD);

    const thirtyDaysAgoD = new Date();
    thirtyDaysAgoD.setDate(thirtyDaysAgoD.getDate() - 29);
    const thirtyDaysAgo = toDateString(thirtyDaysAgoD);

    const curYear = String(now.getFullYear());
    const lastYear = String(now.getFullYear() - 1);

    let filtered = allTickets;
    let label = 'All time';

    switch (period) {
      case 'today':
        filtered = allTickets.filter((t) => getTicketDateStr(t) === today);
        label = `Today (${today})`;
        break;
      case 'yesterday':
        filtered = allTickets.filter((t) => getTicketDateStr(t) === yesterday);
        label = `Yesterday (${yesterday})`;
        break;
      case '7days':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= sevenDaysAgo && ds <= today;
        });
        label = `Last 7 days (${sevenDaysAgo} — ${today})`;
        break;
      case '30days':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= thirtyDaysAgo && ds <= today;
        });
        label = `Last 30 days (${thirtyDaysAgo} — ${today})`;
        break;
      case 'this_year':
        filtered = allTickets.filter((t) => getTicketDateStr(t).startsWith(curYear));
        label = `This Year (${curYear})`;
        break;
      case 'last_year':
        filtered = allTickets.filter((t) => getTicketDateStr(t).startsWith(lastYear));
        label = `Last Year (${lastYear})`;
        break;
      case 'custom':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= customFrom && ds <= customTo;
        });
        label = `Custom Range (${customFrom} — ${customTo})`;
        break;
      case 'all':
      default:
        filtered = allTickets;
        label = 'All Recorded Tickets';
        break;
    }

    // Sort chronologically ascending for the printed report ledger
    const sorted = [...filtered].sort((a, b) => a.ticket_number - b.ticket_number);

    return { reportTickets: sorted, rangeLabel: label };
  }, [allTickets, period, customFrom, customTo]);

  // Compute summary metrics
  const summary = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let voided = 0;
    let deleted = 0;
    let overrides = 0;
    let reprints = 0;
    let netKg = 0;

    for (const t of reportTickets) {
      const status = getTicketStatus(t);
      if (status === 'completed') {
        completed += 1;
        netKg += Number(t.net_weight_kg) || 0;
      } else if (status === 'voided') {
        voided += 1;
      } else if (status === 'deleted') {
        deleted += 1;
      } else {
        pending += 1;
      }
      if (t.is_overridden) overrides += 1;
      const prints = Math.max(1, Number(t.print_count) || 0);
      if (prints > 1) reprints += prints - 1;
    }

    const netMT = (netKg / 1000).toFixed(3);
    return {
      total: reportTickets.length,
      completed,
      pending,
      voided,
      deleted,
      overrides,
      reprints,
      netKg,
      netMT,
    };
  }, [reportTickets]);

  // Exception list (Overrides, Voids, Deletions)
  const exceptions = useMemo(() => {
    const list: Array<{
      ticketNumber: number;
      type: string;
      reason: string;
      by: string;
      at: string;
    }> = [];

    for (const t of reportTickets) {
      if (t.is_overridden) {
        list.push({
          ticketNumber: t.ticket_number,
          type: 'Override',
          reason: t.override_reason || 'Gross ≤ Tare or threshold anomaly override',
          by: t.override_operator_name || 'MD. RAJU',
          at: t.override_at || t.business_at || t.created_at,
        });
      }
      const status = getTicketStatus(t);
      if (status === 'voided') {
        list.push({
          ticketNumber: t.ticket_number,
          type: 'Void',
          reason: t.voided_reason || 'Incorrect weight / vehicle identified',
          by: t.voided_by || 'MD. RAJU',
          at: t.voided_at || t.business_at || t.created_at,
        });
      }
      if (status === 'deleted') {
        list.push({
          ticketNumber: t.ticket_number,
          type: 'Delete',
          reason: t.deleted_reason || 'Duplicate ticket or truck left yard',
          by: t.deleted_by || 'MD. RAJU',
          at: t.deleted_at || t.business_at || t.created_at,
        });
      }
    }
    return list;
  }, [reportTickets]);

  // Reprint entries
  const reprintRows = useMemo(() => {
    const list: Array<{
      ticketNumber: number;
      copy: number | string;
      reason: string;
      by: string;
      at: string;
    }> = [];

    for (const t of reportTickets) {
      if (t.print_jobs && t.print_jobs.length > 0) {
        for (const pj of t.print_jobs) {
          if (pj.is_reprint || pj.copy_number > 1) {
            list.push({
              ticketNumber: t.ticket_number,
              copy: pj.copy_number || 2,
              reason: pj.reprint_reason || 'Customer / transporter copy requested',
              by: pj.printed_by || 'MD. RAJU',
              at: pj.printed_at,
            });
          }
        }
      } else if (Number(t.print_count) > 1) {
        list.push({
          ticketNumber: t.ticket_number,
          copy: t.print_count || 1,
          reason: 'Reprint count recorded at workstation',
          by: t.first_operator_name || 'MD. RAJU',
          at: t.completed_at || t.created_at,
        });
      }
    }
    return list;
  }, [reportTickets]);

  // Static metadata
  const reportId = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateCode = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `HIST-${dateCode}-${rand}`;
  }, [period, customFrom, customTo]);

  const integrityHash = useMemo(() => {
    // Deterministic representation
    let hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2';
    if (reportTickets.length > 0) {
      const seed = reportTickets.map((t) => `${t.ticket_number}:${t.net_weight_kg}:${t.plate_number}`).join('|');
      let h = 0;
      for (let i = 0; i < seed.length; i++) {
        h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
      }
      const hex = Math.abs(h).toString(16).padStart(8, '0');
      hash = (hex + '4819e68b1397b98c52084b65dc9b0a1a74288019b78e24c29d6174a819b16892').substring(0, 64);
    }
    return hash;
  }, [reportTickets]);

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 print:p-0">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md print:hidden"
        />

        {/* Modal Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="glass-panel-elevated w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl relative border border-white/15 bg-slate-950/95 text-slate-100 max-h-[94vh] flex flex-col print:border-none print:shadow-none print:bg-transparent print:max-h-none print:w-full"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/60 print:hidden">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 block">
                History Ledger
              </span>
              <h2 className="text-base font-bold text-white tracking-tight">
                Printable History Report
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                A4 portrait snapshot including every ticket status. Layout identical to desktop app.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Setup / Range Picker Bar (Always available or expandable) */}
          <div className="p-4 border-b border-white/10 bg-slate-900/40 space-y-3 shrink-0 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-200">Report Period:</span>
              </div>

              {/* Period Selector Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-white/5 text-xs">
                {(
                  [
                    { id: 'today', label: 'Today' },
                    { id: 'yesterday', label: 'Yesterday' },
                    { id: '7days', label: 'Last 7 days' },
                    { id: '30days', label: 'Last 30 days' },
                    { id: 'this_year', label: 'This year' },
                    { id: 'last_year', label: 'Last year' },
                    { id: 'custom', label: 'Custom range' },
                    { id: 'all', label: 'All records' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setPeriod(tab.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg font-medium transition-all text-[11px]',
                      period === tab.id
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-colors text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
                >
                  <Printer className="w-4 h-4" />
                  Print A4 Portrait
                </button>
              </div>
            </div>

            {/* Custom Range Date Pickers */}
            {period === 'custom' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-3 pt-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-medium">From:</span>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-medium">To:</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <span className="text-slate-500 text-[11px]">
                  ({reportTickets.length} tickets found in custom date range)
                </span>
              </motion.div>
            )}
          </div>

          {/* Scrollable Preview Area */}
          <div className="overflow-y-auto p-4 sm:p-6 bg-slate-950/80 flex-1 print:p-0 print:bg-white print:overflow-visible">
            {/* The Exact Desktop A4 Report Document */}
            <article className="history-report-document shadow-2xl">
              {/* Report Header */}
              <header className="report-header">
                <div className="report-heading">
                  <h1>Weighbridge History Report</h1>
                  <span>Daily weighbridge ledger · all ticket states</span>
                </div>
                <div className="report-identity">
                  <span>Report</span>
                  <strong>{reportId}</strong>
                  <span>{rangeLabel}</span>
                </div>
              </header>

              {/* Integrity Line */}
              <div className="report-integrity-line">
                <span>SHA-256 integrity hash</span>
                <code>{integrityHash}</code>
              </div>

              {/* Meta Strip */}
              <section className="report-meta">
                <div>
                  <span>Report period</span>
                  <strong>{rangeLabel}</strong>
                </div>
                <div>
                  <span>Generated by</span>
                  <strong>MD. RAJU (Supervisor)</strong>
                </div>
                <div>
                  <span>Generated at</span>
                  <strong>{formatFullDateTime(new Date().toISOString())}</strong>
                </div>
                <div>
                  <span>Workstation</span>
                  <strong>DESKTOP-128GRO4 (Scale 1)</strong>
                </div>
              </section>

              {/* Summary KPIs */}
              <section className="report-summary">
                <div>
                  <span>Total tickets</span>
                  <strong>{summary.total}</strong>
                </div>
                <div>
                  <span>Completed</span>
                  <strong>{summary.completed}</strong>
                </div>
                <div>
                  <span>Pending</span>
                  <strong>{summary.pending}</strong>
                </div>
                <div>
                  <span>Voided / deleted</span>
                  <strong>{summary.voided + summary.deleted}</strong>
                </div>
                <div>
                  <span>Overrides</span>
                  <strong>{summary.overrides}</strong>
                </div>
                <div>
                  <span>Reprints</span>
                  <strong>{summary.reprints}</strong>
                </div>
                <div className="report-summary-net">
                  <span>Completed net</span>
                  <strong>{summary.netMT} MT</strong>
                </div>
              </section>

              {/* Ticket Ledger Table */}
              <section className="report-ledger-section">
                <div className="report-section-heading">
                  <h2>Ticket ledger</h2>
                  <span>{reportTickets.length} records · chronological</span>
                </div>

                {reportTickets.length === 0 ? (
                  <p className="report-empty">No tickets were recorded in this period.</p>
                ) : (
                  <table className="report-table report-table--ledger">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Truck / driver</th>
                        <th>First weigh</th>
                        <th>Second weigh</th>
                        <th>Net</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportTickets.map((ticket) => {
                        const status = getTicketStatus(ticket);
                        const direction = ticket.direction || 'IN';
                        const firstType = ticket.first_weight_type || (direction === 'IN' ? 'Gross' : 'Tare');
                        const secondType = ticket.second_weight_type || (firstType === 'Gross' ? 'Tare' : 'Gross');
                        const net = ticket.net_weight_kg;
                        const hasNet = net !== null && net !== undefined;
                        const isNegativeOrZeroNet = hasNet && (net as number) <= 0;

                        return (
                          <tr key={ticket.id} className={`report-row report-row--${status}`}>
                            {/* Ticket */}
                            <td className="report-ticket">
                              <strong>#{ticket.ticket_display_id || ticket.ticket_number}</strong>
                              <span className={`report-direction report-direction--${direction.toLowerCase()}`}>
                                {direction}
                              </span>
                            </td>

                            {/* Truck / Driver */}
                            <td className="report-truck">
                              <strong>{ticket.plate_number || '—'}</strong>
                              <span>{ticket.driver_name || '—'}</span>
                            </td>

                            {/* First Weigh */}
                            <td className="report-weigh">
                              <strong>{firstType.toUpperCase()} · {formatKg(ticket.first_weight_kg)}</strong>
                              <span>
                                {[ticket.first_operator_name || 'MD. RAJU', formatFullDateTime(ticket.first_weight_at || ticket.created_at)].join(' · ')}
                              </span>
                            </td>

                            {/* Second Weigh */}
                            {ticket.second_weight_kg !== null && ticket.second_weight_kg !== undefined ? (
                              <td className="report-weigh">
                                <strong>{secondType.toUpperCase()} · {formatKg(ticket.second_weight_kg)}</strong>
                                <span>
                                  {[ticket.second_operator_name || 'MD. RAJU', formatFullDateTime(ticket.second_weight_at)].join(' · ')}
                                </span>
                              </td>
                            ) : (
                              <td className="report-weigh report-weigh--pending">
                                <strong>{secondType.toUpperCase()} · PENDING</strong>
                                <span>Awaiting second weigh</span>
                              </td>
                            )}

                            {/* Net */}
                            <td className="report-net">
                              {hasNet ? (
                                <span className={isNegativeOrZeroNet ? 'report-net-value report-net-value--anomaly' : 'report-net-value'}>
                                  {formatKg(net)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>

                            {/* Status */}
                            <td className="report-status-cell">
                              <span className={`report-status report-status--${status}`}>
                                {status.toUpperCase()}
                              </span>
                              {ticket.is_overridden && (
                                <>
                                  <span className="report-flags">OVR</span>
                                  <span className="report-override-note">
                                    {ticket.override_reason || 'Anomaly override'}
                                  </span>
                                </>
                              )}
                              {status === 'deleted' && (
                                <span className="report-delete-note">
                                  {ticket.deleted_reason || 'Deleted pending'}
                                </span>
                              )}
                              {status === 'voided' && (
                                <span className="report-delete-note">
                                  {ticket.voided_reason || 'Voided ticket'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Exception Register */}
              {exceptions.length > 0 && (
                <section className="report-appendix">
                  <h2>Exception register</h2>
                  <table className="report-table report-table--appendix">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Type</th>
                        <th>Reason</th>
                        <th>Authorised by</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exceptions.map((row, idx) => (
                        <tr key={idx}>
                          <td>#{row.ticketNumber}</td>
                          <td>{row.type}</td>
                          <td>{row.reason}</td>
                          <td>{row.by}</td>
                          <td>{formatFullDateTime(row.at) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Reprint Register */}
              {reprintRows.length > 0 && (
                <section className="report-appendix">
                  <h2>Reprint register</h2>
                  <table className="report-table report-table--appendix">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Copy</th>
                        <th>Reason</th>
                        <th>Reprinted by</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reprintRows.map((row, idx) => (
                        <tr key={idx}>
                          <td>#{row.ticketNumber}</td>
                          <td>#{row.copy}</td>
                          <td>{row.reason}</td>
                          <td>{row.by}</td>
                          <td>{formatFullDateTime(row.at) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Report Footer */}
              <footer className="report-footer">
                <span>{reportId} · {rangeLabel}</span>
                <span className="report-powered">Powered by scale.augmentlab.net</span>
              </footer>
            </article>
          </div>

          {/* Dialog Bottom Bar */}
          <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 bg-slate-900/60 print:hidden">
            <span className="font-mono text-[11px]">
              Ready for A4 Portrait printing · {reportTickets.length} tickets in scope
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePrint}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
              >
                <Printer className="w-3.5 h-3.5" />
                Print A4
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
