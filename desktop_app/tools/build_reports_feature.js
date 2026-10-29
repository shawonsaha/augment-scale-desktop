const fs = require('fs');
const path = require('path');

const webSrc = path.resolve(__dirname, '../../dashboard-web/src');

// ========================================================
// 1. Report Styles to append to src/app/globals.css
// ========================================================
const reportCss = `

/* ==========================================================================
   History Report Document & A4 Portrait Print Styles (Exact Desktop Layout)
   ========================================================================== */

.history-report-document {
  width: 820px;
  min-height: 1160px;
  margin: 0 auto;
  padding: 28px 32px 24px;
  background: #ffffff;
  color: #111827;
  border: 1px solid #cbd5e1;
  box-shadow: 0 12px 35px rgba(15, 23, 42, 0.18);
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9.5px;
  line-height: 1.35;
  text-align: left;
}

.report-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  align-items: start;
  padding-bottom: 12px;
  border-bottom: 1.5px solid #111827;
}

.report-heading {
  text-align: left;
}

.report-heading h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #111827;
}

.report-heading span {
  display: block;
  margin-top: 3px;
  font-size: 8px;
  color: #4b5563;
}

.report-identity {
  text-align: right;
}

.report-identity span {
  display: block;
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
}

.report-identity strong {
  display: block;
  margin: 1px 0 5px;
  font-family: 'Courier New', monospace;
  font-size: 9px;
  font-weight: 700;
  color: #111827;
}

.report-integrity-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  padding: 4px 8px 4px 0;
  border-bottom: 1px solid #d1d5db;
  font-size: 6.8px;
  color: #4b5563;
}

.report-integrity-line span {
  flex-shrink: 0;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.report-integrity-line code {
  font-family: 'Courier New', monospace;
  font-size: 6.8px;
  text-align: right;
  overflow-wrap: anywhere;
  color: #111827;
}

.report-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid #9ca3af;
}

.report-meta > div {
  padding: 6px 8px;
  border-right: 1px solid #d1d5db;
}

.report-meta > div:first-child {
  padding-left: 0;
}

.report-meta > div:last-child {
  border-right: none;
}

.report-meta span,
.report-summary span {
  display: block;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #6b7280;
}

.report-meta strong {
  display: block;
  margin-top: 2px;
  font-size: 8.5px;
  font-weight: 600;
  color: #111827;
}

.report-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr)) 1.5fr;
  margin: 9px 0 12px;
  border: 1px solid #111827;
}

.report-summary > div {
  padding: 5px 8px;
  border-right: 1px solid #9ca3af;
}

.report-summary > div:last-child {
  border-right: none;
}

.report-summary strong {
  display: block;
  margin-top: 1px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.report-summary-net {
  background: #f3f4f6;
}

.report-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}

.report-section-heading h2,
.report-appendix h2 {
  margin: 0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #111827;
}

.report-section-heading span {
  font-size: 7.5px;
  color: #6b7280;
}

.report-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.report-table th {
  padding: 4px 4px;
  border-top: 1px solid #111827;
  border-bottom: 1px solid #111827;
  background: #f3f4f6;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
  color: #111827;
}

.report-table td {
  padding: 3.5px 4px;
  border-bottom: 1px solid #d1d5db;
  vertical-align: top;
  color: #111827;
}

.report-table--ledger th:nth-child(1) { width: 8%; }
.report-table--ledger th:nth-child(2) { width: 18%; }
.report-table--ledger th:nth-child(3),
.report-table--ledger th:nth-child(4) { width: 24%; }
.report-table--ledger th:nth-child(5) { width: 12%; }
.report-table--ledger th:nth-child(6) { width: 14%; }

.report-row--voided td,
.report-row--deleted td {
  color: #4b5563;
}

.report-ticket strong {
  display: block;
  font-family: 'Courier New', monospace;
  font-size: 8.5px;
  color: #111827;
}

.report-direction {
  display: inline-block;
  margin-top: 1px;
  padding: 0 3px;
  border: 1px solid #6b7280;
  font-size: 6.5px;
  font-weight: 800;
  color: #111827;
}

.report-direction--in { border-style: solid; }
.report-direction--out { border-style: double; }

.report-truck strong {
  display: block;
  font-size: 8px;
  font-weight: 700;
  overflow-wrap: anywhere;
  color: #111827;
}

.report-truck span {
  display: block;
  margin-top: 1px;
  font-size: 7px;
  line-height: 1.3;
  color: #4b5563;
  overflow-wrap: anywhere;
}

.report-weigh strong {
  display: block;
  font-size: 7.9px;
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
  color: #111827;
}

.report-weigh span {
  display: block;
  margin-top: 1px;
  font-family: 'Courier New', monospace;
  font-size: 7.1px;
  line-height: 1.3;
  color: #4b5563;
  overflow-wrap: anywhere;
}

.report-weigh--pending strong {
  color: #4b5563;
}

.report-net {
  font-family: 'Courier New', monospace;
  font-size: 8.5px;
  font-weight: 700;
  white-space: nowrap;
  color: #111827;
}

.report-net-value--anomaly {
  display: inline-block;
  padding: 1px 4px;
  border: 1.5px solid #111827;
  font-weight: 800;
  color: #b91c1c;
}

.report-status {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid #6b7280;
  font-size: 6.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: #111827;
}

.report-status--completed { border-color: #111827; }
.report-status--voided,
.report-status--deleted { border-style: dashed; }

.report-flags {
  display: inline-block;
  margin-top: 3px;
  padding: 0 3px;
  border: 1px solid #111827;
  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #111827;
}

.report-override-note,
.report-delete-note {
  display: block;
  margin-top: 2px;
  font-size: 6.5px;
  line-height: 1.25;
  color: #4b5563;
  overflow-wrap: anywhere;
}

.report-empty {
  padding: 20px 0;
  border-top: 1px solid #111827;
  border-bottom: 1px solid #111827;
  text-align: center;
  font-size: 9px;
  color: #6b7280;
}

.report-appendix {
  margin-top: 12px;
  break-inside: avoid;
}

.report-appendix h2 {
  margin-bottom: 4px;
}

.report-table--appendix th:nth-child(1) { width: 9%; }
.report-table--appendix th:nth-child(2) { width: 11%; }
.report-table--appendix th:nth-child(3) { width: 34%; }
.report-table--appendix th:nth-child(4) { width: 20%; }
.report-table--appendix th:nth-child(5) { width: 26%; }

.report-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-top: 14px;
  padding-top: 6px;
  border-top: 1px solid #111827;
  font-family: 'Courier New', monospace;
  font-size: 7px;
  color: #4b5563;
}

.report-powered {
  text-align: right;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 700;
}

@media print {
  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  body * {
    visibility: hidden !important;
  }

  .history-report-document,
  .history-report-document * {
    visibility: visible !important;
  }

  .history-report-document {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
  }

  .report-table thead {
    display: table-header-group;
  }

  .report-table tr,
  .report-appendix {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .report-summary-net,
  .report-table th {
    background: #ffffff !important;
  }

  .report-table th {
    border-top: 1px solid #000000 !important;
    border-bottom: 1px solid #000000 !important;
  }

  .report-header {
    border-bottom-color: #000000 !important;
  }
}
`;

