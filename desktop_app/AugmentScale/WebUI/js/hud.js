/**
 * Shared HUD Component
 * Mounts the live scale instrument display into any container.
 * Subscribes to telemetry via registerHudRenderer.
 * Returns an unmount() function for cleanup.
 */
import { registerHudRenderer, unregisterHudRenderer } from './telemetry.js';
import { ASSET_VERSION } from './html-loader.js';

let hudTemplateCache = null;

async function getHudTemplate() {
  if (hudTemplateCache) return hudTemplateCache;
  const resp = await fetch(`partials/hud.html?v=${ASSET_VERSION}`);
  if (!resp.ok) throw new Error(`Failed to load HUD partial (${resp.status})`);
  hudTemplateCache = await resp.text();
  return hudTemplateCache;
}

export async function mountHud(container) {
  if (!container) return () => {};

  const html = await getHudTemplate();
  container.innerHTML = html;

  const digits = container.querySelector('[data-hud-digits]');
  const badge = container.querySelector('[data-hud-badge]');
  const tagZero = container.querySelector('[data-hud-tag-zero]');

  function onScaleData(data) {
    if (digits) {
      digits.textContent = data.formatted;
      digits.className =
        'scale-digits ' + (!data.isConnected ? 'disconnected' : !data.isStable ? 'motion' : 'stable');
    }

    if (badge) {
      if (!data.isConnected) {
        badge.className = 'scale-stability-badge disconnected';
        badge.innerHTML = '✕ DISCONNECTED';
      } else if (!data.isStable) {
        badge.className = 'scale-stability-badge motion';
        badge.innerHTML = '▲ MOTION DETECTED';
      } else {
        badge.className = 'scale-stability-badge stable';
        badge.innerHTML = '● STABLE READING';
      }
    }

    if (tagZero) {
      const isZero = data.isConnected && data.weight === 0;
      tagZero.style.display = isZero ? 'inline-flex' : 'none';
    }
  }

  registerHudRenderer(onScaleData);

  return function unmount() {
    unregisterHudRenderer(onScaleData);
    container.innerHTML = '';
  };
}
