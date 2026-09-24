#!/usr/bin/env node
/**
 * Builds src/data/openings.json from the Lichess chess-openings dataset (CC0).
 * Each opening is keyed by EPD (board, side to move, castling, en passant) so that
 * transpositions are recognised. Run with `npm run openings`.
 */
import { writeFileSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const out = {};
let count = 0;

for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}${file}.tsv`);
  if (!res.ok) throw new Error(`Failed to download ${file}.tsv: ${res.status}`);
  const lines = (await res.text()).trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const pos = Chess.default();
    for (const token of pgn.split(/\s+/)) {
      if (/^\d+\.$/.test(token)) continue;
      const move = parseSan(pos, token);
      if (!move) throw new Error(`Illegal move ${token} in ${name}`);
      pos.play(move);
    }
    const epd = makeFen(pos.toSetup(), { epd: true });
    // Keep the most specific (longest) name when two lines reach the same position.
    const prev = out[epd];
    if (!prev || prev[1].length < name.length) out[epd] = [eco, name];
    count++;
  }
}

writeFileSync(new URL('../src/data/openings.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} positions from ${count} openings.`);
