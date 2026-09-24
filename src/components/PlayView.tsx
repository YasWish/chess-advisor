import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Flag, FlipVertical2, Handshake, Lightbulb, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  LEVELS,
  TIME_CONTROLS,
  backToSetup,
  flipPlayBoard,
  hint,
  offerDraw,
  playFen,
  playerMove,
  reviewGame,
  remaining,
  resign,
  startGame,
  takeback,
  usePlay,
} from '../controllers/play';
import { describeOutcome, legalDests, positionFromFen, squareOf, type Color } from '../lib/chess';
import { useUi } from '../state/ui';
import { MaterialDiff } from './AnalysisView';
import { Board, PromotionPicker } from './Board';
import { Button, San, Segmented } from './ui';

function formatMs(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) return `0:0${(total / 1000).toFixed(1)}`;
  const s = Math.ceil(total / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Clock({ color }: { color: Color }) {
  const phase = usePlay((s) => s.phase);
  const paused = usePlay((s) => s.paused);
  const tc = usePlay((s) => s.timeControl);
  usePlay((s) => s.moves.length);
  usePlay((s) => s.clock);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const running = phase === 'playing' && !paused && playFen().split(' ')[1] === color[0];
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(tick, 100);
    return () => window.clearInterval(t);
  }, [running]);
  if (tc === 'none') return null;
  const ms = remaining(color);
  return (
    <span
      className={`clock ${running ? 'running' : ''} ${ms < 20_000 && phase !== 'setup' ? 'low' : ''}`}
      aria-label={`${color} clock`}
    >
      {formatMs(ms)}
    </span>
  );
}

function Strip({ side }: { side: 'top' | 'bottom' }) {
  const playerColor = usePlay((s) => s.playerColor);
  const phase = usePlay((s) => s.phase);
  const level = usePlay((s) => s.level);
  const thinking = usePlay((s) => s.thinking);
  const setupColor = usePlay((s) => s.color);
  const flipped = usePlay((s) => s.flipped);
  const base: Color =
    phase === 'setup' ? (setupColor === 'black' ? 'black' : 'white') : playerColor;
  const bottomColor: Color = flipped ? (base === 'white' ? 'black' : 'white') : base;
  const color: Color =
    side === 'bottom' ? bottomColor : bottomColor === 'white' ? 'black' : 'white';
  const isPlayer = color === base;
  const lvl = LEVELS[level - 1]!;
  const fen = playFen();
  return (
    <div
      className={`player-strip ${side} ${fen.split(' ')[1] === color[0] && phase === 'playing' ? 'to-move' : ''}`}
    >
      <span className={`side-dot ${color}`} aria-hidden="true" />
      <span className="player-name">{isPlayer ? 'You' : `Stockfish · ${lvl.name}`}</span>
      {!isPlayer && <span className="player-elo">{lvl.elo}</span>}
      {!isPlayer && thinking && <span className="thinking" aria-label="thinking" />}
      <MaterialDiff fen={fen} color={color} />
      {phase !== 'setup' && <Clock color={color} />}
    </div>
  );
}

