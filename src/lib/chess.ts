import { Chess, castlingSide } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Color, NormalMove, Role, Square } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseUci } from 'chessops/util';

export { INITIAL_FEN };
export type { Color, Role, Square };

export const PIECE_VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

export const PIECE_NAME: Record<Role, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

export type FenResult = { ok: true; pos: Chess } | { ok: false; error: string };

const FEN_ERRORS: Record<string, string> = {
  ERR_FEN: 'This is not a valid FEN string.',
  ERR_BOARD: 'The board part of the FEN is malformed.',
  ERR_TURN: 'The side to move must be "w" or "b".',
  ERR_CASTLING: 'The castling rights are malformed.',
  ERR_EP_SQUARE: 'The en passant square is malformed.',
  ERR_HALFMOVES: 'The halfmove clock is malformed.',
  ERR_FULLMOVES: 'The move number is malformed.',
  ERR_EMPTY: 'The board is empty.',
  ERR_KINGS: 'Each side needs exactly one king.',
  ERR_OPPOSITE_CHECK: 'The side not to move is in check.',
  ERR_PAWNS_ON_BACKRANK: 'Pawns cannot stand on the first or last rank.',
  ERR_IMPOSSIBLE_CHECK: 'The position has an impossible check.',
  ERR_VARIANT: 'Only standard chess is supported.',
};

/** Parses and validates a FEN, returning a human-readable error if it is illegal. */
export function readFen(fen: string): FenResult {
  const setup = parseFen(fen.trim());
  if (setup.isErr)
    return { ok: false, error: FEN_ERRORS[setup.error.message] ?? setup.error.message };
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return { ok: false, error: FEN_ERRORS[pos.error.message] ?? pos.error.message };
  return { ok: true, pos: pos.value };
}

export function positionFromFen(fen: string): Chess {
  const r = readFen(fen);
  if (!r.ok) throw new Error(r.error);
  return r.pos;
}

export const fenOf = (pos: Chess): string => makeFen(pos.toSetup());

/** EPD = FEN without move counters. Used as the cache key for evaluations and openings. */
export const epdOf = (fenOrPos: string | Chess): string =>
  typeof fenOrPos === 'string'
    ? fenOrPos.trim().split(/\s+/).slice(0, 4).join(' ')
    : makeFen(fenOrPos.toSetup(), { epd: true });

export const colorName = (c: Color): string => (c === 'white' ? 'White' : 'Black');

/** Rewrites king-takes-rook castling (e1h1) into standard UCI (e1g1), which Stockfish expects. */
export function standardUci(pos: Chess, move: NormalMove): string {
  const side = castlingSide(pos, move);
  if (side) return makeSquare(move.from) + makeSquare(kingCastlesTo(pos.turn, side));
  return makeUci(move);
}

export interface PlayedMove {
  uci: string;
  san: string;
  move: NormalMove;
  captured?: Role;
  isCastle: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  promotion?: Role;
}

/** Validates `uci` in `pos` and plays it (mutating `pos`). Returns undefined for illegal moves. */
export function playUci(pos: Chess, uci: string): PlayedMove | undefined {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed) || !pos.isLegal(parsed)) return undefined;
  const move = parsed;
  const isCastle = !!castlingSide(pos, move);
  const captured = isCastle
    ? undefined
    : (pos.board.get(move.to)?.role ??
      (pos.board.get(move.from)?.role === 'pawn' && pos.epSquare === move.to ? 'pawn' : undefined));
  const normalized = standardUci(pos, move);
  const san = makeSan(pos, move);
  pos.play(move);
  return {
    uci: normalized,
    san,
    move,
    captured,
    isCastle,
    isCheck: pos.isCheck(),
    isCheckmate: pos.isCheckmate(),
    promotion: move.promotion,
  };
}

/** Converts a UCI line into SAN, stopping at the first illegal move. */
export function sanLine(fen: string, ucis: readonly string[], limit = ucis.length): string[] {
  const r = readFen(fen);
  if (!r.ok) return [];
  const out: string[] = [];
  for (const uci of ucis.slice(0, limit)) {
    const played = playUci(r.pos, uci);
    if (!played) break;
    out.push(played.san);
  }
  return out;
}

export function legalDests(pos: Chess): Map<string, string[]> {
  return chessgroundDests(pos) as Map<string, string[]>;
}

export function countLegalMoves(pos: Chess): number {
  let n = 0;
  for (const [, dests] of pos.allDests()) n += dests.size();
  return n;
}

/** The position with the side to move swapped — used to ask "what does the opponent threaten?". */
export function nullMoveFen(fen: string): string | undefined {
  const r = readFen(fen);
  if (!r.ok || r.pos.isCheck()) return undefined;
  const setup = r.pos.toSetup();
  setup.turn = setup.turn === 'white' ? 'black' : 'white';
  setup.epSquare = undefined;
  const swapped = Chess.fromSetup(setup);
  if (swapped.isErr) return undefined;
  return fenOf(swapped.value);
}

export function materialOf(pos: Chess, color: Color): number {
  let sum = 0;
  for (const sq of pos.board[color]) {
    const role = pos.board.getRole(sq);
    if (role) sum += PIECE_VALUE[role];
  }
  return sum;
}

/** Material balance in pawns from White's point of view. */
export const materialBalance = (pos: Chess): number =>
  materialOf(pos, 'white') - materialOf(pos, 'black');

export function pieceCount(fen: string): number {
  return (fen.split(' ')[0] ?? '').replace(/[^a-zA-Z]/g, '').length;
}

export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient'
  | 'fifty-moves'
  | 'repetition'
  | 'timeout'
  | 'resignation'
  | 'agreement';

export interface Outcome {
  winner?: Color;
  termination: Termination;
}

/** Rules-based game end for a position. Repetition needs history, so callers pass a count. */
export function positionOutcome(pos: Chess, repetitions = 1): Outcome | undefined {
  if (pos.isCheckmate())
    return { winner: pos.turn === 'white' ? 'black' : 'white', termination: 'checkmate' };
  if (pos.isStalemate()) return { termination: 'stalemate' };
  if (pos.isInsufficientMaterial()) return { termination: 'insufficient' };
  if (pos.halfmoves >= 100) return { termination: 'fifty-moves' };
  if (repetitions >= 3) return { termination: 'repetition' };
  return undefined;
}

export function describeOutcome(o: Outcome): string {
  const who = o.winner ? `${colorName(o.winner)} wins` : 'Draw';
  const why: Record<Termination, string> = {
    checkmate: 'by checkmate',
    stalemate: 'by stalemate',
    insufficient: 'by insufficient material',
    'fifty-moves': 'by the fifty-move rule',
    repetition: 'by threefold repetition',
    timeout: 'on time',
    resignation: 'by resignation',
    agreement: 'by agreement',
  };
  return `${who} ${why[o.termination]}`;
}

export const resultString = (o: Outcome | undefined): string =>
  !o ? '*' : o.winner === 'white' ? '1-0' : o.winner === 'black' ? '0-1' : '1/2-1/2';

export const squareOf = (name: string): Square | undefined => {
  if (!/^[a-h][1-8]$/.test(name)) return undefined;
  return name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8;
};
