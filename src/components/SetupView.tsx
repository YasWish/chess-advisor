import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import { Eraser, FlipVertical2, MousePointer2, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlay } from '../controllers/play';
import { INITIAL_FEN, fenOf, readFen, type Color } from '../lib/chess';
import { useAnalysis } from '../state/analysis';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { Button, Segmented } from './ui';

type Brush = { color: Color; role: Role } | 'trash' | undefined;

const ROLES: Role[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const EMPTY = '8/8/8/8/8/8/8/8';

const RIGHTS = [
  { char: 'K', label: 'White O-O', king: 'e1', rook: 'h1', color: 'white' },
  { char: 'Q', label: 'White O-O-O', king: 'e1', rook: 'a1', color: 'white' },
  { char: 'k', label: 'Black O-O', king: 'e8', rook: 'h8', color: 'black' },
  { char: 'q', label: 'Black O-O-O', king: 'e8', rook: 'a8', color: 'black' },
] as const;

function pieceAt(board: string, square: string): string | undefined {
  const rows = board.split('/');
  const row = rows[8 - Number(square[1])];
  if (!row) return undefined;
  let file = 0;
  const target = square.charCodeAt(0) - 97;
  for (const ch of row) {
    if (/\d/.test(ch)) file += Number(ch);
    else {
      if (file === target) return ch;
      file++;
    }
  }
  return undefined;
}

const available = (board: string, r: (typeof RIGHTS)[number]) => {
  const king = r.color === 'white' ? 'K' : 'k';
  const rook = r.color === 'white' ? 'R' : 'r';
  return pieceAt(board, r.king) === king && pieceAt(board, r.rook) === rook;
};

export function SetupView() {
  const start = (() => {
    const a = useAnalysis.getState();
    return (a.tree.get(a.currentId) ?? a.tree.root).fen;
  })();
  const [board, setBoard] = useState(start.split(' ')[0]!);
  const [turn, setTurn] = useState<'w' | 'b'>(start.split(' ')[1] === 'b' ? 'b' : 'w');
  const [castling, setCastling] = useState(start.split(' ')[2] ?? 'KQkq');
  const [orientation, setOrientation] = useState<Color>(useAnalysis.getState().orientation);
  const [brush, setBrush] = useState<Brush>();
  const [fenText, setFenText] = useState<string>();
  const coordinates = useSettings((s) => s.coordinates);
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | undefined>(undefined);
  const brushRef = useRef<Brush>(undefined);
  useLayoutEffect(() => {
    brushRef.current = brush;
  });

  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, {
      fen: board,
      orientation,
      coordinates,
      movable: { free: true, color: 'both' },
      premovable: { enabled: false },
      draggable: { deleteOnDropOff: true },
      highlight: { lastMove: false, check: false },
      animation: { enabled: false },
      events: {
        change: () => setBoard(cg.getFen()),
        select: (key: Key) => {
          const b = brushRef.current;
          if (!b) return;
          cg.setPieces(
            new Map([[key, b === 'trash' ? undefined : { color: b.color, role: b.role }]]),
          );
          cg.selectSquare(null);
          setBoard(cg.getFen());
        },
      },
    });
    api.current = cg;
    return () => cg.destroy();
    // The editor board is created once; later changes are pushed with api.set().
  }, [coordinates]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (api.current && api.current.getFen() !== board) api.current.set({ fen: board });
  }, [board]);
  useEffect(() => api.current?.set({ orientation }), [orientation]);

  const rights = RIGHTS.filter((r) => castling.includes(r.char) && available(board, r))
    .map((r) => r.char)
    .join('');
  const fen = `${board} ${turn} ${rights || '-'} - 0 1`;
  const check = readFen(fen);

  const applyFen = (text: string) => {
    setFenText(text);
    const r = readFen(text.trim());
    if (!r.ok) return;
    const full = fenOf(r.pos).split(' ');
    setBoard(full[0]!);
    setTurn(full[1] === 'b' ? 'b' : 'w');
    setCastling(full[2] === '-' ? '' : full[2]!);
  };

  const toggleRight = (char: string) =>
    setCastling((c) => (c.includes(char) ? c.replace(char, '') : c + char));

  const analyse = () => {
    if (!check.ok) return;
    useAnalysis.getState().reset(fenOf(check.pos));
    useAnalysis.getState().setOrientation(orientation);
    useUi.getState().setMode('analysis');
  };
  const play = () => {
    if (!check.ok) return;
    useAnalysis.getState().reset(fenOf(check.pos));
    usePlay.getState().configure({ fromCurrent: true, color: turn === 'w' ? 'white' : 'black' });
    useUi.getState().setMode('play');
  };

  const palette = (color: Color) => (
    <div className="palette-row" aria-label={`${color} pieces`}>
      {ROLES.map((role) => {
        const on = brush !== 'trash' && brush?.color === color && brush.role === role;
        return (
          <button
            key={role}
            type="button"
            className={`palette-piece ${on ? 'on' : ''}`}
            aria-label={`${on ? 'Stop placing' : 'Place'} ${color} ${role}s`}
            aria-pressed={on}
            onPointerDown={(e) => {
              if (e.button === 0 && e.pointerType === 'mouse')
                api.current?.dragNewPiece({ color, role }, e.nativeEvent, true);
            }}
            onClick={() => setBrush(on ? undefined : { color, role })}
          >
            <i className={`pc ${color} ${role}`} />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="workspace">
      <section className="stage" aria-label="Board editor">
        <div className="palette">{palette(orientation === 'white' ? 'black' : 'white')}</div>
        <div className="board-row">
          <div className={`board-frame editor ${brush ? 'brushing' : ''}`}>
            <div ref={el} className="cg-host" role="application" aria-label="Editable board" />
          </div>
        </div>
        <div className="palette">
          {palette(orientation)}
          <div className="palette-tools">
            <Button
              tone={brush === undefined ? 'default' : 'quiet'}
              icon={<MousePointer2 size={16} />}
              label="Move pieces"
              aria-pressed={brush === undefined}
              onClick={() => setBrush(undefined)}
            />
            <Button
              tone={brush === 'trash' ? 'default' : 'quiet'}
              icon={<Eraser size={16} />}
              label="Remove pieces"
              aria-pressed={brush === 'trash'}
              onClick={() => setBrush(brush === 'trash' ? undefined : 'trash')}
            />
          </div>
        </div>
      </section>
      <aside className="desk" aria-label="Position settings">
        <section className="panel editor-panel">
          <header className="panel-head">
            <h2>Set up a position</h2>
          </header>
          <p className="muted">
            Drag pieces from the trays, or pick one and click squares to place it. Drag a piece off
            the board to remove it.
          </p>
          <div className="field">
            <span className="field-label">Side to move</span>
            <Segmented
              label="Side to move"
              value={turn}
              onChange={setTurn}
              options={[
                { value: 'w', label: 'White' },
                { value: 'b', label: 'Black' },
              ]}
            />
          </div>
          <fieldset className="field castling">
            <legend className="field-label">Castling rights</legend>
            {RIGHTS.map((r) => (
              <label key={r.char} className={available(board, r) ? '' : 'disabled'}>
                <input
                  type="checkbox"
                  checked={castling.includes(r.char) && available(board, r)}
                  disabled={!available(board, r)}
                  onChange={() => toggleRight(r.char)}
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <div className="editor-buttons">
            <Button icon={<RotateCcw size={16} />} onClick={() => applyFen(INITIAL_FEN)}>
              Starting position
            </Button>
            <Button icon={<Trash2 size={16} />} onClick={() => (setBoard(EMPTY), setCastling(''))}>
              Clear board
            </Button>
            <Button
              icon={<FlipVertical2 size={16} />}
              onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}
            >
              Flip
            </Button>
          </div>
          <label className="field">
            <span className="field-label">FEN</span>
            <input
              className="input mono"
              value={fenText ?? fen}
              onChange={(e) => applyFen(e.target.value)}
              onBlur={() => setFenText(undefined)}
              spellCheck={false}
              aria-invalid={fenText !== undefined && !readFen(fenText).ok}
            />
          </label>
          <p className={`validity ${check.ok ? 'ok' : 'bad'}`} role="status">
            {check.ok ? 'Legal position.' : check.error}
          </p>
          <div className="editor-actions">
            <Button tone="primary" disabled={!check.ok} onClick={analyse}>
              Analyse this position
            </Button>
            <Button disabled={!check.ok || check.pos.isEnd()} onClick={play}>
              Play Stockfish from here
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}
