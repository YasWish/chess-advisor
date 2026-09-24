import type { Chess } from 'chessops/chess';
import {
  parseComment,
  parsePgn,
  startingPosition,
  type Node as PgnNode,
  type PgnNodeData,
} from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { INITIAL_FEN, fenOf, standardUci } from './chess';
import type { Score } from './eval';
import { GameTree, moveNumberOf, moverOf, type MoveClass, type TreeNode } from './tree';

export interface ImportResult {
  games: GameTree[];
  errors: string[];
}

/** Parses one or more PGN games, keeping variations, comments, NAGs and clock times. */
export function importPgn(text: string): ImportResult {
  const games: GameTree[] = [];
  const errors: string[] = [];
  for (const [index, game] of parsePgn(text).entries()) {
    const label = `Game ${index + 1}`;
    const variant = game.headers.get('Variant');
    if (variant && !/^(standard|chess|from position)$/i.test(variant)) {
      errors.push(`${label}: the ${variant} variant is not supported.`);
      continue;
    }
    const start = startingPosition(game.headers);
    if (start.isErr) {
      errors.push(`${label}: the starting position (FEN header) is invalid.`);
      continue;
    }
    const pos = start.value as Chess;
    const tree = new GameTree(fenOf(pos), game.headers);
    const rootComments = (game.comments ?? [])
      .map((c) => parseComment(c).text.trim())
      .filter(Boolean);
    if (rootComments.length) tree.root.comments = rootComments;
    const bad = walk(tree, tree.root.id, game.moves, pos);
    if (bad) errors.push(`${label}: stopped at an illegal move (${bad}).`);
    if (tree.size > 1 || game.headers.size > 0) games.push(tree);
  }
  if (!games.length && !errors.length) errors.push('No moves were found in this PGN.');
  return { games, errors };
}

function walk(
  tree: GameTree,
  parentId: string,
  node: PgnNode<PgnNodeData>,
  pos: Chess,
): string | undefined {
  let firstError: string | undefined;
  for (const child of node.children) {
    const move = parseSan(pos, child.data.san);
    if (!move || !('from' in move)) {
      firstError ??= child.data.san;
      continue;
    }
    const added = tree.addMove(parentId, standardUci(pos, move));
    if (!added) {
      firstError ??= child.data.san;
      continue;
    }
    const target = added.node;
    const texts: string[] = [];
    for (const raw of [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])]) {
      const c = parseComment(raw);
      if (c.text.trim()) texts.push(c.text.trim());
      if (c.clock !== undefined) target.clock = c.clock;
    }
    if (texts.length) target.comments = texts;
    if (child.data.nags?.length) target.nags = [...child.data.nags];
    const next = pos.clone();
    next.play(move);
    const err = walk(tree, target.id, child, next);
    firstError ??= err;
  }
  return firstError;
}

export const looksLikeFen = (text: string): boolean =>
  /^\s*([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+(\s+[wb](\s+(-|[KQkq]+))?(\s+(-|[a-h][36]))?(\s+\d+){0,2})?\s*$/.test(
    text,
  );

/** Completes a FEN that only has the board (and maybe turn) with sensible defaults. */
export function completeFen(text: string): string {
  const parts = text.trim().split(/\s+/);
  const defaults = ['', 'w', '-', '-', '0', '1'];
  return defaults.map((d, i) => parts[i] ?? d).join(' ');
}

export interface ExportOptions {
  variations?: boolean;
  comments?: boolean;
  /** Adds [%eval] comments and move-quality NAGs from a game review. */
  annotations?: boolean;
  clocks?: boolean;
}

const CLASS_NAG: Partial<Record<MoveClass, number>> = {
  brilliant: 3,
  great: 1,
  inaccuracy: 6,
  mistake: 2,
  miss: 2,
  blunder: 4,
};

const ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

function formatEval(score: Score): string {
  if (score.mate !== undefined) return `#${score.mate}`;
  return (score.cp / 100).toFixed(2);
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function exportPgn(tree: GameTree, opts: ExportOptions = {}): string {
  const { variations = true, comments = true, annotations = false, clocks = true } = opts;
  const headers = new Map(tree.headers);
  headers.delete('FEN');
  headers.delete('SetUp');
  const defaults: Record<string, string> = {
    Event: 'Chess Advisor analysis',
    Site: 'https://yaswish.github.io/chess-advisor/',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: '-',
    White: '?',
    Black: '?',
    Result: '*',
  };
  const lines: string[] = [];
  for (const key of ROSTER)
    lines.push(`[${key} "${escapeTag(headers.get(key) ?? defaults[key]!)}"]`);
  for (const [key, value] of headers)
    if (!ROSTER.includes(key)) lines.push(`[${key} "${escapeTag(value)}"]`);
  if (tree.root.fen !== INITIAL_FEN) {
    lines.push('[SetUp "1"]', `[FEN "${tree.root.fen}"]`);
  }

  const commentOf = (node: TreeNode): string | undefined => {
    const parts: string[] = [];
    if (comments && node.comments) parts.push(...node.comments.map((c) => c.replace(/[{}]/g, '')));
    if (annotations && node.review && !node.san?.endsWith('#'))
      parts.push(`[%eval ${formatEval(node.review.evalAfter)}]`);
    if (clocks && node.clock !== undefined) parts.push(`[%clk ${formatClock(node.clock)}]`);
    return parts.length ? `{ ${parts.join(' ')} }` : undefined;
  };

  const moveToken = (node: TreeNode, forceNumber: boolean): string => {
    const n = moveNumberOf(node);
    const prefix = moverOf(node) === 'white' ? `${n}. ` : forceNumber ? `${n}... ` : '';
    const nags = new Set(node.nags ?? []);
    const reviewNag = annotations && node.review ? CLASS_NAG[node.review.cls] : undefined;
    if (reviewNag) nags.add(reviewNag);
    return prefix + node.san + [...nags].map((g) => ` $${g}`).join('');
  };

  const line = (start: TreeNode, force: boolean): string[] => {
    const tokens: string[] = [];
    let node = start;
    let forceNumber = force;
    while (node.children.length) {
      const [main, ...alts] = node.children as [TreeNode, ...TreeNode[]];
      tokens.push(moveToken(main, forceNumber));
      forceNumber = false;
      const c = commentOf(main);
      if (c) {
        tokens.push(c);
        forceNumber = true;
      }
      if (variations) {
        for (const alt of alts) {
          const inner = [moveToken(alt, true)];
          const ac = commentOf(alt);
          if (ac) inner.push(ac);
          inner.push(...line(alt, !!ac));
          tokens.push(`(${inner.join(' ')})`);
          forceNumber = true;
        }
      }
      node = main;
    }
    return tokens;
  };

  const intro =
    comments && tree.root.comments?.length ? [`{ ${tree.root.comments.join(' ')} }`] : [];
  const movetext = [...intro, ...line(tree.root, true), headers.get('Result') ?? '*'].join(' ');
  return `${lines.join('\n')}\n\n${wrap(movetext, 80)}\n`;
}

function escapeTag(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function wrap(text: string, width: number): string {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current && current.length + word.length + 1 > width) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out.join('\n');
}

/** A compact mainline for share links: "e4 e5 Nf3 Nc6". */
export const mainlineSan = (tree: GameTree): string =>
  tree
    .mainline()
    .slice(1)
    .map((n) => n.san)
    .join(' ');
