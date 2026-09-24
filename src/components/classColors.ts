import type { MoveClass } from '../lib/tree';

/** Colours for move grades, shared by the board glyphs, move list, graph and review table. */
export const CLASS_COLOR: Record<MoveClass, string> = {
  brilliant: '#26a69a',
  great: '#4a86c5',
  best: '#6a9a45',
  excellent: '#7fa35a',
  good: '#8e9c7a',
  book: '#a88b5c',
  forced: '#8a8078',
  inaccuracy: '#d9a520',
  mistake: '#e07b28',
  miss: '#c65a4a',
  blunder: '#c8392b',
};