function PlayBoard() {
  const phase = usePlay((s) => s.phase);
  const playerColor = usePlay((s) => s.playerColor);
  const setupColor = usePlay((s) => s.color);
  const moves = usePlay((s) => s.moves);
  const paused = usePlay((s) => s.paused);
  const hintMove = usePlay((s) => s.hint);
  const flipped = usePlay((s) => s.flipped);
  const [sync, bump] = useReducer((x: number) => x + 1, 0);
  const fen = playFen();
  const pos = useMemo(() => positionFromFen(fen), [fen]);
  const baseColor = phase === 'setup' ? (setupColor === 'black' ? 'black' : 'white') : playerColor;
  const orientation: Color = flipped ? (baseColor === 'white' ? 'black' : 'white') : baseColor;
  const myTurn = pos.turn === playerColor;
  const active = phase === 'playing' && !paused;
  const last = moves.at(-1);
  const shapes = useMemo<DrawShape[]>(
    () =>
      hintMove
        ? [{ orig: hintMove.slice(0, 2) as Key, dest: hintMove.slice(2, 4) as Key, brush: 'hint' }]
        : [],
    [hintMove],
  );

  const onMove = async (orig: string, dest: string) => {
    const p = positionFromFen(playFen());
    const from = squareOf(orig);
    let uci = orig + dest;
    if (
      from !== undefined &&
      p.board.getRole(from) === 'pawn' &&
      (dest[1] === '8' || dest[1] === '1')
    ) {
      const role = await useUi.getState().askPromotion(p.turn, dest);
      if (!role) return bump();
      uci += role === 'knight' ? 'n' : role[0];
    }
    if (!playerMove(uci)) bump();
  };

  return (
    <div className="board-frame">
      <Board
        fen={fen}
        orientation={orientation}
        turnColor={pos.turn}
        movable={active ? playerColor : undefined}
        dests={active && myTurn ? legalDests(pos) : undefined}
        premovable={active}
        premoveToken={moves.length}
        lastMove={last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : undefined}
        check={pos.isCheck()}
        shapes={shapes}
        onMove={(o, d) => void onMove(o, d)}
        sync={sync}
        label="Game board"
      />
      <PromotionPicker orientation={orientation} />
    </div>
  );
}

const COLORS = [
  { value: 'white' as const, label: 'White' },
  { value: 'random' as const, label: 'Random' },
  { value: 'black' as const, label: 'Black' },
];

function PlaySetup() {
  const color = usePlay((s) => s.color);
  const level = usePlay((s) => s.level);
  const timeControl = usePlay((s) => s.timeControl);
  const fromCurrent = usePlay((s) => s.fromCurrent);
  const configure = usePlay((s) => s.configure);
  const lvl = LEVELS[level - 1]!;
  return (
    <section className="panel play-setup">
      <header className="panel-head">
        <h2>Play Stockfish</h2>
      </header>
      <div className="field">
        <span className="field-label">Your colour</span>
        <div className="color-pick" role="radiogroup" aria-label="Your colour">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={color === c.value}
              className={color === c.value ? 'on' : ''}
              onClick={() => configure({ color: c.value })}
            >
              {c.value === 'random' ? (
                <span className="half-king">
                  <i className="pc white king" />
                  <i className="pc black king" />
                </span>
              ) : (
                <i className={`pc ${c.value} king`} />
              )}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="level">
          Strength <strong>level {level}</strong> · {lvl.name}{' '}
          <span className="muted">({lvl.elo === 'max' ? 'about 3500' : lvl.elo} Elo)</span>
        </label>
        <input
          id="level"
          type="range"
          min={1}
          max={10}
          value={level}
          onChange={(e) => configure({ level: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <span className="field-label">Time control</span>
        <Segmented
          label="Time control"
          value={timeControl}
          onChange={(v) => configure({ timeControl: v })}
          options={TIME_CONTROLS.map((t) => ({ value: t.id, label: t.label }))}
        />
      </div>
      <div className="field">
        <span className="field-label">Starting position</span>
        <Segmented
          label="Starting position"
          value={fromCurrent ? 'current' : 'standard'}
          onChange={(v) => configure({ fromCurrent: v === 'current' })}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'current', label: 'From the analysis board' },
          ]}
        />
      </div>
      <Button tone="primary" className="btn-wide" onClick={startGame}>
        Start game
      </Button>
      <p className="fineprint">
        Levels 4–9 use Stockfish's calibrated Elo limiter. Levels 1–3 play deliberately loose moves,
        like a beginner would. You can premove while the engine thinks.
      </p>
    </section>
  );
}

