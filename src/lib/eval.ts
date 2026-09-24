import type { Color } from './chess';

/** An engine score from White's point of view: centipawns or moves to mate (positive = White mates). */
export type Score = { cp: number; mate?: undefined } | { mate: number; cp?: undefined };

export interface PvLine {
  multipv: number;
  score: Score;
  /** Principal variation in UCI notation. */
  moves: string[];
}

export interface PositionEval {
  epd: string;
  depth: number;
  seldepth?: number;
  lines: PvLine[];
  /** Win/draw/loss in per-mille, White's point of view. */
  wdl?: [number, number, number];
  nodes?: number;
  nps?: number;
  source: 'local' | 'cloud';
  /** True once the search reached its target and stopped by itself. */
  done?: boolean;
}

export const MATE_CP = 1000;

/** Lichess's model of winning chances for a centipawn advantage (https://lichess.org/page/accuracy). */
export function winPercentFromCp(cp: number): number {
  const clamped = Math.max(-MATE_CP, Math.min(MATE_CP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Centipawns with mates mapped to ±1000, as Lichess does for accuracy. */
export function scoreToCp(score: Score): number {
  if (score.mate !== undefined) return score.mate >= 0 ? MATE_CP : -MATE_CP;
  return Math.max(-MATE_CP, Math.min(MATE_CP, score.cp));
}

/** White's winning chances in percent. */
export function winPercent(score: Score): number {
  if (score.mate !== undefined) return score.mate >= 0 ? 100 : 0;
  return winPercentFromCp(score.cp);
}

export const winPercentFor = (score: Score, color: Color): number =>
  color === 'white' ? winPercent(score) : 100 - winPercent(score);

/**
 * Converts a side-to-move score (what UCI engines report) into White's point of view.
 * "mate 0" means the side to move is already checkmated; it carries no sign, so it is
 * mapped to the ±1000 centipawn ceiling instead.
 */
export function fromSideToMove(raw: { cp?: number; mate?: number }, turn: Color): Score {
  const sign = turn === 'white' ? 1 : -1;
  if (raw.mate === 0) return { cp: -MATE_CP * sign };
  if (raw.mate !== undefined) return { mate: raw.mate * sign };
  return { cp: (raw.cp ?? 0) * sign };
}

const MINUS = '\u2212';

/** "+0.34", "−1.20", "#4", "#−3" — as chess players write evaluations. */
export function formatScore(score: Score | undefined): string {
  if (!score) return '–';
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return score.mate > 0 ? `#${score.mate}` : `#${MINUS}${-score.mate}`;
  }
  const pawns = score.cp / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return (pawns > 0 ? '+' : MINUS) + Math.abs(pawns).toFixed(2);
}

/** Short form for the evaluation bar. */
export function formatScoreShort(score: Score | undefined): string {
  if (!score) return '';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : `M${Math.abs(score.mate)}`;
  const pawns = Math.abs(score.cp / 100);
  return pawns >= 10 ? pawns.toFixed(0) : pawns.toFixed(1);
}

/**
 * The evaluation symbols used in chess literature since Chess Informator:
 * = equal, ⩲/⩱ slight edge, ±/∓ clear advantage, +−/−+ decisive.
 */
export function informator(score: Score | undefined): { symbol: string; label: string } {
  if (!score) return { symbol: '', label: '' };
  if (score.mate !== undefined) {
    return score.mate >= 0
      ? { symbol: '+−', label: 'White is mating' }
      : { symbol: '−+', label: 'Black is mating' };
  }
  const p = score.cp / 100;
  if (p >= 1.5) return { symbol: '+−', label: 'White is winning' };
  if (p >= 0.7) return { symbol: '±', label: 'White is clearly better' };
  if (p >= 0.3) return { symbol: '⩲', label: 'White is slightly better' };
  if (p > -0.3) return { symbol: '=', label: 'The position is equal' };
  if (p > -0.7) return { symbol: '⩱', label: 'Black is slightly better' };
  if (p > -1.5) return { symbol: '∓', label: 'Black is clearly better' };
  return { symbol: '−+', label: 'Black is winning' };
}

/** Evaluation bar fill for White, 0–100. Matches the winning-chances curve so the bar "feels" right. */
export const evalBarPercent = (score: Score | undefined): number =>
  score ? Math.max(2, Math.min(98, winPercent(score))) : 50;

export function bestLine(ev: PositionEval | undefined): PvLine | undefined {
  return ev?.lines.find((l) => l.multipv === 1) ?? ev?.lines[0];
}

/** Lines sorted by rank, keeping only the first line for each first move. */
export function uniqueLines(lines: PvLine[]): PvLine[] {
  const seen = new Set<string>();
  return [...lines]
    .sort((a, b) => a.multipv - b.multipv)
    .filter((l) => {
      const first = l.moves[0];
      if (!first || seen.has(first)) return false;
      seen.add(first);
      return true;
    })
    .map((l, i) => ({ ...l, multipv: i + 1 }));
}
