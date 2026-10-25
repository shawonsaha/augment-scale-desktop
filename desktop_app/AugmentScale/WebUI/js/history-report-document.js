/**
 * Shared A4 history-report document builder.
 * Used by the interactive report preview and the automatic PDF archive page.
 */
import {
  escapeHtml,
  formatFullDateTime,
  formatShortDateWithSeconds,
} from './utils.js';

export const HISTORY_REPORT_PAGE_CSS = `@media print {
  @page {
    size: A4 portrait;
    margin: 10mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      color: #4b5563;
    }
  }
}`;

function formatKg(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value)).toLocaleString('en-US')} kg`;
}

function formatTonnes(value) {
  if (value === null || value === undefined) return '0.000';
  return (Number(value) / 1000).toFixed(3);
}

function statusOf(ticket) {
  if (!ticket) return 'pending';
  if (ticket.status === 'voided') return 'voided';
  if (ticket.status === 'deleted' || ticket.deleted) return 'deleted';
  if (ticket.status === 'completed') return 'completed';
  return 'pending';
}

function statusLabel(ticket) {
  return { pending: 'Pending', completed: 'Completed', voided: 'Voided', deleted: 'Deleted' }[
    statusOf(ticket)
  ] || 'Pending';
}

function directionOf(ticket) {
  return String(ticket.direction || ticket.weightType || '').toUpperCase().includes('OUT')
    ? 'OUT'
    : 'IN';
}

function hasOverride(ticket) {
  return Boolean(ticket?.override || ticket?.overridden || ticket?.isOverridden);
}

function reprintEntries(ticket) {
  const log = Array.isArray(ticket.printLog) ? ticket.printLog : [];
  return log.filter((entry) => entry.type === 'reprint' || Number(entry.copyNumber) > 1);
}

export function summarizeTickets(tickets) {
  const summary = {
    total: tickets.length,
    completed: 0,
    pending: 0,
    voided: 0,
    deleted: 0,
    overrides: 0,
    reprints: 0,
    netKg: 0,
  };

  for (const ticket of tickets) {
    const status = statusOf(ticket);
    if (status === 'completed') {
      summary.completed += 1;
      summary.netKg += Number(ticket.netWeight) || 0;
    } else if (status === 'voided') {
      summary.voided += 1;
    } else if (status === 'deleted') {
      summary.deleted += 1;
    } else {
      summary.pending += 1;
    }
    if (hasOverride(ticket)) summary.overrides += 1;
    const entries = reprintEntries(ticket);
    summary.reprints += entries.length || Math.max(0, Number(ticket.printCount || 1) - 1);
  }

  return summary;
}

function reportTimestamp(input) {
  return formatShortDateWithSeconds(input).replace(/\s+\d{4}\s+/, ' ');
}

function weighHtml(value, type, operator, timestamp) {
  const label = String(type || 'Weight').toUpperCase();
  if (value === null || value === undefined) {
    return `
      <td class="report-weigh report-weigh--pending">
        <strong>${escapeHtml(label)} · PENDING</strong>
        <span>Awaiting second weigh</span>
      </td>
    `;
  }
  const meta = [operator || '—', reportTimestamp(timestamp) || '—'].join(' · ');
  return `
    <td class="report-weigh">
      <strong>${escapeHtml(label)} · ${formatKg(value)}</strong>
      <span>${escapeHtml(meta)}</span>
    </td>
  `;
}

function exceptionRows(tickets) {
  const rows = [];
  for (const ticket of tickets) {
    if (hasOverride(ticket)) {
      rows.push({
        ticket,
        type: 'Override',
        reason: ticket.override?.reason || 'Override recorded',
        by: ticket.override?.operator || '—',
        at: ticket.override?.timestamp,
      });
    }
    const status = statusOf(ticket);
    if (status === 'voided') {
      rows.push({
        ticket,
        type: 'Void',
        reason: ticket.voidedReason || 'No reason recorded',
        by: ticket.voidedBy || '—',
        at: ticket.voidedAt,
      });
    }
    if (status === 'deleted') {
      rows.push({
        ticket,
        type: 'Delete',
        reason: ticket.deletedReason || 'No reason recorded',
        by: ticket.deletedBy || '—',
        at: ticket.deletedAt,
      });
    }
  }
  return rows;
}

function reprintRows(tickets) {
  const rows = [];
  for (const ticket of tickets) {
    const entries = reprintEntries(ticket);
    if (entries.length > 0) {
      for (const entry of entries) {
        rows.push({
          ticket,
          copy: entry.copyNumber || 2,
          by: entry.by || '—',
          at: entry.at,
          reason: entry.reason || '—',
        });
      }
    } else if (Number(ticket.printCount) > 1) {
      rows.push({
        ticket,
        copy: ticket.printCount,
        by: '—',
        at: null,
        reason: 'Reprint count recorded',
      });
    }
  }
  return rows;
}

export function renderHistoryReportDocument(documentElement, report) {
  if (!documentElement) return;

  const source = report || {};
  const tickets = Array.isArray(source.tickets) ? source.tickets : [];
  const summary = source.summary || summarizeTickets(tickets);
  const exceptions = exceptionRows(tickets);
  const reprints = reprintRows(tickets);

  const rows = tickets
    .map((ticket) => {
      const status = statusOf(ticket);
      const direction = directionOf(ticket);
      const firstType = ticket.firstWeightType || (direction === 'IN' ? 'Gross' : 'Tare');
      const secondType = ticket.secondWeightType || (firstType === 'Gross' ? 'Tare' : 'Gross');
      const net = ticket.netWeight;
      const hasNet = net !== null && net !== undefined;
      const netAnomaly = hasNet && Number(net) <= 0;
      const override = hasOverride(ticket) ? ticket.override || {} : null;
      const overrideReason = override?.reason || 'Override recorded';

      return `
        <tr class="report-row report-row--${escapeHtml(status)}">
          <td class="report-ticket">
            <strong>#${ticket.id}</strong>
            <span class="report-direction report-direction--${direction.toLowerCase()}">${direction}</span>
          </td>
          <td class="report-truck">
            <strong>${escapeHtml(ticket.truckNo || '—')}</strong>
            <span>${escapeHtml(ticket.driver || '—')}</span>
          </td>
          ${weighHtml(ticket.firstWeight, firstType, ticket.firstOperator, ticket.firstWeightTime)}
          ${weighHtml(ticket.secondWeight, secondType, ticket.secondOperator, ticket.secondWeightTime)}
          <td class="report-net">
            ${hasNet ? `<span class="${netAnomaly ? 'report-net-value report-net-value--anomaly' : 'report-net-value'}">${formatKg(net)}</span>` : '—'}
          </td>
          <td class="report-status-cell">
            <span class="report-status report-status--${escapeHtml(status)}">${escapeHtml(statusLabel(ticket))}</span>
            ${override ? `<span class="report-flags">OVR</span><span class="report-override-note">${escapeHtml(overrideReason)}</span>` : ''}
            ${status === 'deleted' ? `<span class="report-delete-note">${escapeHtml(ticket.deletedReason || 'No reason recorded')}</span>` : ''}
          </td>
        </tr>
      `;
    })
    .join('');

  const exceptionSection =
    exceptions.length === 0
      ? ''
      : `
        <section class="report-appendix">
          <h2>Exception register</h2>
          <table class="report-table report-table--appendix">
            <thead>
              <tr><th>Ticket</th><th>Type</th><th>Reason</th><th>Authorised by</th><th>Timestamp</th></tr>
            </thead>
            <tbody>
              ${exceptions
                .map(
                  (row) => `
                    <tr>
                      <td>#${row.ticket.id}</td>
                      <td>${escapeHtml(row.type)}</td>
                      <td>${escapeHtml(row.reason)}</td>
                      <td>${escapeHtml(row.by)}</td>
                      <td>${escapeHtml(formatFullDateTime(row.at) || '—')}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `;

  const reprintSection =
    reprints.length === 0
      ? ''
      : `
        <section class="report-appendix">
          <h2>Reprint register</h2>
          <table class="report-table report-table--appendix">
            <thead>
              <tr><th>Ticket</th><th>Copy</th><th>Reprinted by</th><th>Timestamp</th><th>Reason</th></tr>
            </thead>
            <tbody>
              ${reprints
                .map(
                  (row) => `
                    <tr>
                      <td>#${row.ticket.id}</td>
                      <td>${escapeHtml(row.copy)}</td>
                      <td>${escapeHtml(row.by)}</td>
                      <td>${escapeHtml(formatFullDateTime(row.at) || '—')}</td>
                      <td>${escapeHtml(row.reason)}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `;

  documentElement.innerHTML = `
    <header class="report-header">
      <div class="report-heading">
        <h1>Weighbridge History Report</h1>
        <span>Daily weighbridge ledger · all ticket states</span>
      </div>
      <div class="report-identity">
        <span>Report</span>
        <strong>${escapeHtml(source.reportId || '—')}</strong>
        <span>${escapeHtml(source.rangeLabel || '')}</span>
      </div>
    </header>

    <div class="report-integrity-line">
      <span>${source.isDemo ? 'Demo preview' : 'SHA-256 integrity hash'}</span>
      <code>${escapeHtml(source.integrityHash || '—')}</code>
    </div>

    <section class="report-meta">
      <div><span>Report period</span><strong>${escapeHtml(source.rangeLabel || '—')}</strong></div>
      <div><span>Generated by</span><strong>${escapeHtml(source.operatorName || '—')}</strong></div>
      <div><span>Generated at</span><strong>${escapeHtml(formatFullDateTime(source.generatedAt) || '—')}</strong></div>
      <div><span>Workstation</span><strong>${escapeHtml(source.workstationName || 'Workstation')}</strong></div>
    </section>

    <section class="report-summary">
      <div><span>Total tickets</span><strong>${summary.total || 0}</strong></div>
      <div><span>Completed</span><strong>${summary.completed || 0}</strong></div>
      <div><span>Pending</span><strong>${summary.pending || 0}</strong></div>
      <div><span>Voided / deleted</span><strong>${(summary.voided || 0) + (summary.deleted || 0)}</strong></div>
      <div><span>Overrides</span><strong>${summary.overrides || 0}</strong></div>
      <div><span>Reprints</span><strong>${summary.reprints || 0}</strong></div>
      <div class="report-summary-net">
        <span>Completed net</span>
        <strong>${formatTonnes(summary.netKg)} MT</strong>
      </div>
    </section>

    <section class="report-ledger-section">
      <div class="report-section-heading">
        <h2>Ticket ledger</h2>
        <span>${tickets.length} record${tickets.length === 1 ? '' : 's'} · chronological</span>
      </div>
      ${
        tickets.length === 0
          ? '<p class="report-empty">No tickets were recorded in this period.</p>'
          : `
            <table class="report-table report-table--ledger">
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
              <tbody>${rows}</tbody>
            </table>
          `
      }
    </section>

    ${exceptionSection}
    ${reprintSection}

    <footer class="report-footer">
      <span>${escapeHtml(source.reportId || '')} · ${escapeHtml(source.rangeLabel || '')}</span>
      <span class="report-powered">Powered by scale.augmentlab.net</span>
    </footer>
  `;
}
