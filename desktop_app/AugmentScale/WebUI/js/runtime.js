// @ts-check
/**
 * WebView2 desktop host runtime.
 *
 * Augment Scale runs inside the Windows desktop host with Microsoft Edge WebView2.
 * All mutations and queries are routed across the bridge to C# and the encrypted
 * SQLCipher database.
 */

export const hasDesktopBridge = Boolean(
  typeof window !== 'undefined' && window.chrome && window.chrome.webview
);

// Backward-compatibility export
export const IS_PRODUCTION = hasDesktopBridge;

/** @type {Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timer: any }>} */
const pending = new Map();
let sequence = 0;

if (hasDesktopBridge) {
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
 * @template {keyof import('./types.js').BridgeCommands} T
 * @param {T} command
 * @param {import('./types.js').BridgeCommands[T]['request']} [payload]
 * @returns {Promise<import('./types.js').BridgeCommands[T]['response']>}
 */
export function sendCommand(command, payload = /** @type {any} */ ({})) {
  if (!hasDesktopBridge) {
    return Promise.reject(
      new Error('The desktop bridge is unavailable. Augment Scale requires the desktop host.')
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
