#!/usr/bin/env node
/**
 * Refreshes the vendored Stockfish build in public/engine/ from the `stockfish` npm package
 * (nmrugg/stockfish.js). Only the single-threaded "lite" build is copied: it needs no
 * cross-origin isolation headers, so it runs on GitHub Pages and any static host.
 *
 *   npm run engine:update             # latest release
 *   npm run engine:update -- 19.0.0   # a specific version
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = process.argv[2] ?? 'latest';
const work = mkdtempSync(join(tmpdir(), 'stockfish-'));
try {
  console.log(`Fetching stockfish@${version}…`);
  const tarball = execFileSync('npm', ['pack', `stockfish@${version}`, '--silent'], {
    cwd: work,
    encoding: 'utf8',
  }).trim();
  execFileSync('tar', ['-xzf', tarball], { cwd: work });
  const bin = join(work, 'package', 'bin');
  const js = readdirSync(bin).find((f) => /^stockfish-[\d.]+-lite-single\.js$/.test(f));
  if (!js) throw new Error('No *-lite-single.js build found in this release.');
  const wasm = js.replace(/\.js$/, '.wasm');
  const out = new URL('../public/engine/', import.meta.url);
  // The app loads a fixed file name, so a new major version means updating ENGINE_FILE too.
  for (const f of [js, wasm]) {
    copyFileSync(join(bin, f), new URL(f, out));
    const hash = createHash('sha256')
      .update(readFileSync(join(bin, f)))
      .digest('hex');
    console.log(`  ${f}  sha256 ${hash}`);
  }
  const license = readdirSync(join(work, 'package')).find((f) =>
    /^(copying|license)(\.(txt|md))?$/i.test(f),
  );
  if (license) copyFileSync(join(work, 'package', license), new URL('COPYING.txt', out));
  console.log(
    'Done. Update public/engine/README.md and ENGINE_FILE in src/engine/stockfish.ts if the version changed.',
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
