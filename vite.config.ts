/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const swTemplate = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');

/**
 * Emits `sw.js` with a precache manifest of the files that make the app work offline:
 * the hashed bundle, the Stockfish engine, and the default piece set. Everything else
 * (other piece sets, non-latin font subsets) is cached on first use.
 */
function serviceWorker(): Plugin {
  return {
    name: 'chess-advisor-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(
        (f) => !f.endsWith('.map') && (!/\.woff2?$/.test(f) || /-latin-(?!ext).*\.woff2$/.test(f)),
      );
      const statics = [
        'engine/stockfish-19-lite-single.js',
        'engine/stockfish-19-lite-single.wasm',
        ...['w', 'b'].flatMap((c) => 'KQRBNP'.split('').map((r) => `pieces/cburnett/${c}${r}.svg`)),
        'favicon.svg',
        'theme-init.js',
        'manifest.webmanifest',
        'icons/icon-192.png',
      ];
      const precache = ['./', ...files.filter((f) => f !== 'index.html'), ...statics];
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: swTemplate
          .replace('__VERSION__', version)
          .replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

/**
 * A strict Content-Security-Policy for the production build. The app itself only needs its
 * own origin; the network allowances are the optional Lichess and Chess.com APIs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "connect-src 'self' https://lichess.org https://tablebase.lichess.org https://tablebase.lichess.ovh https://api.chess.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'chess-advisor-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      ),
  };
}

export default defineConfig({
  // Relative base: the build works at any path (GitHub Pages project sites, forks, custom domains).
  base: './',
  plugins: [react(), serviceWorker(), contentSecurityPolicy()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
