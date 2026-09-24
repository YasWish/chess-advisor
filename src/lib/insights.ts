import type { Chess } from 'chessops/chess';
import type { Color } from 'chessops/types';
import { opposite, squareRank } from 'chessops/util';
import {
  PIECE_NAME,
  PIECE_VALUE,
  colorName,
  materialBalance,
  playUci,
  readFen,
  sanLine,
} from './chess';
import { formatScore, informator, type PvLine, type Score } from './eval';
import { isSacrifice } from './review';
import {
  advancedPawns,
  discoveredAttacks,
  findPins,
  findSkewers,
  forkTargets,
  hangingPieces,
  nameAt,
  sq,
  weakBackRank,
} from './tactics';

export interface Insight {
  tone: 'good' | 'bad' | 'neutral';
  text: string;
  squares: string[];
}

export interface Explanation {
  san: string;
  summary: string;
  points: string[];
  squares: string[];
}

const role = (pos: Chess, s: number) => PIECE_NAME[pos.board.getRole(s) ?? 'pawn'];

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeMaterial(pos: Chess): string {
  const diff = materialBalance(pos);
  if (diff === 0) return 'Material is level.';
  const side = diff > 0 ? 'White' : 'Black';
  const n = Math.abs(diff);
  const count = (c: Color, r: 'rook' | 'knight' | 'bishop' | 'queen') =>
    pos.board.pieces(c, r).size();
  const leader: Color = diff > 0 ? 'white' : 'black';
  const other = opposite(leader);
  const minors = (c: Color) => count(c, 'knight') + count(c, 'bishop');
  let what = `${n} points of material`;
  if (n === 1) what = 'a pawn';
  else if (
    n === 2 &&
    count(leader, 'rook') > count(other, 'rook') &&
    minors(leader) < minors(other)
  )
    what = 'the exchange';
  else if (n === 2) what = 'two pawns';
  else if (n === 3 && minors(leader) > minors(other)) what = 'a piece';
  else if (n === 5 && count(leader, 'rook') > count(other, 'rook')) what = 'a rook';
  else if (n >= 8 && count(leader, 'queen') > count(other, 'queen')) what = 'a queen';
  return `${side} is up ${what} (+${n}).`;
}

/** Static observations about a position, for both sides. */
export function positionInsights(fen: string): Insight[] {
  const r = readFen(fen);
  if (!r.ok) return [];
  const pos = r.pos;
  const board = pos.board;
  const out: Insight[] = [{ tone: 'neutral', text: describeMaterial(pos), squares: [] }];
  const toMove = pos.turn;

  for (const color of [toMove, opposite(toMove)] as Color[]) {
    const who = colorName(color);
    const mine = color === toMove;
    for (const h of hangingPieces(board, color).slice(0, 3)) {
      const how =
        h.defenders === 0 ? 'is undefended and attacked' : 'is attacked by a cheaper piece';
      out.push({
        tone: mine ? 'bad' : 'good',
        text: mine
          ? `Your ${PIECE_NAME[h.role]} on ${sq(h.square)} ${how}.`
          : `${who}'s ${PIECE_NAME[h.role]} on ${sq(h.square)} ${how} — it may be there for the taking.`,
        squares: [sq(h.square)],
      });
    }
    for (const p of findPins(board, color)) {
      out.push({
        tone: mine ? 'bad' : 'good',
        text: `${who}'s ${nameAt(board, p.pinned)} is pinned to the ${role(pos, p.to)} by the ${nameAt(board, p.by)}${p.absolute ? ' and cannot move' : ''}.`,
        squares: [sq(p.pinned), sq(p.by), sq(p.to)],
      });
    }
    if (weakBackRank(board, color)) {
      out.push({
        tone: mine ? 'bad' : 'good',
        text: `${who}'s back rank is weak: the king has no escape square, so a rook or queen check there could be mate.`,
        squares: [sq(board.kingOf(color)!)],
      });
    }
    for (const p of advancedPawns(board, color).slice(0, 2)) {
      const rel = color === 'white' ? squareRank(p) : 7 - squareRank(p);
      out.push({
        tone: mine ? 'good' : 'bad',
        text:
          rel === 6
            ? `${who}'s pawn on ${sq(p)} is one step from promoting.`
            : `${who} has a dangerous passed pawn on ${sq(p)}.`,
        squares: [sq(p)],
      });
    }
  }
  return out;
}

/** Material swing for the mover along a line, measured once the captures stop. */
function materialAlongLine(start: Chess, ucis: string[]): number {
  const mover = start.turn;
  const pos = start.clone();
  const base = materialBalance(pos);
  let settled = base;
  for (const [i, uci] of ucis.slice(0, 10).entries()) {
    const played = playUci(pos, uci);
    if (!played) break;
    const next = ucis[i + 1];
    const nextIsCapture =
      next !== undefined && pos.board.has(Number(squareIndex(next.slice(2, 4))));
    if (!nextIsCapture) settled = materialBalance(pos);
  }
  const diff = settled - base;
  return mover === 'white' ? diff : -diff;
}

