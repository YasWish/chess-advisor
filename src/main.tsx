import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@lichess-org/chessground/assets/chessground.base.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/board.css';
import './styles/panels.css';
import './styles/dialogs.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useUi } from './state/ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              useUi.getState().toast('A new version of Chess Advisor is ready.', 'info', {
                label: 'Reload',
                run: () => next.postMessage('SKIP_WAITING'),
              });
            }
          });
        });
      })
      .catch(() => {
        // Offline support is optional; the app works without it.
      });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
  });
}
