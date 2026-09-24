import {
  bishopAttacks,
  attacks,
  between,
  kingAttacks,
  knightAttacks,
  pawnAttacks,
  ray,
  rookAttacks,
} from 'chessops/attacks';
import type { Board } from 'chessops/board';
import { SquareSet } from 'chessops/squareSet';
import type { Color, Role, Square } from 'chessops/types';
import { makeSquare, opposite, squareFile, squareRank } from 'chessops/util';
import { PIECE_NAME, PIECE_VALUE } from './chess';

export const sq = (s: Square): string => makeSquare(s);

export function attackersOf(
  board: Board,
  target: Square,
  by: Color,
  occupied = board.occupied,
): SquareSet {
  return board[by].intersect(
    knightAttacks(target)
      .intersect(board.knight)
      .union(kingAttacks(target).intersect(board.king))
      .union(bishopAttacks(target, occupied).intersect(board.bishop.union(board.queen)))
      .union(rookAttacks(target, occupied).intersect(board.rook.union(board.queen)))
      .union(pawnAttacks(opposite(by), target).intersect(board.pawn)),
  );
}

const valueAt = (board: Board, s: Square): number => PIECE_VALUE[board.getRole(s) ?? 'pawn'];

function cheapest(board: Board, set: SquareSet): number {
  let min = Infinity;
  for (const s of set) min = Math.min(min, board.getRole(s) === 'king' ? 100 : valueAt(board, s));
  return min;
}

export interface Hanging {
  square: Square;
  role: Role;
  attackers: number;
  defenders: number;
}

/** Pieces of `color` that the opponent can win: undefended, or attacked by something cheaper. */
export function hangingPieces(board: Board, color: Color): Hanging[] {
  const out: Hanging[] = [];
  for (const s of board[color]) {
    const role = board.getRole(s)!;
    if (role === 'king') continue;
    const att = attackersOf(board, s, opposite(color));
    if (att.isEmpty()) continue;
    const def = attackersOf(board, s, color);
    const value = PIECE_VALUE[role];
    const underDefended = def.isEmpty() || cheapest(board, att) < value;
    if (underDefended) out.push({ square: s, role, attackers: att.size(), defenders: def.size() });
  }
  return out.sort((a, b) => PIECE_VALUE[b.role] - PIECE_VALUE[a.role]);
}

export interface Pin {
  pinned: Square;
  by: Square;
  to: Square;
  absolute: boolean;
}

/** Pieces of `color` pinned to their king (absolute) or to their queen (relative). */
export function findPins(board: Board, color: Color): Pin[] {
  const out: Pin[] = [];
  const enemy = opposite(color);
  const targets = [...board.pieces(color, 'king'), ...board.pieces(color, 'queen')];
  for (const target of targets) {
    const absolute = board.getRole(target) === 'king';
    const diag = bishopAttacks(target, SquareSet.empty()).intersect(
      board.bishop.union(board.queen),
    );
    const orth = rookAttacks(target, SquareSet.empty()).intersect(board.rook.union(board.queen));
    for (const slider of diag.union(orth).intersect(board[enemy])) {
      if (!absolute && board.getRole(slider) === 'queen') continue;
      const blockers = between(slider, target).intersect(board.occupied);
      const pinned = blockers.singleSquare();
      if (pinned === undefined || !board[color].has(pinned)) continue;
      if (!absolute && valueAt(board, pinned) >= PIECE_VALUE.queen) continue;
      out.push({ pinned, by: slider, to: target, absolute });
    }
  }
  return out;
}

const isValuableTarget = (
  board: Board,
  target: Square,
  attackerValue: number,
  side: Color,
): boolean => {
  const role = board.getRole(target);
  if (!role) return false;
  if (role === 'king') return true;
  if (PIECE_VALUE[role] > attackerValue) return true;
  return role !== 'pawn' && attackersOf(board, target, side).isEmpty();
};

/** Enemy pieces worth attacking from `from`: the king, anything more valuable, or anything undefended. */
export function forkTargets(board: Board, from: Square): Square[] {
  const piece = board.get(from);
  if (!piece) return [];
  const enemy = opposite(piece.color);
  const hit = attacks(piece, from, board.occupied).intersect(board[enemy]);
  const value = PIECE_VALUE[piece.role] || 100;
  return [...hit].filter((t) => isValuableTarget(board, t, value, enemy));
}