const squareIndex = (name: string) => name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8;

/** Describes what the engine's best move does and why it matters. */
export function explainBestMove(
  fen: string,
  best: PvLine,
  alternatives: PvLine[] = [],
): Explanation | undefined {
  const r = readFen(fen);
  const uci = best.moves[0];
  if (!r.ok || !uci) return undefined;
  const before = r.pos;
  const mover = before.turn;
  const after = before.clone();
  const played = playUci(after, uci);
  if (!played) return undefined;
  const { from, to } = played.move;
  const piece = PIECE_NAME[before.board.getRole(from) ?? 'pawn'];
  const squares = [sq(from), sq(to)];

  const sacrifice = isSacrifice(fen, uci);
  let action: string;
  if (sacrifice) {
    action = played.captured
      ? `gives up the ${piece} for the ${PIECE_NAME[played.captured]} on ${sq(to)}`
      : `sacrifices the ${piece} on ${sq(to)}`;
  } else if (played.isCastle)
    action = `castles ${to > from ? 'kingside' : 'queenside'}, tucking the king away`;
  else if (played.promotion) action = `promotes the pawn to a ${PIECE_NAME[played.promotion]}`;
  else if (played.captured)
    action = `takes the ${PIECE_NAME[played.captured]} on ${sq(to)} with the ${piece}`;
  else if (piece === 'pawn') {
    const file = sq(to)[0];
    const double = Math.abs(to - from) === 16;
    const central = (file === 'd' || file === 'e') && before.fullmoves <= 10;
    action = central
      ? 'claims space in the centre'
      : double
        ? `pushes the ${file}-pawn two squares`
        : `pushes the ${file}-pawn`;
  } else {
    const homeRank = mover === 'white' ? 0 : 7;
    const developing =
      (piece === 'knight' || piece === 'bishop') &&
      squareRank(from) === homeRank &&
      before.fullmoves <= 12;
    action = developing ? `develops the ${piece} to ${sq(to)}` : `brings the ${piece} to ${sq(to)}`;
  }

  const motifs: string[] = [];
  if (played.isCheckmate) motifs.push('delivering checkmate');
  else if (played.isCheck) {
    motifs.push(after.ctx().checkers.moreThanOne() ? 'with a double check' : 'with check');
  }
  // A sacrificed piece is simply taken, so forks and pins by it are beside the point.
  const forks = sacrifice ? [] : forkTargets(after.board, to);
  if (forks.length >= 2 && !played.isCheckmate) {
    motifs.push(`forking the ${listJoin(forks.slice(0, 3).map((s) => nameAt(after.board, s)))}`);
    squares.push(...forks.map(sq));
  }
  const enemy = opposite(mover);
  const pinsBefore = new Set(findPins(before.board, enemy).map((p) => `${p.pinned}-${p.to}`));
  for (const p of findPins(after.board, enemy)) {
    if (sacrifice || pinsBefore.has(`${p.pinned}-${p.to}`) || p.by !== to) continue;
    motifs.push(`pinning the ${nameAt(after.board, p.pinned)} to the ${role(after, p.to)}`);
    squares.push(sq(p.pinned));
  }
  for (const s of sacrifice ? [] : findSkewers(after.board, mover, to).slice(0, 1)) {
    motifs.push(`skewering the ${role(after, s.front)} and the ${nameAt(after.board, s.back)}`);
    squares.push(sq(s.front), sq(s.back));
  }
  for (const d of discoveredAttacks(before.board, after.board, from, to, mover).slice(0, 1)) {
    const target = after.board.getRole(d.target);
    motifs.push(
      target === 'king'
        ? `uncovering a discovered check from the ${nameAt(after.board, d.by)}`
        : `uncovering an attack by the ${nameAt(after.board, d.by)} on the ${nameAt(after.board, d.target)}`,
    );
    squares.push(sq(d.by), sq(d.target));
  }
  const hangingBefore = hangingPieces(before.board, mover);
  const hangingAfter = new Set(hangingPieces(after.board, mover).map((h) => h.square));
  const saved = hangingBefore.find((h) =>
    h.square === from
      ? !hangingAfter.has(to)
      : !hangingAfter.has(h.square) && after.board.has(h.square),
  );
  if (saved && !played.captured && motifs.length === 0) {
    motifs.push(
      saved.square === from
        ? `moving the attacked ${piece} to safety`
        : `defending the ${PIECE_NAME[saved.role]} on ${sq(saved.square)}`,
    );
  }

  const withCheck = motifs[0] === 'with check' || motifs[0] === 'with a double check';
  const lead = withCheck ? `${action} ${motifs.shift()}` : action;
  const summary = `${played.san} ${lead}${motifs.length ? `, ${listJoin(motifs)}` : ''}.`;
  const points: string[] = [];
  const who = colorName(mover);
  const score = best.score;
  const line = sanLine(fen, best.moves, 8);
  if (score.mate !== undefined) {
    const forMover = mover === 'white' ? score.mate > 0 : score.mate < 0;
    const n = Math.abs(score.mate);
    points.push(
      forMover
        ? `${who} has a forced mate in ${n}${line.length <= 2 * n ? `: ${formatLine(before, line)}` : ''}.`
        : `${who} is getting mated in ${n}; this move puts up the most resistance.`,
    );
  } else {
    points.push(`${informator(score).label} (${formatScore(score)}).`);
    const gain = materialAlongLine(before, best.moves);
    if (gain >= 1)
      points.push(
        `The main line wins material for ${who}: about ${gain} ${gain === 1 ? 'pawn' : 'pawns'}' worth.`,
      );
    else if (gain <= -2 && (mover === 'white' ? score.cp > -50 : score.cp < 50)) {
      points.push(
        `${who} gives up ${-gain} points of material, but gets enough activity in return.`,
      );
    }
  }
  if (line.length > 1 && score.mate === undefined)
    points.push(`Expected continuation: ${formatLine(before, line)}.`);
  const next = alternatives.find((a) => a.multipv === 2);
  const nextSan = next?.moves[0] ? sanLine(fen, next.moves, 1)[0] : undefined;
  if (next && nextSan) {
    const opponent = colorName(opposite(mover));
    const mates = (sc: Score) =>
      sc.mate !== undefined && (mover === 'white' ? sc.mate > 0 : sc.mate < 0);
    const gap = scoreGap(score, next.score, mover);
    if (mates(score) && mates(next.score)) {
      points.push(`${nextSan} also mates, in ${Math.abs(next.score.mate!)}.`);
    } else if (mates(score)) {
      points.push(
        `Anything else lets ${opponent} off the hook: the next best move, ${nextSan}, is only ${formatScore(next.score)}.`,
      );
    } else if (gap !== undefined) {
      points.push(
        gap < 0.15
          ? `${nextSan} is practically as good (${formatScore(next.score)}).`
          : `The next best move, ${nextSan}, is ${gap.toFixed(2)} pawns worse (${formatScore(next.score)}).`,
      );
    }
  }
  // SAN stays as written: "e4 claims…", not "E4 claims…".
  return { san: played.san, summary, points, squares };
}

