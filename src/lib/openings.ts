import { epdOf, fenOf, playUci, readFen } from './chess';
import type { TreeNode } from './tree';

export interface Opening {
  eco: string;
  name: string;
}

type Db = Record<string, [string, string]>;

let db: Db | undefined;
let loading: Promise<Db> | undefined;

/** Loads the ~3,800-line Lichess openings table on demand (it is split into its own chunk). */
export function loadOpenings(): Promise<Db> {
  if (db) return Promise.resolve(db);
  loading ??= import('../data/openings.json').then((m) => {
    db = (m.default ?? m) as unknown as Db;
    return db;
  });
  return loading;
}

export const openingsReady = (): boolean => db !== undefined;

/** For tests and scripts that already hold the table. */
export function setOpeningsDb(table: Db): void {
  db = table;
}

export function lookupOpening(fen: string): Opening | undefined {
  const hit = db?.[epdOf(fen)];
  return hit ? { eco: hit[0], name: hit[1] } : undefined;
}

/** The most specific named opening along a line of play. */
export function openingOfLine(nodes: readonly TreeNode[]): Opening | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const hit = lookupOpening(nodes[i]!.fen);
    if (hit) return hit;
  }
  return undefined;
}

export const isBookPosition = (fen: string): boolean => lookupOpening(fen) !== undefined;

export interface BookMove {
  uci: string;
  san: string;
  opening: Opening;
}

/** Legal moves from `fen` that lead to a named opening position. */
export function bookMoves(fen: string): BookMove[] {
  if (!db) return [];
  const start = readFen(fen);
  if (!start.ok) return [];
  const out: BookMove[] = [];
  for (const [from, dests] of start.pos.allDests()) {
    for (const to of dests) {
      const pos = start.pos.clone();
      const uci = squareName(from) + squareName(to);
      const promo = pos.board.getRole(from) === 'pawn' && (to >= 56 || to < 8) ? 'q' : '';
      const played = playUci(pos, uci + promo);
      if (!played) continue;
      const opening = lookupOpening(fenOf(pos));
      if (opening) out.push({ uci: played.uci, san: played.san, opening });
    }
  }
  return out.sort((a, b) => a.opening.name.localeCompare(b.opening.name));
}

const squareName = (sq: number): string =>
  String.fromCharCode(97 + (sq % 8)) + (Math.floor(sq / 8) + 1);
