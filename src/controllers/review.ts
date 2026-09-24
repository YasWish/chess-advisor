import { sound } from '../audio/sound';
import { fetchCloudEval } from '../engine/cloud';
import { engine, engineLock } from '../engine/stockfish';
import {
  colorName,
  countLegalMoves,
  epdOf,
  positionFromFen,
  sanLine,
  type Color,
} from '../lib/chess';
import {
  MATE_CP,
  fromSideToMove,
  winPercent,
  winPercentFor,
  type PositionEval,
  type Score,
} from '../lib/eval';
import { isBookPosition, loadOpenings } from '../lib/openings';
import { LOSS, averageCpLoss, classifyPly, gameAccuracy, isSacrifice } from '../lib/review';
import { moverOf, type GameTree, type MoveClass, type TreeNode } from '../lib/tree';
import { useAnalysis, type ReviewSummary } from '../state/analysis';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { ANALYSIS_OPTIONS } from './liveAnalysis';

let cancelled = false;

async function localEval(
  tree: GameTree,
  node: TreeNode,
  multiPv: number,
  depth: number,
): Promise<PositionEval | undefined> {
  const turn = positionFromFen(node.fen).turn;
  const res = await engine.search({
    fen: tree.root.fen,
    moves: tree.ucisTo(node.id),
    multiPv,
    limits: { depth, movetime: 8000 },
    options: ANALYSIS_OPTIONS(),
  });
  if (!res.lines.length) return undefined;
  return {
    epd: epdOf(node.fen),
    depth: res.lines[0]!.depth,
    lines: res.lines.map((l) => ({
      multipv: l.multipv,
      score: fromSideToMove(l.score, turn),
      moves: l.pv,
    })),
    source: 'local',
    done: !res.interrupted,
  };
}

interface PositionFacts {
  score: Score;
  best?: string;
  second?: Score;
}

export function cancelReview(): void {
  cancelled = true;
  engine.stop();
}

