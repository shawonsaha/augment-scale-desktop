/**
 * Theme Switcher (Dark / Light Mode)
 * Toggles color theme tokens and persists selection in localStorage.
 */
import { showToast } from './toast.js';

export function initThemeToggle() {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (!toggleBtn) return;

  function setTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.body.classList.toggle('dark-mode', isDark);

    // Modern crisp inline SVGs
    toggleBtn.innerHTML = isDark
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;

    toggleBtn.setAttribute(
      'title',
      isDark ? 'Switch to Day Shift Mode' : 'Switch to Night Shift Mode'
    );
    localStorage.setItem('weighbridge-theme', theme);
  }

  const savedTheme = localStorage.getItem('weighbridge-theme') || 'light';
  setTheme(savedTheme);

  toggleBtn.addEventListener('click', () => {
    const isCurrentlyDark =
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.body.classList.contains('dark-mode');
    const newTheme = isCurrentlyDark ? 'light' : 'dark';
    setTheme(newTheme);
    showToast(
      newTheme === 'dark'
        ? 'Night Shift Mode Activated (High Contrast)'
        : 'Day Shift Mode Activated',
      'info'
    );
  });
}
