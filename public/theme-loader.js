/**
 * Shared by index.html and settings.html. Themes are plain JSON files in
 * /themes/ (served statically) that map to this app's CSS custom properties
 * (see :root in style.css). Adding, editing, or removing a theme is just
 * adding/editing/removing a file there — nothing else needs to change,
 * since the server lists whatever's in that folder at request time.
 *
 * Also the shared entry point for the rest of /api/settings (idle timeout,
 * photo interval, etc.) — not just the theme — since both pages already
 * need one fetch of that endpoint and shouldn't duplicate it.
 *
 * The active theme (and other settings) are stored server-side (in the
 * settings table) so every device showing the display — and the Settings
 * page — reflects the same choice, the same way calendar visibility
 * already does.
 */
(() => {
  const CSS_VAR_MAP = {
    bg: '--bg',
    surface: '--surface',
    surfaceMuted: '--surface-muted',
    ink: '--ink',
    inkSoft: '--ink-soft',
    border: '--border',
    borderStrong: '--border-strong',
    accent: '--accent',
    accentInk: '--accent-ink'
  };

  async function fetchThemes() {
    const res = await fetch('/api/themes');
    if (!res.ok) return [];
    return res.json();
  }

  async function fetchAllSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) return {};
    return res.json();
  }

  async function fetchActiveThemeId() {
    const s = await fetchAllSettings();
    return s.active_theme || 'default';
  }

  function applyTheme(theme) {
    if (!theme || !theme.colors) return;
    const root = document.documentElement.style;
    for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
      if (theme.colors[key]) root.setProperty(cssVar, theme.colors[key]);
    }
  }

  // Fetches the current theme list + active selection, applies it to this
  // page, and returns everything so the caller (e.g. the Settings page's
  // theme picker) doesn't have to re-fetch it.
  //
  // Accepts an optional already-fetched /api/settings payload — the
  // display page calls this back-to-back with its own settings-driven
  // setup on every refresh (boot, wake, the 10-minute poll), and there's
  // no reason for both to hit /api/settings separately every time.
  async function applyActiveTheme(preFetchedSettings) {
    const [themes, settings] = await Promise.all([
      fetchThemes(),
      preFetchedSettings || fetchAllSettings()
    ]);
    const activeId = settings.active_theme || 'default';
    const theme = themes.find((t) => t.id === activeId) || themes.find((t) => t.id === 'default') || themes[0];
    applyTheme(theme);
    return { themes, activeId, theme };
  }

  async function setActiveTheme(themeId) {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_theme: themeId })
    });
    return res.ok;
  }

  window.HomeportTheme = {
    fetchThemes,
    fetchAllSettings,
    fetchActiveThemeId,
    applyTheme,
    applyActiveTheme,
    setActiveTheme
  };
})();