function GameMoves() {
  const moves = usePlay((s) => s.moves);
  const startFen = usePlay((s) => s.startFen);
  const blackFirst = startFen.split(' ')[1] === 'b';
  const startNo = Number(startFen.split(' ')[5] ?? 1);
  const rows: Array<{ n: number; w?: string; b?: string }> = [];
  moves.forEach((m, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const n = startNo + Math.floor(ply / 2);
    if (ply % 2 === 0) rows.push({ n, w: m.san });
    else if (rows.length && rows.at(-1)!.n === n) rows.at(-1)!.b = m.san;
    else rows.push({ n, b: m.san });
  });
  return (
    <ol className="game-moves">
      {rows.map((r) => (
        <li key={r.n}>
          <span className="mv-index">{r.n}</span>
          <span>{r.w ? <San san={r.w} color="white" /> : '…'}</span>
          <span>{r.b && <San san={r.b} color="black" />}</span>
        </li>
      ))}
    </ol>
  );
}

function PlayGame() {
  const phase = usePlay((s) => s.phase);
  const outcome = usePlay((s) => s.outcome);
  const thinking = usePlay((s) => s.thinking);
  const playerColor = usePlay((s) => s.playerColor);
  const moves = usePlay((s) => s.moves);
  const [confirmResign, setConfirmResign] = useState(false);
  const pos = positionFromFen(playFen());
  const over = phase === 'over';
  const won = outcome?.winner === playerColor;
  const status = over
    ? `${describeOutcome(outcome!)}.`
    : thinking
      ? 'Stockfish is thinking…'
      : pos.turn === playerColor
        ? pos.isCheck()
          ? 'Your move — you are in check.'
          : 'Your move.'
        : 'Waiting for Stockfish…';
  return (
    <section className="panel play-game">
      <p
        className={`play-status ${over ? (outcome?.winner ? (won ? 'won' : 'lost') : 'drawn') : ''}`}
        aria-live="polite"
      >
        {over && (
          <strong>{outcome?.winner ? (won ? 'You won. ' : 'Stockfish won. ') : 'Draw. '}</strong>
        )}
        {status}
      </p>
      <GameMoves />
      {over ? (
        <div className="play-actions">
          <Button tone="primary" onClick={reviewGame}>
            Review this game
          </Button>
          <Button onClick={startGame}>Play again</Button>
          <Button tone="quiet" onClick={backToSetup}>
            Change settings
          </Button>
        </div>
      ) : (
        <div className="play-actions">
          <Button icon={<Undo2 size={16} />} onClick={takeback} disabled={!moves.length}>
            Takeback
          </Button>
          <Button
            icon={<Lightbulb size={16} />}
            onClick={() => void hint()}
            disabled={thinking || pos.turn !== playerColor}
          >
            Hint
          </Button>
          <Button icon={<Handshake size={16} />} onClick={offerDraw}>
            Offer draw
          </Button>
          {confirmResign ? (
            <Button
              tone="danger"
              icon={<Flag size={16} />}
              onClick={() => (resign(), setConfirmResign(false))}
              onBlur={() => setConfirmResign(false)}
              autoFocus
            >
              Confirm resign
            </Button>
          ) : (
            <Button icon={<Flag size={16} />} onClick={() => setConfirmResign(true)}>
              Resign
            </Button>
          )}
          <Button
            tone="quiet"
            icon={<FlipVertical2 size={16} />}
            label="Flip board"
            onClick={flipPlayBoard}
          />
        </div>
      )}
      {!over && (
        <p className="fineprint">
          Leaving this tab pauses the game and the clocks.{' '}
          <button type="button" className="link" onClick={reviewGame}>
            Analyse the game so far
          </button>
        </p>
      )}
    </section>
  );
}

export function PlayView() {
  const phase = usePlay((s) => s.phase);
  return (
    <div className="workspace">
      <section className="stage" aria-label="Board">
        <Strip side="top" />
        <div className="board-row">
          <PlayBoard />
        </div>
        <Strip side="bottom" />
      </section>
      <aside className="desk" aria-label="Game">
        {phase === 'setup' ? <PlaySetup /> : <PlayGame />}
      </aside>
    </div>
  );
}