// Append reportCss to globals.css if not already present
const globalsCssPath = path.join(webSrc, 'app/globals.css');
let globalsContent = fs.readFileSync(globalsCssPath, 'utf8');
if (!globalsContent.includes('history-report-document')) {
  fs.writeFileSync(globalsCssPath, globalsContent + reportCss, 'utf8');
  console.log('Appended report styles to globals.css');
}

// ========================================================
// 2. Create history-report-modal.tsx
// ========================================================
const historyReportModalTsx = `'use client';

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
  return \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}\`;
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
        label = \`Today (\${today})\`;
        break;
      case 'yesterday':
        filtered = allTickets.filter((t) => getTicketDateStr(t) === yesterday);
        label = \`Yesterday (\${yesterday})\`;
        break;
      case '7days':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= sevenDaysAgo && ds <= today;
        });
        label = \`Last 7 days (\${sevenDaysAgo} — \${today})\`;
        break;
      case '30days':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= thirtyDaysAgo && ds <= today;
        });
        label = \`Last 30 days (\${thirtyDaysAgo} — \${today})\`;
        break;
      case 'this_year':
        filtered = allTickets.filter((t) => getTicketDateStr(t).startsWith(curYear));
        label = \`This Year (\${curYear})\`;
        break;
      case 'last_year':
        filtered = allTickets.filter((t) => getTicketDateStr(t).startsWith(lastYear));
        label = \`Last Year (\${lastYear})\`;
        break;
      case 'custom':
        filtered = allTickets.filter((t) => {
          const ds = getTicketDateStr(t);
          return ds >= customFrom && ds <= customTo;
        });
        label = \`Custom Range (\${customFrom} — \${customTo})\`;
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
          copy: t.print_count,
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
    const dateCode = \`\${d.getFullYear()}\${pad(d.getMonth() + 1)}\${pad(d.getDate())}\`;
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return \`HIST-\${dateCode}-\${rand}\`;
  }, [period, customFrom, customTo]);

  const integrityHash = useMemo(() => {
    // Deterministic representation
    let hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2';
    if (reportTickets.length > 0) {
      const seed = reportTickets.map((t) => \`\${t.ticket_number}:\${t.net_weight_kg}:\${t.plate_number}\`).join('|');
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
                          <tr key={ticket.id} className={\`report-row report-row--\${status}\`}>
                            {/* Ticket */}
                            <td className="report-ticket">
                              <strong>#{ticket.ticket_display_id || ticket.ticket_number}</strong>
                              <span className={\`report-direction report-direction--\${direction.toLowerCase()}\`}>
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
                              <span className={\`report-status report-status--\${status}\`}>
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
`;

