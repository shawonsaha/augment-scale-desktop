/**
 * WebView2 production runtime.
 *
 * The prototype runs unchanged in a normal browser. Inside the desktop shell
 * `window.chrome.webview` exists, so state mutations are routed to C# and the
 * browser demo data is never used.
 */

export const IS_PRODUCTION = Boolean(
  typeof window !== 'undefined' && window.chrome && window.chrome.webview
);

const pending = new Map();
let sequence = 0;

if (IS_PRODUCTION) {
  window.chrome.webview.addEventListener('message', (event) => {
    let message = event.data;
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (!message || message.type !== 'commandResponse' || !message.requestId) return;

    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    clearTimeout(request.timer);

    if (message.success) {
      request.resolve(message.data);
    } else {
      request.reject(new Error(message.error || 'The command failed.'));
    }
  });
}

/**
 * Send a command to the C# bridge and await its response.
 * @param {string} command
 * @param {Object} [payload]
 * @returns {Promise<any>}
 */
export function sendCommand(command, payload = {}) {
  if (!IS_PRODUCTION) {
    return Promise.reject(
      new Error('The desktop bridge is unavailable. This action needs the Augment Scale desktop app.')
    );
  }

  return new Promise((resolve, reject) => {
    const requestId = `req-${Date.now()}-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('The workstation did not respond. Please try again.'));
    }, 30000);

    pending.set(requestId, { resolve, reject, timer });
    try {
      window.chrome.webview.postMessage({ command, payload, requestId });
    } catch (error) {
      pending.delete(requestId);
      clearTimeout(timer);
      reject(error);
    }
  });
}