/** Analyses every mainline position, then grades each move and computes accuracy. */
export async function runReview(): Promise<void> {
  const ui = useUi.getState();
  const start = useAnalysis.getState();
  if (start.reviewProgress) return;
  const tree = start.tree;
  const main = tree.mainline();
  if (main.length < 2) {
    ui.toast('There are no moves to review yet. Play or import a game first.');
    return;
  }
  const depth = useSettings.getState().reviewDepth;
  cancelled = false;
  ui.setTab('review');
  engineLock.acquire('review');
  start.setReviewProgress({ done: 0, total: main.length, phase: 'analysing' });
  const facts: PositionFacts[] = [];
  let tryCloud = useSettings.getState().cloudEval;

  try {
    await loadOpenings();
    for (const [i, node] of main.entries()) {
      if (cancelled) return;
      const pos = positionFromFen(node.fen);
      if (pos.isCheckmate())
        facts.push({ score: { cp: pos.turn === 'white' ? -MATE_CP : MATE_CP } });
      else if (pos.isStalemate() || pos.isInsufficientMaterial()) facts.push({ score: { cp: 0 } });
      else {
        const epd = epdOf(node.fen);
        const multiPv = Math.min(2, countLegalMoves(pos));
        const enough = (ev?: PositionEval) =>
          !!ev && ev.depth >= depth && ev.lines.length >= multiPv;
        let ev = useAnalysis.getState().evals.get(epd);
        if (!enough(ev)) {
          let fresh: PositionEval | undefined;
          if (tryCloud) {
            fresh = await fetchCloudEval(node.fen, multiPv);
            // The cloud mostly knows openings; once it misses, stop asking for this game.
            if (!enough(fresh)) tryCloud = false;
          }
          if (!enough(fresh)) fresh = await localEval(tree, node, multiPv, depth);
          if (cancelled) return;
          if (fresh && (!ev || fresh.depth >= ev.depth)) {
            useAnalysis.getState().setEval(epd, fresh);
            ev = fresh;
          }
        }
        const first = ev?.lines.find((l) => l.multipv === 1);
        const second = ev?.lines.find((l) => l.multipv === 2);
        facts.push({
          score: first?.score ?? { cp: 0 },
          best: first?.moves[0],
          second: second?.score,
        });
      }
      useAnalysis
        .getState()
        .setReviewProgress({ done: i + 1, total: main.length, phase: 'analysing' });
    }

    const firstMover = moverOf(main[1]!);
    const legalBefore = main.map((n) => countLegalMoves(positionFromFen(n.fen)));
    const recapture = (i: number) =>
      !!main[i - 1]!.san?.includes('x') &&
      main[i - 1]!.uci?.slice(2, 4) === main[i]!.uci?.slice(2, 4);

    // Phase 2. Two independent searches (before and after a move) can disagree by pawns at
    // review depth, which makes good moves look like blunders. Every move that looks like a
    // mistake is re-checked with a deeper search limited to the played move and the engine's
    // choice, so the two are compared side by side, within one search.
    const suspects: number[] = [];
    for (let i = 1; i < main.length; i++) {
      const before = facts[i - 1]!;
      if (!before.best || before.best === main[i]!.uci || legalBefore[i - 1]! < 2) continue;
      const color = moverOf(main[i]!);
      const loss = winPercentFor(before.score, color) - winPercentFor(facts[i]!.score, color);
      if (loss >= LOSS.inaccuracy) suspects.push(i);
    }
    const verified = new Map<number, { before: Score; after: Score; best: string }>();
    for (const [k, i] of suspects.entries()) {
      if (cancelled) return;
      useAnalysis
        .getState()
        .setReviewProgress({ done: k, total: suspects.length, phase: 'verifying' });
      const node = main[i]!;
      const parent = main[i - 1]!;
      const turn = positionFromFen(parent.fen).turn;
      const candidates = [facts[i - 1]!.best!, node.uci!];
      const res = await engine.search({
        fen: tree.root.fen,
        moves: tree.ucisTo(parent.id),
        multiPv: 2,
        limits: { depth: depth + 4, movetime: 12_000, searchmoves: candidates },
        options: ANALYSIS_OPTIONS(),
      });
      const top = res.lines[0];
      const played = res.lines.find((l) => l.pv[0] === node.uci);
      if (!res.interrupted && top && played) {
        verified.set(i, {
          before: fromSideToMove(top.score, turn),
          after: fromSideToMove(played.score, turn),
          best: top.pv[0]!,
        });
      }
    }
    if (cancelled) return;

    tree.clearReview();
    const counts: ReviewSummary['counts'] = { white: {}, black: {} };
    let inBook = true;
    for (let i = 1; i < main.length; i++) {
      const node = main[i]!;
      const parent = main[i - 1]!;
      const before = facts[i - 1]!;
      const check = verified.get(i);
      const color = moverOf(node);
      inBook = inBook && isBookPosition(node.fen);
      const verdict = classifyPly({
        color,
        before: check?.before ?? before.score,
        after: facts[i]!.score,
        playedScore: check?.after,
        played: node.uci!,
        best: check?.best ?? before.best,
        secondBest: before.second,
        isRecapture: recapture(i),
        legalMoves: legalBefore[i - 1]!,
        isBook: inBook,
        isSacrifice: isSacrifice(parent.fen, node.uci!),
        previousOpponentClass: parent.review?.cls,
      });
      const bestUci = check?.best ?? before.best;
      node.review = {
        cls: verdict.cls,
        loss: verdict.loss,
        accuracy: verdict.accuracy,
        evalAfter: facts[i]!.score,
        bestUci,
        bestSan: bestUci ? sanLine(parent.fen, [bestUci], 1)[0] : undefined,
      };
      counts[color][verdict.cls] = (counts[color][verdict.cls] ?? 0) + 1;
    }
    const scores = facts.map((f) => f.score);
    const whiteWin = scores.map(winPercent);
    // Accuracy and ACPL use the verified comparison where there is one, so they agree with the grades.
    const pairs = main.slice(1).map((_, i) => verified.get(i + 1));
    useAnalysis.getState().setReview({
      depth,
      nodeIds: main.map((n) => n.id),
      whiteWin,
      scores,
      accuracy: gameAccuracy(
        whiteWin,
        firstMover,
        pairs.map((v) => v && { before: winPercent(v.before), after: winPercent(v.after) }),
      ),
      acpl: averageCpLoss(scores, firstMover, pairs),
      counts,
    });
    useAnalysis.getState().touch();
    sound.success();
    ui.toast('Review complete. Moves are graded in the move list.', 'success');
  } finally {
    useAnalysis.getState().setReviewProgress(undefined);
    engineLock.release('review');
  }
}

const PRACTICE_CLASSES: MoveClass[] = ['mistake', 'blunder', 'miss'];

