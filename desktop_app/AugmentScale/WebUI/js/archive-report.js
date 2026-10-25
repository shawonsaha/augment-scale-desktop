import {
  HISTORY_REPORT_PAGE_CSS,
  renderHistoryReportDocument,
} from './history-report-document.js?v=archive2';

function installPageStyles() {
  if (document.getElementById('history-report-page-style')) return;
  const style = document.createElement('style');
  style.id = 'history-report-page-style';
  style.textContent = HISTORY_REPORT_PAGE_CSS;
  document.head.appendChild(style);
}

installPageStyles();

function notify(type, message) {
  try {
    const payload = message ? { type, message } : { type };
    window.chrome?.webview?.postMessage(payload);
  } catch {
    // Browser preview: the host bridge is not available.
  }
}

window.renderArchiveReport = (report) => {
  try {
    const documentElement = document.getElementById('history-report-document');
    if (!documentElement) throw new Error('Archive report container is missing.');

    renderHistoryReportDocument(documentElement, report);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => notify('archiveReady'));
    });
  } catch (error) {
    notify('archiveError', error?.message || String(error));
  }
};
