import { engine } from '../engine/stockfish';
import { fenOf, readFen } from '../lib/chess';
import { completeFen, exportPgn, importPgn, looksLikeFen } from '../lib/pgn';
import { GameTree } from '../lib/tree';
import { useAnalysis } from '../state/analysis';
import { useUi } from '../state/ui';

const SAVE_KEY = 'chess-advisor:game';

interface Saved {
  pgn: string;
  path: string[];
  orientation: 'white' | 'black';
}

/**
 * Loads a PGN, FEN or bare move list into the analysis board.
 * Returns an error message, or undefined on success.
 */
export function loadText(text: string, opts: { at?: 'start' | 'end' } = {}): string | undefined {
  const input = text.trim();
  if (!input) return 'Paste a PGN or a FEN first.';
  if (looksLikeFen(input)) {
    const r = readFen(completeFen(input));
    if (!r.ok) return r.error;
    useAnalysis.getState().reset(fenOf(r.pos));
    engine.newGame();
    return undefined;
  }
  const { games, errors } = importPgn(input);
  const game = games[0];
  if (!game) return errors[0] ?? 'This does not look like a PGN or a FEN.';
  useAnalysis.getState().load(game, { at: opts.at ?? 'end' });
  engine.newGame();
  if (errors.length) useUi.getState().toast(errors[0]!, 'error');
  if (games.length > 1) useUi.getState().toast(`Loaded the first of ${games.length} games.`);
  return undefined;
}

function save(): void {
  const a = useAnalysis.getState();
  try {
    const data: Saved = {
      pgn: exportPgn(a.tree, { variations: true, comments: true, clocks: true }),
      path: a.tree.ucisTo(a.currentId),
      orientation: a.orientation,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage may be full or disabled (private mode); autosave is best-effort.
  }
}

function restoreSaved(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as Saved;
    const game = importPgn(saved.pgn).games[0];
    if (!game) return false;
    const a = useAnalysis.getState();
    a.load(game, { orientation: saved.orientation, at: 'start' });
    let id = game.root.id;
    for (const uci of saved.path) {
      const next = game.get(id)?.children.find((c) => c.uci === uci);
      if (!next) break;
      id = next.id;
    }
    a.goto(id);
    return true;
  } catch {
    return false;
  }
}

/** URL hash first (shared links), then the autosaved session. */
export function restoreSession(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  const pgn = params.get('pgn');
  const fen = params.get('fen');
  if (pgn || fen) {
    const error = loadText(pgn ?? fen ?? '');
    if (params.get('flip') === '1') useAnalysis.getState().setOrientation('black');
    history.replaceState(null, '', location.pathname + location.search);
    if (!error) return save();
    useUi.getState().toast(`The shared link could not be opened: ${error}`, 'error');
  }
  restoreSaved();
}

let timer: number | undefined;

export function startAutosave(): () => void {
  return useAnalysis.subscribe((s, p) => {
    if (
      s.rev === p.rev &&
      s.currentId === p.currentId &&
      s.orientation === p.orientation &&
      s.tree === p.tree
    )
      return;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 500);
  });
}

export function clearSaved(): void {
  localStorage.removeItem(SAVE_KEY);
}

function baseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export function positionLink(fen: string, flip: boolean): string {
  return `${baseUrl()}#fen=${encodeURIComponent(fen)}${flip ? '&flip=1' : ''}`;
}

export function gameLink(tree: GameTree, flip: boolean): string {
  const pgn = exportPgn(tree, { variations: false, comments: false, clocks: false })
    .split('\n')
    .filter((l) => !l.startsWith('[') || l.startsWith('[FEN') || l.startsWith('[SetUp'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${baseUrl()}#pgn=${encodeURIComponent(pgn)}${flip ? '&flip=1' : ''}`;
}

export function downloadFile(name: string, text: string, type = 'application/x-chess-pgn'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    useUi.getState().toast(`${what} copied to the clipboard.`, 'success');
  } catch {
    useUi
      .getState()
      .toast(`Could not copy the ${what.toLowerCase()}. Select it and copy manually.`, 'error');
  }
}
