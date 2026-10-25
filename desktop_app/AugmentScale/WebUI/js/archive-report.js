import { renderHistoryReportDocument } from './history-report-document.js';

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