function scoreGap(a: Score, b: Score, mover: Color): number | undefined {
  if (a.mate !== undefined || b.mate !== undefined) return undefined;
  const sign = mover === 'white' ? 1 : -1;
  return Math.max(0, ((a.cp - b.cp) * sign) / 100);
}

/** Formats SAN with move numbers from the position's move counter. */
export function formatLine(pos: Chess, sans: string[]): string {
  let n = pos.fullmoves;
  let white = pos.turn === 'white';
  return sans
    .map((san, i) => {
      const prefix = white ? `${n}. ` : i === 0 ? `${n}… ` : '';
      if (!white) n++;
      white = !white;
      return prefix + san;
    })
    .join(' ');
}

/** What the opponent would do if it were their move ("null move" analysis). */
export function describeThreat(fen: string, threat: PvLine): Insight | undefined {
  const r = readFen(fen);
  const uci = threat.moves[0];
  if (!r.ok || !uci) return undefined;
  const pos = r.pos;
  const threatener = pos.turn;
  const san = sanLine(fen, threat.moves, 1)[0];
  if (!san) return undefined;
  const who = colorName(threatener);
  const squares = [uci.slice(0, 2), uci.slice(2, 4)];
  const mateFor =
    threat.score.mate !== undefined &&
    (threatener === 'white' ? threat.score.mate > 0 : threat.score.mate < 0);
  if (mateFor) {
    const n = Math.abs(threat.score.mate!);
    return {
      tone: 'bad',
      text:
        n === 1
          ? `${who} threatens ${san}, which is checkmate.`
          : `${who} threatens mate: ${san} starts a forced mate in ${n}.`,
      squares,
    };
  }
  const gain = materialAlongLine(pos, threat.moves);
  if (gain >= 1) {
    return {
      tone: 'bad',
      text: `${who} threatens ${san}, winning about ${gain} ${gain === 1 ? 'pawn' : 'pawns'}' worth of material.`,
      squares,
    };
  }
  return {
    tone: 'neutral',
    text: `No immediate threat. ${who}'s most useful idea would be ${san}.`,
    squares,
  };
}

export const pieceValue = (r: keyof typeof PIECE_VALUE) => PIECE_VALUE[r];
