import { PIECE_VALUE, playUci, readFen, type Color } from './chess';
import { scoreToCp, winPercent, winPercentFor, type Score } from './eval';
import { attackersOf } from './tactics';
import type { MoveClass } from './tree';

/**
 * Thresholds in winning-chance points (0–100) lost by the mover. The inaccuracy/mistake/blunder
 * boundaries follow Lichess, which judges moves by winning chances rather than raw centipawns.
 */
export const LOSS = { best: 0.5, excellent: 2, good: 5, inaccuracy: 10, mistake: 15 } as const;

export interface PlyFacts {
  color: Color;
  /** Evaluation before the move (White's point of view). */
  before: Score;
  /** Evaluation after the move. */
  after: Score;
  played: string;
  /** Engine's best move in the position before. */
  best?: string;
  /** Evaluation of the second-best move, to spot "only moves". */
  secondBest?: Score;
  /**
   * The played move's score from the same search as `before`, when it was one of the
   * engine's top lines. Comparing within one search avoids grading a move on the noise
   * between two independent searches.
   */
  playedScore?: Score;
  /** Taking back on the square where the opponent just captured: never "great". */
  isRecapture?: boolean;
  legalMoves: number;
  isBook: boolean;
  isSacrifice: boolean;
  previousOpponentClass?: MoveClass;
}

export interface PlyVerdict {
  cls: MoveClass;
  loss: number;
  accuracy: number;
  winBefore: number;
  winAfter: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Lichess move accuracy from winning chances before and after the move. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const raw =
    103.1668100711649 * Math.exp(-0.04354415386753951 * (winBefore - winAfter)) - 3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

export function classifyPly(f: PlyFacts): PlyVerdict {
  const winBefore = winPercentFor(f.before, f.color);
  const winAfter = winPercentFor(f.playedScore ?? f.after, f.color);
  const loss = Math.max(0, winBefore - winAfter);
  const accuracy = moveAccuracy(winBefore, winAfter);
  const isBest = f.best !== undefined && f.best === f.played;
  const sound = winAfter >= 50 && winBefore < 97;

  let cls: MoveClass;
  if (f.legalMoves === 1) cls = 'forced';
  else if (f.isBook) cls = 'book';
  else if (isBest || loss < LOSS.best) {
    cls = 'best';
    if (f.isSacrifice && sound) cls = 'brilliant';
    else if (isBest && !f.isRecapture && f.secondBest && winBefore > 10 && winBefore < 95) {
      if (winAfter - winPercentFor(f.secondBest, f.color) >= 10) cls = 'great';
    }
  } else if (loss < LOSS.excellent) cls = f.isSacrifice && sound ? 'brilliant' : 'excellent';
  else if (loss < LOSS.good) cls = 'good';
  else if (loss < LOSS.inaccuracy) cls = 'inaccuracy';
  else if (loss < LOSS.mistake) cls = 'mistake';
  else cls = 'blunder';

  const opponentErred =
    f.previousOpponentClass === 'mistake' ||
    f.previousOpponentClass === 'blunder' ||
    f.previousOpponentClass === 'miss';
  if ((cls === 'mistake' || cls === 'blunder') && opponentErred && winBefore >= 60) cls = 'miss';

  return { cls, loss, accuracy, winBefore, winAfter };
}

/**
 * Detects a sacrifice: the moved piece (worth at least a minor piece) can be taken after the move,
 * and taking it would cost the mover at least two points net.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const start = readFen(fenBefore);
  if (!start.ok) return false;
  const pos = start.pos.clone();
  const mover = pos.turn;
  const played = playUci(pos, uci);
  if (!played || played.isCastle) return false;
  const to = played.move.to;
  const role = pos.board.getRole(to);
  if (!role || role === 'king' || role === 'pawn') return false;
  const value = PIECE_VALUE[role];
  const captured = played.captured ? PIECE_VALUE[played.captured] : 0;
  if (value - captured < 2) return false;
  const enemy = mover === 'white' ? 'black' : 'white';
  const attackers = attackersOf(pos.board, to, enemy);
  if (attackers.isEmpty()) return false;
  const defenders = attackersOf(pos.board, to, mover);
  let cheapestAttacker = Infinity;
  for (const s of attackers) {
    const r = pos.board.getRole(s)!;
    cheapestAttacker = Math.min(cheapestAttacker, r === 'king' ? 100 : PIECE_VALUE[r]);
  }
  // A king can only recapture an undefended piece.
  if (cheapestAttacker === 100 && defenders.nonEmpty()) return false;
  return defenders.isEmpty() || cheapestAttacker < value;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Game accuracy exactly as Lichess computes it: the average of a volatility-weighted mean
 * and the harmonic mean of per-move accuracies. `whiteWin` holds White's winning chances for
 * the starting position and after every ply.
 */
export function gameAccuracy(
  whiteWin: number[],
  firstMover: Color,
  /** Per-ply White winning chances from a verification search, replacing the pair for that move. */
  verified?: ReadonlyArray<{ before: number; after: number } | undefined>,
): { white?: number; black?: number } {
  const plies = whiteWin.length - 1;
  if (plies < 1) return {};
  const windowSize = clamp(Math.floor(plies / 10), 2, 8);
  const windows: number[][] = [];
  const head = whiteWin.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, whiteWin.length) - 2; i++) windows.push(head);
  for (let i = 0; i + windowSize <= whiteWin.length; i++)
    windows.push(whiteWin.slice(i, i + windowSize));
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12));

  const per: Record<Color, Array<[number, number]>> = { white: [], black: [] };
  for (let i = 0; i < plies; i++) {
    const color: Color = (i % 2 === 0) === (firstMover === 'white') ? 'white' : 'black';
    const prev = verified?.[i]?.before ?? whiteWin[i]!;
    const next = verified?.[i]?.after ?? whiteWin[i + 1]!;
    const acc = color === 'white' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    per[color].push([acc, weights[i] ?? 0.5]);
  }

  const combine = (list: Array<[number, number]>): number | undefined => {
    if (!list.length) return undefined;
    const weighted = list.reduce((s, [a, w]) => s + a * w, 0) / list.reduce((s, [, w]) => s + w, 0);
    const harmonic = list.length / list.reduce((s, [a]) => s + 1 / Math.max(a, 1), 0);
    return (weighted + harmonic) / 2;
  };
  return { white: combine(per.white), black: combine(per.black) };
}