export interface Skewer {
  by: Square;
  front: Square;
  back: Square;
}

/** A slider attacking a valuable piece with a lesser one behind it on the same line. */
export function findSkewers(board: Board, color: Color, only?: Square): Skewer[] {
  const out: Skewer[] = [];
  const enemy = opposite(color);
  const sliders = board[color].intersect(board.bishop.union(board.rook).union(board.queen));
  for (const s of only !== undefined ? [only] : sliders) {
    const piece = board.get(s);
    if (!piece || !['bishop', 'rook', 'queen'].includes(piece.role)) continue;
    for (const front of attacks(piece, s, board.occupied).intersect(board[enemy])) {
      const frontRole = board.getRole(front)!;
      if (!['king', 'queen', 'rook'].includes(frontRole)) continue;
      const line = ray(s, front);
      const beyond = attacks(piece, s, board.occupied.without(front))
        .intersect(line)
        .intersect(board.occupied)
        .diff(between(s, front))
        .without(front);
      const back = beyond.singleSquare();
      if (back === undefined || !board[enemy].has(back)) continue;
      const frontValue = frontRole === 'king' ? 100 : PIECE_VALUE[frontRole];
      if (frontValue > valueAt(board, back) && valueAt(board, back) >= 3)
        out.push({ by: s, front, back });
    }
  }
  return out;
}

export interface Discovered {
  by: Square;
  target: Square;
}

/** Attacks by other pieces that open up because a piece left `from`. */
export function discoveredAttacks(
  before: Board,
  after: Board,
  from: Square,
  to: Square,
  color: Color,
): Discovered[] {
  const out: Discovered[] = [];
  const enemy = opposite(color);
  const sliders = after[color]
    .intersect(after.bishop.union(after.rook).union(after.queen))
    .without(to);
  for (const s of sliders) {
    const piece = after.get(s)!;
    const was = attacks(piece, s, before.occupied);
    const now = attacks(piece, s, after.occupied);
    for (const target of now.diff(was).intersect(after[enemy])) {
      if (!ray(s, target).has(from)) continue;
      const role = after.getRole(target)!;
      if (
        role === 'king' ||
        role === 'queen' ||
        isValuableTarget(after, target, PIECE_VALUE[piece.role], enemy)
      ) {
        out.push({ by: s, target });
      }
    }
  }
  return out;
}

/** The king sits on its back rank with no flight squares off it, and the enemy has heavy pieces. */
export function weakBackRank(board: Board, color: Color): boolean {
  const king = board.kingOf(color);
  if (king === undefined) return false;
  const backRank = color === 'white' ? 0 : 7;
  if (squareRank(king) !== backRank) return false;
  const enemy = opposite(color);
  if (board[enemy].intersect(board.rook.union(board.queen)).isEmpty()) return false;
  const occupiedNoKing = board.occupied.without(king);
  for (const s of kingAttacks(king)) {
    if (squareRank(s) === backRank) continue;
    if (board[color].has(s)) continue;
    if (attackersOf(board, s, enemy, occupiedNoKing).isEmpty()) return false;
  }
  return true;
}

/** Pawns of `color` on their seventh rank, or passed pawns on the sixth. */
export function advancedPawns(board: Board, color: Color): Square[] {
  const out: Square[] = [];
  const dir = color === 'white' ? 1 : -1;
  const enemyPawns = board.pieces(opposite(color), 'pawn');
  for (const p of board.pieces(color, 'pawn')) {
    const relRank = color === 'white' ? squareRank(p) : 7 - squareRank(p);
    if (relRank < 5) continue;
    if (relRank === 6) {
      out.push(p);
      continue;
    }
    const file = squareFile(p);
    let passed = true;
    for (const e of enemyPawns) {
      const ahead = (squareRank(e) - squareRank(p)) * dir > 0;
      if (ahead && Math.abs(squareFile(e) - file) <= 1) passed = false;
    }
    if (passed) out.push(p);
  }
  return out;
}

export const nameAt = (board: Board, s: Square): string =>
  `${PIECE_NAME[board.getRole(s) ?? 'pawn']} on ${sq(s)}`;