export function mistakesOf(color: Color): TreeNode[] {
  return useAnalysis
    .getState()
    .tree.mainline()
    .filter((n) => n.review && moverOf(n) === color && PRACTICE_CLASSES.includes(n.review.cls));
}

function showItem(index: number): void {
  const a = useAnalysis.getState();
  const p = a.practice;
  if (!p) return;
  const item = a.tree.get(p.items[index]!);
  const parent = item && a.tree.parent(item.id);
  if (!item || !parent) return;
  a.goto(parent.id);
  a.setPractice({
    ...p,
    index,
    status: 'solving',
    message: `${colorName(p.color)} played ${item.san} here. Find a better move.`,
  });
}

export function startPractice(color: Color): void {
  const a = useAnalysis.getState();
  const items = mistakesOf(color).map((n) => n.id);
  if (!items.length) {
    useUi.getState().toast(`${colorName(color)} made no mistakes to practise. Nice.`, 'success');
    return;
  }
  a.setPractice({ color, items, index: 0, status: 'solving', solved: 0, engineWasOn: a.engineOn });
  a.setOrientation(color);
  showItem(0);
}

export function stopPractice(): void {
  const a = useAnalysis.getState();
  const p = a.practice;
  a.setPractice(undefined);
  if (p) a.setEngine(p.engineWasOn);
}

export function practiceNext(): void {
  const p = useAnalysis.getState().practice;
  if (!p) return;
  if (p.index + 1 >= p.items.length) {
    useAnalysis.getState().setPractice({
      ...p,
      status: 'finished',
      message: `Done: you found ${p.solved} of ${p.items.length}.`,
    });
    return;
  }
  showItem(p.index + 1);
}

export function practiceReveal(): void {
  const a = useAnalysis.getState();
  const p = a.practice;
  const item = p && a.tree.get(p.items[p.index]!);
  const parent = item && a.tree.parent(item.id);
  if (!p || !item || !parent || !item.review?.bestUci) return;
  a.goto(parent.id);
  a.play(item.review.bestUci);
  a.setPractice({
    ...p,
    status: 'revealed',
    message: `The engine's move was ${item.review.bestSan}.`,
  });
}

/** Judges a move tried during practice: the best move, or anything nearly as good, counts. */
export async function practiceTry(uci: string): Promise<void> {
  const a = useAnalysis.getState();
  const p = a.practice;
  if (!p || (p.status !== 'solving' && p.status !== 'wrong')) return;
  const item = a.tree.get(p.items[p.index]!);
  const parent = item && a.tree.parent(item.id);
  if (!item?.review || !parent) return;
  if (a.currentId !== parent.id) a.goto(parent.id);
  const played = a.play(uci);
  if (!played) return;

  const retry = (message: string) => {
    sound.failure();
    useAnalysis.getState().setPractice({ ...p, status: 'wrong', message });
    window.setTimeout(() => {
      if (useAnalysis.getState().practice?.status === 'wrong')
        useAnalysis.getState().goto(parent.id);
    }, 900);
  };
  const solved = (message: string) => {
    sound.success();
    useAnalysis.getState().setPractice({ ...p, status: 'correct', solved: p.solved + 1, message });
  };

  if (played.uci === item.uci)
    return retry(`${played.san} is the move from the game. Try something else.`);
  if (played.uci === item.review.bestUci)
    return solved(`Correct: ${played.san} is the engine's choice.`);

  useAnalysis
    .getState()
    .setPractice({ ...p, status: 'checking', message: `Checking ${played.san}…` });
  engineLock.acquire('practice');
  try {
    const res = await engine.search({
      fen: a.tree.root.fen,
      moves: a.tree.ucisTo(parent.id),
      multiPv: 1,
      limits: { depth: 14, movetime: 4000, searchmoves: [played.uci] },
      options: ANALYSIS_OPTIONS(),
    });
    const line = res.lines[0];
    const bestScore = useAnalysis.getState().evals.get(epdOf(parent.fen))?.lines[0]?.score;
    if (!line || !bestScore) return retry(`Could not check ${played.san}. Try again.`);
    const mine = fromSideToMove(line.score, p.color);
    const loss = winPercentFor(bestScore, p.color) - winPercentFor(mine, p.color);
    if (loss < LOSS.good)
      solved(`${played.san} works too — nearly as strong as ${item.review.bestSan}.`);
    else retry(`${played.san} is not good enough. Try again.`);
  } finally {
    engineLock.release('practice');
  }
}