/** Average centipawn loss per side, with mates capped at ±1000 like Lichess. */
export function averageCpLoss(
  scores: Score[],
  firstMover: Color,
  verified?: ReadonlyArray<{ before: Score; after: Score } | undefined>,
): { white?: number; black?: number } {
  const loss: Record<Color, number[]> = { white: [], black: [] };
  for (let i = 0; i + 1 < scores.length; i++) {
    const color: Color = (i % 2 === 0) === (firstMover === 'white') ? 'white' : 'black';
    const sign = color === 'white' ? 1 : -1;
    const v = verified?.[i];
    const drop =
      (scoreToCp(v?.before ?? scores[i]!) - scoreToCp(v?.after ?? scores[i + 1]!)) * sign;
    loss[color].push(Math.max(0, drop));
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(mean(xs)) : undefined);
  return { white: avg(loss.white), black: avg(loss.black) };
}

export const whiteWinSeries = (scores: Score[]): number[] => scores.map(winPercent);

export const CLASS_LABEL: Record<MoveClass, string> = {
  brilliant: 'Brilliant',
  great: 'Great move',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book move',
  forced: 'Forced',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Missed win',
  blunder: 'Blunder',
};

export const CLASS_GLYPH: Record<MoveClass, string> = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '✓',
  good: '✓',
  book: '≡',
  forced: '□',
  inaccuracy: '?!',
  mistake: '?',
  miss: '✗',
  blunder: '??',
};

export const CLASS_ORDER: MoveClass[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];
