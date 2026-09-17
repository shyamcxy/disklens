// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 DiskLens contributors
/* Theme controller.
 *
 * Loaded blocking in <head> so the correct theme is on <html> before the first
 * paint. Doing this from app.js (which is deferred) would show a flash of the
 * default theme on every load, which looks broken.
 *
 * Three directions, each with a light and a dark mode. "system" follows macOS
 * and re-resolves live when the OS appearance changes.
 */

const Theme = (() => {
  const THEME_KEY = 'disklens.theme';
  const MODE_KEY = 'disklens.mode';

  const THEMES = [
    { id: 'instrument', label: 'Instrument', blurb: 'Precise and technical. Tight, dense, one accent.' },
    { id: 'studio', label: 'Studio', blurb: 'Soft and spacious. Warm neutrals, Mac-native feel.' },
    { id: 'spectrum', label: 'Spectrum', blurb: 'Chrome recedes, your data is the only colour.' },
  ];
  const MODES = [
    { id: 'system', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* private mode */ }
  }

  /* The comparison board embeds the app once per theme/mode using query
   * params. Those must win for that instance but must NOT be written to
   * localStorage, or previewing a theme would silently become the choice. */
  const qs = new URLSearchParams(location.search);
  const qTheme = qs.get('theme');
  const qMode = qs.get('mode');

  const state = {
    theme: qTheme || read(THEME_KEY, 'instrument'),
    mode: qMode || read(MODE_KEY, 'system'),
  };
  const ephemeral = !!(qTheme || qMode);
  if (!THEMES.some((t) => t.id === state.theme)) state.theme = 'instrument';
  if (!MODES.some((m) => m.id === state.mode)) state.mode = 'system';

  function resolvedMode() {
    if (state.mode === 'system') return media.matches ? 'dark' : 'light';
    return state.mode;
  }

  function paint(notify) {
    const mode = resolvedMode();
    root.dataset.theme = state.theme;
    root.dataset.mode = mode;
    // The colour-scheme property drives native form controls and scrollbars.
    root.style.colorScheme = mode;
    if (notify) {
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { theme: state.theme, mode, modeSetting: state.mode },
      }));
    }
  }

  function setTheme(id, persist = true) {
    if (!THEMES.some((t) => t.id === id)) return;
    state.theme = id;
    if (persist) write(THEME_KEY, id);
    paint(true);
  }

  function setMode(id, persist = true) {
    if (!MODES.some((m) => m.id === id)) return;
    state.mode = id;
    if (persist) write(MODE_KEY, id);
    paint(true);
  }

  // Following the system means reacting when the system changes, not just
  // reading it once at load.
  const onSystemChange = () => { if (state.mode === 'system') paint(true); };
  if (media.addEventListener) media.addEventListener('change', onSystemChange);
  else if (media.addListener) media.addListener(onSystemChange);

  paint(false);

  const api = {
    THEMES, MODES,
    get theme() { return state.theme; },
    get mode() { return state.mode; },
    get resolved() { return resolvedMode(); },
    ephemeral,
    setTheme: (id) => setTheme(id, !ephemeral),
    setMode: (id) => setMode(id, !ephemeral),
    setThemeRaw: setTheme,
    setModeRaw: setMode,
    cycleTheme() {
      const i = THEMES.findIndex((t) => t.id === state.theme);
      setTheme(THEMES[(i + 1) % THEMES.length].id);
    },
    cycleMode() {
      const order = ['system', 'light', 'dark'];
      setMode(order[(order.indexOf(state.mode) + 1) % order.length]);
    },
  };
  // Explicit global: a top-level `const` never lands on window, which makes it
  // invisible to anything evaluating against the page (tests, the comparison
  // board, devtools snippets).
  window.Theme = api;
  return api;
})();
