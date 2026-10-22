/**
 * HTML Partial Loader
 * Fetches HTML fragments and injects them into #app in order.
 * Must complete before bootstrap() so DOM elements exist for all modules.
 */

// Shared asset version tag. Bump alongside the ?v= tags in index.html on deploy
// so partials/JS/CSS cache normally between deploys instead of re-fetching every load.
export const ASSET_VERSION = 'prod5';

const PARTIALS = [
  'partials/telemetry-bar.html',
  'partials/screen-login.html',
  'partials/screen-dashboard.html',
  'partials/screen-first-weigh.html',
  'partials/screen-second-weigh.html',
  'partials/screen-history.html',
  'partials/screen-trucks.html',
  'partials/modals.html',
];

export async function loadPartials() {
  const app = document.getElementById('app');
  if (!app) throw new Error('html-loader: #app element not found');

  // Fetch all partials in parallel for speed (versioned, so the browser may cache them)
  const responses = await Promise.all(
    PARTIALS.map((path) =>
      fetch(`${path}?v=${ASSET_VERSION}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load partial: ${path} (${r.status})`);
        return r.text();
      })
    )
  );

  // Inject in correct order
  for (const html of responses) {
    app.insertAdjacentHTML('beforeend', html);
  }
}
