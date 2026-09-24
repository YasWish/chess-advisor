#!/usr/bin/env node
/**
 * End-to-end smoke test against the production build, in a real headless Chrome.
 *
 *   npm run build && npm run e2e
 *   npm run e2e -- --screenshots     # also refresh docs/screenshots/
 *
 * Uses the Chrome found at $CHROME_PATH (default: /usr/bin/google-chrome, which GitHub's
 * Ubuntu runners have). Extra flags can be passed in $CHROME_ARGS.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const SHOTS = process.argv.includes('--screenshots');
const OPERA_GAME = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const log = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

const server = await preview({ preview: { port: 4173, strictPort: false }, logLevel: 'error' });
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4173/';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', ...(process.env.CHROME_ARGS?.split(' ').filter(Boolean) ?? [])],
  headless: true,
});

const errors = [];
let page;
try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/lichess|chess\.com|net::|Failed to load resource/i.test(m.text()) &&
      errors.push(m.text()),
  );
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 });
  // Cloud evaluations off: the test must not depend on lichess.org being reachable.
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('chess-advisor:settings')) {
      localStorage.setItem(
        'chess-advisor:settings',
        JSON.stringify({ state: { theme: 'dark', cloudEval: false }, version: 1 }),
      );
    }
  });
  const settings = (state) =>
    page.evaluate(
      (s) =>
        localStorage.setItem('chess-advisor:settings', JSON.stringify({ state: s, version: 1 })),
      state,
    );
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const tab = (name) =>
    page.evaluate(
      (n) =>
        [...document.querySelectorAll('.tabs button')]
          .find((b) => b.textContent.startsWith(n))
          .click(),
      name,
    );

  console.log(`Testing ${url}`);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelectorAll('.cg-wrap cg-board piece').length === 32,
    { timeout: 15_000 },
  );
  log('board renders 32 pieces');
  const pieceImage = await page.$eval(
    '.cg-wrap cg-board piece',
    (p) => getComputedStyle(p).backgroundImage,
  );
  const pieceUrl = /url\("?(.*?)"?\)/.exec(pieceImage)?.[1];
  if (pieceUrl && (await page.evaluate(async (u) => (await fetch(u)).ok, pieceUrl)))
    log('piece images load');
  else fail(`piece image does not load: ${pieceImage}`);

  await page.waitForSelector('.pv', { timeout: 60_000 });
  await page.waitForFunction(
    () =>
      /Depth (1[0-9]|[2-9][0-9])/.test(document.querySelector('.engine-meta')?.textContent ?? ''),
    { timeout: 60_000 },
  );
  log('Stockfish runs and reaches depth 10+');
  const firstMoves = await page.$$eval('.pv', (lines) =>
    lines.map((l) => l.querySelector('.pv-move')?.textContent),
  );
  if (firstMoves.length === 3 && new Set(firstMoves).size === 3)
    log('three engine lines with distinct first moves');
  else fail(`engine lines are not distinct: ${firstMoves.join(', ')}`);

  const square = async (sq) => {
    const box = await (
      await page.$('.analysis-board cg-board, .board-frame cg-board')
    ).boundingBox();
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    return {
      x: box.x + (file + 0.5) * (box.width / 8),
      y: box.y + (7 - rank + 0.5) * (box.height / 8),
    };
  };
  const clickMove = async (from, to) => {
    const a = await square(from);
    await page.mouse.click(a.x, a.y);
    const b = await square(to);
    await page.mouse.click(b.x, b.y);
  };

  await clickMove('e2', 'e4');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.move-grid .mv')].some((m) => m.textContent === 'e4'),
    { timeout: 5000 },
  );
  log('a move made by clicking squares appears in the move list');

  await page.waitForSelector('.pv');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('.move-grid .mv').length === 2, {
    timeout: 10_000,
  });
  log('Space plays the engine’s best move');

  await page.click('.top-actions button[title^="Import"]');
  await page.waitForSelector('dialog[open] textarea');
  await page.$eval(
    'dialog[open] textarea',
    (el, pgn) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, pgn);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    OPERA_GAME,
  );
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.move-grid .mv').length === 33, {
    timeout: 5000,
  });
  log('PGN import loads all 33 moves');
  const opening = await page.$eval('.opening-line', (el) => el.textContent);
  if (/Philidor/.test(opening)) log(`opening recognised: ${opening.trim()}`);
  else fail(`unexpected opening name: ${opening}`);

  await tab('Review');
  await page.evaluate(() =>
    [...document.querySelectorAll('.review-controls button')]
      .find((b) => b.textContent.startsWith('Standard'))
      .click(),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.review-controls button')]
      .find((b) => b.textContent.startsWith('Review'))
      .click(),
  );
  await page.waitForSelector('.accuracies', { timeout: 240_000 });
  const acc = await page.$$eval('.acc-value', (els) => els.map((e) => e.textContent));
  log(`game review completes (accuracy White ${acc[0]}, Black ${acc[1]})`);
  const glyphs = await page.$$eval('.mv-glyph', (els) => els.length);
  if (glyphs > 0) log(`${glyphs} moves graded in the move list`);
  else fail('no graded moves in the move list');

  if (SHOTS) {
    await mkdir('docs/screenshots', { recursive: true });
    // The position before Morphy's 16.Qb8+!!, the queen sacrifice that forces mate.
    await page.click('.move-grid .mv[data-san="Nxd7"]');
    await tab('Insights');
    await page.waitForFunction(
      () => /#2/.test(document.querySelector('.verdict')?.textContent ?? ''),
      { timeout: 30_000 },
    );
    await pause(1500);
    await page.$$eval('.toast-close', (buttons) => buttons.forEach((b) => b.click()));
    await pause(300);
    await page.screenshot({ path: 'docs/screenshots/analysis-dark.png' });
    await page.click('.move-grid .mv[data-san="Qb8+"]');
    await tab('Review');
    await pause(1200);
    await page.screenshot({ path: 'docs/screenshots/review.png' });
    log('screenshots: analysis, review');
  }

  await page.evaluate(() =>
    [...document.querySelectorAll('.modes button')].find((b) => b.textContent === 'Play').click(),
  );
  await page.waitForSelector('.play-setup');
  await page.$eval('#level', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '4');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    [...document.querySelectorAll('.play-setup .segmented button')]
      .find((b) => b.textContent === 'No clock')
      .click(),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.play-setup button')]
      .find((b) => b.textContent === 'Start game')
      .click(),
  );
  await page.waitForSelector('.play-game');
  await clickMove('d2', 'd4');
  await page.waitForFunction(
    () => document.querySelector('.game-moves li span:nth-child(3)')?.textContent?.length > 0,
    { timeout: 20_000 },
  );
  log('play mode: Stockfish answers a move');
  if (SHOTS) {
    await clickMove('c2', 'c4');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.game-moves li').length >= 2 &&
        document.querySelectorAll('.game-moves li')[1].children[2].textContent,
      { timeout: 20_000 },
    );
    await pause(700); // let the engine's move finish animating
    await page.screenshot({ path: 'docs/screenshots/play.png' });
  }

  await page.evaluate(() =>
    [...document.querySelectorAll('.modes button')].find((b) => b.textContent === 'Set up').click(),
  );
  await page.waitForSelector('.editor-panel');
  const validity = await page.$eval('.validity', (el) => el.textContent);
  if (validity.startsWith('Legal')) log('board editor validates the position');
  else fail(`board editor says: ${validity}`);

  if (SHOTS) {
    await page.evaluate(() =>
      [...document.querySelectorAll('.modes button')]
        .find((b) => b.textContent === 'Analysis')
        .click(),
    );
    await page.click('.move-grid .mv[data-san="Nxb5"]');
    await pause(700);
    await settings({ theme: 'light', cloudEval: false, boardTheme: 'green', pieceSet: 'merida' });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.pv', { timeout: 60_000 });
    await pause(4000);
    await page.screenshot({ path: 'docs/screenshots/analysis-light.png' });
    await settings({ theme: 'dark', cloudEval: false });
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.pv', { timeout: 60_000 });
    await pause(4000);
    const fit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollY: window.scrollY,
    }));
    if (fit.overflow <= 0 && fit.scrollY === 0)
      log('mobile: no horizontal overflow, page not scrolled on load');
    else fail(`mobile layout: overflow ${fit.overflow}px, scrolled to ${fit.scrollY}px`);
    await page.screenshot({ path: 'docs/screenshots/mobile.png' });
    log('screenshots: play, light theme, mobile');
  }

  if (errors.length) fail(`page errors:\n    ${errors.join('\n    ')}`);
  else log('no errors in the console');
} catch (err) {
  fail(err.stack ?? String(err));
  const state = await page
    ?.evaluate(() => ({
      mode: document.querySelector('.modes .on')?.textContent,
      engine: document.querySelector('.engine')?.textContent,
      moves: document.querySelectorAll('.move-grid .mv').length,
    }))
    .catch(() => undefined);
  if (state) console.error('    page state:', JSON.stringify(state));
  if (errors.length) console.error(`    page errors:\n    ${errors.join('\n    ')}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (process.exitCode) console.error('\nEnd-to-end test failed.');
else console.log('\nEnd-to-end test passed.');