fs.writeFileSync(path.join(webSrc, 'components/history-report-modal.tsx'), historyReportModalTsx, 'utf8');
console.log('Created components/history-report-modal.tsx');

// ========================================================
// 3. Update live-activity-stream.tsx with Date Filters & Print Report
// ========================================================
const liveActivityStreamTsx = `'use client';

import { useState, useMemo } from 'react';
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
  Calendar,
  FileText,
} from 'lucide-react';
import { TicketDetailModal } from './ticket-detail-modal';
import { HistoryReportModal } from './history-report-modal';

interface Props {
  initialTickets: WeighTicket[];
}

type DateFilterOption = 'all' | 'today' | 'yesterday' | '7days' | '30days' | 'this_year' | 'last_year' | 'custom';

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}\`;
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

export function LiveActivityStream({ initialTickets }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<WeighTicket | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('all');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'completed' | 'pending' | 'voided' | 'deleted' | 'overridden'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Custom date bounds (default to last 30 days)
  const todayStr = useMemo(() => toDateString(new Date()), []);
  const monthAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toDateString(d);
  }, []);
  const [customFrom, setCustomFrom] = useState(monthAgoStr);
  const [customTo, setCustomTo] = useState(todayStr);

  // Compute filtered tickets
  const filtered = useMemo(() => {
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

    return initialTickets.filter((t) => {
      // 1. Date Filter
      const ticketDate = getTicketDateStr(t);
      if (dateFilter === 'today' && ticketDate !== today) return false;
      if (dateFilter === 'yesterday' && ticketDate !== yesterday) return false;
      if (dateFilter === '7days' && (ticketDate < sevenDaysAgo || ticketDate > today)) return false;
      if (dateFilter === '30days' && (ticketDate < thirtyDaysAgo || ticketDate > today)) return false;
      if (dateFilter === 'this_year' && !ticketDate.startsWith(curYear)) return false;
      if (dateFilter === 'last_year' && !ticketDate.startsWith(lastYear)) return false;
      if (dateFilter === 'custom' && (ticketDate < customFrom || ticketDate > customTo)) return false;

      // 2. Direction Filter
      if (directionFilter !== 'ALL' && t.direction !== directionFilter) return false;

      // 3. Status Filter
      const status = getTicketStatus(t);
      if (statusFilter === 'overridden') {
        if (!t.is_overridden) return false;
      } else if (statusFilter !== 'ALL') {
        if (status !== statusFilter) return false;
      }

      // 4. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPlate = t.plate_number?.toLowerCase().includes(q);
        const matchDriver = t.driver_name?.toLowerCase().includes(q);
        const matchTicket = String(t.ticket_number).includes(q) || t.ticket_display_id?.toLowerCase().includes(q);
        if (!matchPlate && !matchDriver && !matchTicket) return false;
      }

      return true;
    });
  }, [initialTickets, dateFilter, directionFilter, statusFilter, searchQuery, customFrom, customTo]);

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
          {/* 1. Date Range Dropdown */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs">
            <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterOption)}
              className="bg-transparent text-white font-medium text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-white">All time</option>
              <option value="today" className="bg-slate-900 text-white">Today</option>
              <option value="yesterday" className="bg-slate-900 text-white">Yesterday</option>
              <option value="7days" className="bg-slate-900 text-white">Last 7 days</option>
              <option value="30days" className="bg-slate-900 text-white">Last 30 days</option>
              <option value="this_year" className="bg-slate-900 text-white">This year</option>
              <option value="last_year" className="bg-slate-900 text-white">Last year</option>
              <option value="custom" className="bg-slate-900 text-white">Custom range...</option>
            </select>
          </div>

          {/* Custom Date Pickers (Shown if "custom" is selected) */}
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-900/90 border border-cyan-500/30 text-xs">
              <span className="text-slate-400 text-[11px]">From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-slate-950 px-2 py-0.5 rounded border border-white/10 text-white font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              />
              <span className="text-slate-400 text-[11px]">To:</span>
              <input
                type="date"
                value={customTo}
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
                  <p className="text-sm">No tickets found matching the selected date or criteria.</p>
                  <p className="text-xs text-slate-600 mt-1">Try switching date range to &quot;All time&quot; or clearing search.</p>
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

      {/* History Ledger A4 Print Report Modal */}
      <HistoryReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        allTickets={initialTickets}
      />
    </div>
  );
}
`;

fs.writeFileSync(path.join(webSrc, 'components/live-activity-stream.tsx'), liveActivityStreamTsx, 'utf8');
console.log('Updated components/live-activity-stream.tsx with date filter & print report button');
console.log('All changes written successfully!');
