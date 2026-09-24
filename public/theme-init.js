// Applies the saved colour theme before the first paint, so there is no flash of the wrong theme.
try {
  var saved = JSON.parse(localStorage.getItem('chess-advisor:settings') || '{}').state || {};
  var theme = saved.theme || 'system';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage unavailable: keep the default.
}
