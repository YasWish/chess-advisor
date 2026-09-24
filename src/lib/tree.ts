import { INITIAL_FEN, fenOf, playUci, positionFromFen, type Color, type PlayedMove } from './chess';
import type { Score } from './eval';

export type MoveClass =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export interface MoveReview {
  cls: MoveClass;
  /** Winning chances (0–100) the mover gave away with this move. */
  loss: number;
  accuracy: number;
  /** Evaluation after the move, White's point of view. */
  evalAfter: Score;
  bestUci?: string;
  bestSan?: string;
}

export interface TreeNode {
  id: string;
  /** Half-moves played since the start of the game (0 = standard starting position). */
  ply: number;
  fen: string;
  uci?: string;
  san?: string;
  children: TreeNode[];
  comments?: string[];
  nags?: number[];
  /** Clock after this move in seconds, when the PGN recorded one. */
  clock?: number;
  review?: MoveReview;
}

export const moverOf = (node: TreeNode): Color => ((node.ply - 1) % 2 === 0 ? 'white' : 'black');
export const moveNumberOf = (node: TreeNode): number => Math.floor((node.ply - 1) / 2) + 1;

function rootPly(fen: string): number {
  const [, turn, , , , full] = fen.split(/\s+/);
  const fullmoves = Math.max(1, Number(full) || 1);
  return (fullmoves - 1) * 2 + (turn === 'b' ? 1 : 0);
}

export class GameTree {
  readonly root: TreeNode;
  headers: Map<string, string>;
  private readonly nodes = new Map<string, TreeNode>();
  private readonly parents = new Map<string, string>();
  private seq = 0;

  constructor(fen: string = INITIAL_FEN, headers: Map<string, string> = new Map()) {
    const pos = positionFromFen(fen);
    this.root = { id: this.nextId(), ply: rootPly(fenOf(pos)), fen: fenOf(pos), children: [] };
    this.nodes.set(this.root.id, this.root);
    this.headers = headers;
  }

  private nextId(): string {
    return (this.seq++).toString(36);
  }

  get size(): number {
    return this.nodes.size;
  }

  get(id: string): TreeNode | undefined {
    return this.nodes.get(id);
  }

  parent(id: string): TreeNode | undefined {
    const pid = this.parents.get(id);
    return pid === undefined ? undefined : this.nodes.get(pid);
  }

  /** Nodes from the root to `id`, inclusive. */
  path(id: string): TreeNode[] {
    const out: TreeNode[] = [];
    let node = this.nodes.get(id);
    while (node) {
      out.push(node);
      node = this.parent(node.id);
    }
    return out.reverse();
  }

  isAncestor(ancestorId: string, id: string): boolean {
    let cur: string | undefined = id;
    while (cur !== undefined) {
      if (cur === ancestorId) return true;
      cur = this.parents.get(cur);
    }
    return false;
  }

  mainline(): TreeNode[] {
    const out = [this.root];
    let node = this.root.children[0];
    while (node) {
      out.push(node);
      node = node.children[0];
    }
    return out;
  }

  isMainline(id: string): boolean {
    let node = this.nodes.get(id);
    while (node) {
      const parent = this.parent(node.id);
      if (!parent) return true;
      if (parent.children[0] !== node) return false;
      node = parent;
    }
    return false;
  }

  /** The last node reached by always following the first child. */
  lineEnd(id: string): TreeNode {
    let node = this.nodes.get(id) ?? this.root;
    while (node.children[0]) node = node.children[0];
    return node;
  }

  ucisTo(id: string): string[] {
    return this.path(id)
      .slice(1)
      .map((n) => n.uci!);
  }

  /**
   * Plays `uci` after `parentId`. Existing continuations are reused rather than duplicated,
   * so replaying a known move simply navigates to it. Returns undefined for illegal moves.
   */
  addMove(
    parentId: string,
    uci: string,
  ): { node: TreeNode; played: PlayedMove; isNew: boolean } | undefined {
    const parent = this.nodes.get(parentId);
    if (!parent) return undefined;
    const pos = positionFromFen(parent.fen);
    const played = playUci(pos, uci);
    if (!played) return undefined;
    const existing = parent.children.find((c) => c.uci === played.uci);
    if (existing) return { node: existing, played, isNew: false };
    const node: TreeNode = {
      id: this.nextId(),
      ply: parent.ply + 1,
      fen: fenOf(pos),
      uci: played.uci,
      san: played.san,
      children: [],
    };
    parent.children.push(node);
    this.nodes.set(node.id, node);
    this.parents.set(node.id, parent.id);
    return { node, played, isNew: true };
  }

  /** Deletes a node and everything after it. Returns the parent id. */
  remove(id: string): string | undefined {
    const parent = this.parent(id);
    const node = this.nodes.get(id);
    if (!parent || !node) return undefined;
    parent.children = parent.children.filter((c) => c !== node);
    const stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      this.nodes.delete(n.id);
      this.parents.delete(n.id);
      stack.push(...n.children);
    }
    return parent.id;
  }

  /** Makes the line through `id` the main line. */
  promote(id: string): void {
    let node = this.nodes.get(id);
    while (node) {
      const parent = this.parent(node.id);
      if (!parent) return;
      const idx = parent.children.indexOf(node);
      if (idx > 0) {
        parent.children.splice(idx, 1);
        parent.children.unshift(node);
      }
      node = parent;
    }
  }

  /** Removes review annotations, e.g. before re-running a review. */
  clearReview(): void {
    for (const node of this.nodes.values()) delete node.review;
  }
}
