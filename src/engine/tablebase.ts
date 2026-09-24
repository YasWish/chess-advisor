import { pieceCount } from '../lib/chess';

export type TbCategory =
  | 'win'
  | 'syzygy-win'
  | 'maybe-win'
  | 'cursed-win'
  | 'draw'
  | 'blessed-loss'
  | 'maybe-loss'
  | 'syzygy-loss'
  | 'loss'
  | 'unknown';

export interface TbMove {
  uci: string;
  san: string;
  /** Category of the position after the move, i.e. from the opponent's point of view. */
  category: TbCategory;
  dtz?: number | null;
  dtm?: number | null;
  checkmate?: boolean;
  stalemate?: boolean;
}

export interface TbResult {
  category: TbCategory;
  dtz?: number | null;
  dtm?: number | null;
  checkmate?: boolean;
  stalemate?: boolean;
  moves: TbMove[];
}

// Lichess moved its API hosts from .ovh to .org in 2026; try both.
const HOSTS = ['https://tablebase.lichess.org', 'https://tablebase.lichess.ovh'];
const cache = new Map<string, TbResult | null>();

/** Syzygy tables cover up to seven pieces and no castling rights. */
export const tablebaseEligible = (fen: string): boolean =>
  pieceCount(fen) <= 7 && (fen.split(' ')[2] ?? '-') === '-';

export async function probeTablebase(
  fen: string,
  signal?: AbortSignal,
): Promise<TbResult | undefined> {
  if (!tablebaseEligible(fen)) return undefined;
  if (cache.has(fen)) return cache.get(fen) ?? undefined;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/standard?fen=${encodeURIComponent(fen)}`, { signal });
      if (!res.ok) continue;
      const data = (await res.json()) as TbResult;
      cache.set(fen, data);
      return data;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return undefined;
    }
  }
  return undefined;
}

export type TbOutcome = 'win' | 'draw' | 'loss' | 'unknown';

/** Outcome for the side to move. */
export function tbOutcome(c: TbCategory): TbOutcome {
  if (c === 'win' || c === 'syzygy-win' || c === 'maybe-win') return 'win';
  if (c === 'loss' || c === 'syzygy-loss' || c === 'maybe-loss') return 'loss';
  if (c === 'unknown') return 'unknown';
  return 'draw';
}

/** Outcome for the player making `move` (the API reports it from the opponent's side). */
export function tbMoveOutcome(move: TbMove): TbOutcome {
  const o = tbOutcome(move.category);
  return o === 'win' ? 'loss' : o === 'loss' ? 'win' : o;
}
