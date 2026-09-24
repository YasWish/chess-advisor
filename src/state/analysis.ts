import { create } from 'zustand';
import type { Color, PlayedMove } from '../lib/chess';
import type { PositionEval, Score } from '../lib/eval';
import { GameTree, type MoveClass } from '../lib/tree';

export interface ReviewSummary {
  depth: number;
  /** Mainline node ids, starting with the root. */
  nodeIds: string[];
  /** White's winning chances for each of those positions. */
  whiteWin: number[];
  scores: Score[];
  accuracy: { white?: number; black?: number };
  acpl: { white?: number; black?: number };
  counts: Record<Color, Partial<Record<MoveClass, number>>>;
}

export interface ReviewProgress {
  done: number;
  total: number;
  phase: 'analysing' | 'verifying';
}

export interface PracticeState {
  color: Color;
  /** Mainline node ids of the mistakes to revisit. */
  items: string[];
  index: number;
  status: 'solving' | 'checking' | 'correct' | 'wrong' | 'revealed' | 'finished';
  message?: string;
  solved: number;
  engineWasOn: boolean;
}

interface AnalysisStore {
  tree: GameTree;
  /** Bumped whenever the tree is mutated, so views re-render. */
  rev: number;
  currentId: string;
  /** Deepest node of the line being viewed; "next" follows it back down. */
  tipId: string;
  orientation: Color;
  /** Engine evaluations keyed by EPD, so transpositions share results. */
  evals: Map<string, PositionEval>;
  evalRev: number;
  engineOn: boolean;
  threatOn: boolean;
  review?: ReviewSummary;
  reviewProgress?: ReviewProgress;
  practice?: PracticeState;

  load(tree: GameTree, opts?: { orientation?: Color; at?: 'start' | 'end' }): void;
  reset(fen?: string): void;
  play(uci: string): PlayedMove | undefined;
  goto(id: string): void;
  next(): void;
  prev(): void;
  first(): void;
  last(): void;
  flip(): void;
  setOrientation(c: Color): void;
  remove(id: string): void;
  promote(id: string): void;
  touch(): void;
  setEval(epd: string, ev: PositionEval): void;
  setEngine(on: boolean): void;
  setThreat(on: boolean): void;
  setReview(review: ReviewSummary | undefined): void;
  setReviewProgress(p: ReviewProgress | undefined): void;
  setPractice(p: PracticeState | undefined): void;
}

export const useAnalysis = create<AnalysisStore>()((set, get) => {
  const initial = new GameTree();
  return {
    tree: initial,
    rev: 0,
    currentId: initial.root.id,
    tipId: initial.root.id,
    orientation: 'white',
    evals: new Map(),
    evalRev: 0,
    engineOn: true,
    threatOn: false,

    load: (tree, opts = {}) => {
      const end = tree.lineEnd(tree.root.id);
      const at = opts.at === 'end' ? end.id : tree.root.id;
      set({
        tree,
        rev: get().rev + 1,
        currentId: at,
        tipId: end.id,
        orientation: opts.orientation ?? get().orientation,
        review: undefined,
        reviewProgress: undefined,
        practice: undefined,
        threatOn: false,
      });
    },

    reset: (fen) => get().load(new GameTree(fen), { at: 'start' }),

    play: (uci) => {
      const { tree, currentId, tipId } = get();
      const added = tree.addMove(currentId, uci);
      if (!added) return undefined;
      const id = added.node.id;
      set({
        rev: get().rev + (added.isNew ? 1 : 0),
        currentId: id,
        tipId: tree.isAncestor(id, tipId) ? tipId : tree.lineEnd(id).id,
      });
      return added.played;
    },

    goto: (id) => {
      const { tree, tipId } = get();
      if (!tree.get(id)) return;
      set({ currentId: id, tipId: tree.isAncestor(id, tipId) ? tipId : tree.lineEnd(id).id });
    },

    next: () => {
      const { tree, currentId, tipId } = get();
      const path = tree.path(tipId);
      const idx = path.findIndex((n) => n.id === currentId);
      const child =
        idx >= 0 && idx < path.length - 1 ? path[idx + 1] : tree.get(currentId)?.children[0];
      if (child) get().goto(child.id);
    },

    prev: () => {
      const parent = get().tree.parent(get().currentId);
      if (parent) set({ currentId: parent.id });
    },

    first: () => set({ currentId: get().tree.root.id }),
    last: () => set({ currentId: get().tree.lineEnd(get().tipId).id }),
    flip: () => set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),
    setOrientation: (orientation) => set({ orientation }),

    remove: (id) => {
      const { tree, currentId } = get();
      const parentId = tree.remove(id);
      if (parentId === undefined) return;
      const current = tree.get(currentId) ? currentId : parentId;
      set({
        rev: get().rev + 1,
        currentId: current,
        tipId: tree.lineEnd(current).id,
        review: undefined,
      });
    },

    promote: (id) => {
      get().tree.promote(id);
      set({ rev: get().rev + 1, review: undefined });
    },

    touch: () => set({ rev: get().rev + 1 }),

    setEval: (epd, ev) => {
      get().evals.set(epd, ev);
      set({ evalRev: get().evalRev + 1 });
    },

    setEngine: (engineOn) => set({ engineOn, threatOn: engineOn ? get().threatOn : false }),
    setThreat: (threatOn) => set({ threatOn, engineOn: threatOn ? true : get().engineOn }),
    setReview: (review) => set({ review }),
    setReviewProgress: (reviewProgress) => set({ reviewProgress }),
    setPractice: (practice) => set({ practice }),
  };
});

export const currentNode = () => {
  const s = useAnalysis.getState();
  return s.tree.get(s.currentId) ?? s.tree.root;
};
