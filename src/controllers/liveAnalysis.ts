import { fetchCloudEval } from '../engine/cloud';
import { engine, engineLock } from '../engine/stockfish';
import { countLegalMoves, epdOf, nullMoveFen, positionFromFen } from '../lib/chess';
import { fromSideToMove, uniqueLines, type PositionEval, type PvLine } from '../lib/eval';
import { useAnalysis } from '../state/analysis';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';

export const threatKey = (epd: string) => `threat:${epd}`;

/** Options that make sure a search runs at full strength (play mode may have weakened it). */
export const ANALYSIS_OPTIONS = () => ({
  Hash: useSettings.getState().hashMb,
  UCI_ShowWDL: true,
  UCI_LimitStrength: false,
  'Skill Level': 20,
});

let timer: number | undefined;
let generation = 0;
let activeKey: string | undefined;

function wanted(): boolean {
  const a = useAnalysis.getState();
  return (
    a.engineOn &&
    !a.practice &&
    useUi.getState().mode === 'analysis' &&
    engineLock.owner === 'analysis'
  );
}

function schedule(delay = 40): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), delay);
}

/** Starts watching the analysis board; returns an unsubscribe function. */
export function startLiveAnalysis(): () => void {
  const subs = [
    useAnalysis.subscribe((s, p) => {
      if (
        s.currentId !== p.currentId ||
        s.engineOn !== p.engineOn ||
        s.threatOn !== p.threatOn ||
        s.tree !== p.tree ||
        s.practice !== p.practice
      ) {
        schedule();
      }
    }),
    useSettings.subscribe((s, p) => {
      if (
        s.multiPv !== p.multiPv ||
        s.depth !== p.depth ||
        s.cloudEval !== p.cloudEval ||
        s.hashMb !== p.hashMb
      ) {
        activeKey = undefined;
        schedule();
      }
    }),
    useUi.subscribe((s, p) => {
      if (s.mode !== p.mode) schedule();
    }),
    engineLock.subscribe(() => {
      activeKey = undefined;
      schedule();
    }),
  ];
  schedule(0);
  return () => subs.forEach((u) => u());
}

async function run(): Promise<void> {
  const gen = ++generation;
  if (!wanted()) {
    if (engineLock.owner === 'analysis' && engine.busy) engine.stop();
    activeKey = undefined;
    return;
  }
  const a = useAnalysis.getState();
  const s = useSettings.getState();
  const node = a.tree.get(a.currentId) ?? a.tree.root;

  let rootFen = a.tree.root.fen;
  let moves = a.tree.ucisTo(node.id);
  let fen = node.fen;
  let key = epdOf(fen);
  if (a.threatOn) {
    const swapped = nullMoveFen(fen);
    if (!swapped) {
      engine.stop();
      activeKey = undefined;
      return;
    }
    rootFen = fen = swapped;
    moves = [];
    key = threatKey(epdOf(swapped));
  }

  const pos = positionFromFen(fen);
  if (pos.isEnd()) {
    engine.stop();
    activeKey = undefined;
    return;
  }
  const multiPv = Math.max(1, Math.min(s.multiPv, countLegalMoves(pos)));
  const requestKey = `${key}|${multiPv}|${s.depth}`;
  if (requestKey === activeKey && engine.busy) return;

  const satisfied = (ev?: PositionEval) =>
    !!ev &&
    ev.lines.length >= multiPv &&
    ev.depth >= (s.depth > 0 ? s.depth : 30) &&
    (ev.done || ev.source === 'cloud');

  let have = a.evals.get(key);
  if (satisfied(have)) {
    if (engine.busy) engine.stop();
    activeKey = undefined;
    return;
  }

  if (s.cloudEval && !a.threatOn) {
    if (engine.busy) engine.stop();
    activeKey = undefined;
    const cloud = await fetchCloudEval(fen, multiPv);
    if (gen !== generation || !wanted()) return;
    if (cloud && (!have || cloud.depth > have.depth)) {
      useAnalysis.getState().setEval(key, cloud);
      have = cloud;
    }
    if (satisfied(have)) return;
  }

  activeKey = requestKey;
  const turn = pos.turn;
  const lines = new Map<number, PvLine>();
  let depth = 0;
  let seldepth: number | undefined;
  let nodes: number | undefined;
  let nps: number | undefined;
  let wdl: [number, number, number] | undefined;
  let lastCommit = 0;
  let trailing: number | undefined;

  const commit = (done: boolean) => {
    if (!lines.size) return;
    const existing = useAnalysis.getState().evals.get(key);
    const fresh: PositionEval = {
      epd: key,
      depth,
      seldepth,
      lines: uniqueLines([...lines.values()]).slice(0, multiPv),
      wdl,
      nodes,
      nps,
      source: 'local',
      done,
    };
    // A deeper cloud evaluation stays on screen until the local engine catches up with it.
    const keepCloud =
      existing?.source === 'cloud' &&
      existing.depth > depth &&
      existing.lines.length >= Math.min(multiPv, fresh.lines.length);
    if (!keepCloud) useAnalysis.getState().setEval(key, fresh);
  };

  const result = await engine.search({
    fen: rootFen,
    moves,
    multiPv,
    limits: s.depth > 0 ? { depth: s.depth } : { infinite: true },
    options: ANALYSIS_OPTIONS(),
    onInfo: (info) => {
      lines.set(info.multipv, {
        multipv: info.multipv,
        score: fromSideToMove(info.score, turn),
        moves: info.pv,
      });
      if (info.multipv === 1) {
        depth = info.depth;
        seldepth = info.seldepth;
        if (info.wdl) wdl = turn === 'white' ? info.wdl : [info.wdl[2], info.wdl[1], info.wdl[0]];
      }
      nodes = info.nodes ?? nodes;
      nps = info.nps ?? nps;
      // Stockfish reports the MultiPV lines of a depth one message at a time. Publish only
      // complete sets, or line 1 of a new depth could sit next to line 2 of the old one.
      if (info.multipv !== multiPv) return;
      const wait = 120 - (performance.now() - lastCommit);
      if (wait <= 0) {
        lastCommit = performance.now();
        commit(false);
      } else if (trailing === undefined) {
        trailing = window.setTimeout(() => {
          trailing = undefined;
          lastCommit = performance.now();
          commit(false);
        }, wait);
      }
    },
  });
  window.clearTimeout(trailing);
  if (activeKey === requestKey) activeKey = undefined;
  commit(!result.interrupted && !result.error);
}

/** Plays the engine's top move in the current position (Space). */
export function bestMoveHere(): string | undefined {
  const a = useAnalysis.getState();
  const node = a.tree.get(a.currentId);
  if (!node) return undefined;
  const ev = a.evals.get(epdOf(node.fen));
  return ev?.lines.find((l) => l.multipv === 1)?.moves[0];
}
