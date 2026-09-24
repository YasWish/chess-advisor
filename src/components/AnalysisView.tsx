import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FlipVertical2,
  Zap,
} from 'lucide-react';
import { useMemo } from 'react';
import { analysisMove, playBestMove } from '../controllers/analysisMoves';
import { threatKey } from '../controllers/liveAnalysis';
import {
  colorName,
  epdOf,
  legalDests,
  materialOf,
  nullMoveFen,
  positionFromFen,
  type Color,
} from '../lib/chess';
import { evalBarPercent, formatScoreShort, winPercentFor, type PositionEval } from '../lib/eval';
import { CLASS_GLYPH } from '../lib/review';
import { moverOf, type MoveClass } from '../lib/tree';
import { useAnalysis } from '../state/analysis';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { Board, PromotionPicker } from './Board';
import { CLASS_COLOR } from './classColors';
import { EnginePanel } from './EnginePanel';
import { MoveList, OpeningLine } from './MoveList';
import { ToolTabs } from './ToolTabs';
import { Button } from './ui';

const glyphSvg = (cls: MoveClass) =>
  `<g transform="translate(60 2)"><circle cx="20" cy="20" r="17" fill="${CLASS_COLOR[cls]}" stroke="#fff" stroke-width="3"/>` +
  `<text x="20" y="27.5" font-size="${CLASS_GLYPH[cls].length > 1 ? 17 : 21}" font-weight="700" text-anchor="middle" fill="#fff" font-family="Barlow, sans-serif">${CLASS_GLYPH[cls]}</text></g>`;

const SHOWN_GLYPHS: MoveClass[] = [
  'brilliant',
  'great',
  'best',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

function useCurrent() {
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  useAnalysis((s) => s.rev);
  return tree.get(currentId) ?? tree.root;
}

function AnalysisBoard() {
  const node = useCurrent();
  const orientation = useAnalysis((s) => s.orientation);
  const engineOn = useAnalysis((s) => s.engineOn);
  const threatOn = useAnalysis((s) => s.threatOn);
  const practice = useAnalysis((s) => s.practice);
  const evalRev = useAnalysis((s) => s.evalRev);
  const rev = useAnalysis((s) => s.rev);
  const arrows = useSettings((s) => s.arrows);
  const focus = useUi((s) => s.focusSquares);
  const pos = useMemo(() => positionFromFen(node.fen), [node.fen]);
  const dests = useMemo(() => legalDests(pos), [pos]);
  const lastMove = node.uci
    ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as [string, string])
    : undefined;

  const shapes = useMemo(() => {
    const evals = useAnalysis.getState().evals;
    const out: DrawShape[] = [];
    const arrow = (uci: string, brush: string): DrawShape => ({
      orig: uci.slice(0, 2) as Key,
      dest: uci.slice(2, 4) as Key,
      brush,
    });
    if (engineOn && !practice) {
      if (threatOn) {
        const nf = nullMoveFen(node.fen);
        const threat = nf ? evals.get(threatKey(epdOf(nf))) : undefined;
        const m = threat?.lines[0]?.moves[0];
        if (m) out.push(arrow(m, 'threat'));
      } else if (arrows) {
        const ev = evals.get(epdOf(node.fen));
        const best = ev?.lines[0];
        ev?.lines.forEach((line, i) => {
          const m = line.moves[0];
          if (!m || !best) return;
          if (
            i > 0 &&
            winPercentFor(best.score, pos.turn) - winPercentFor(line.score, pos.turn) > 8
          )
            return;
          out.push(arrow(m, i === 0 ? 'best' : 'alt'));
        });
      }
    }
    if (node.review && node.uci && SHOWN_GLYPHS.includes(node.review.cls)) {
      out.push({
        orig: node.uci.slice(2, 4) as Key,
        customSvg: { html: glyphSvg(node.review.cls) },
      });
    }
    for (const sq of focus) out.push({ orig: sq as Key, brush: 'focus' });
    return out;
    // evalRev drives re-computation when new engine output arrives.
  }, [node, pos, engineOn, threatOn, practice, arrows, focus, evalRev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="board-frame">
      <Board
        fen={node.fen}
        orientation={orientation}
        turnColor={pos.turn}
        movable={pos.isEnd() ? undefined : pos.turn}
        dests={dests}
        lastMove={lastMove}
        check={pos.isCheck()}
        shapes={shapes}
        onMove={(o, d) => void analysisMove(o, d)}
        sync={rev}
        label="Analysis board"
      />
      <PromotionPicker orientation={orientation} />
    </div>
  );
}

export function EvalBar({
  ev,
  orientation,
  turn,
}: {
  ev?: PositionEval;
  orientation: Color;
  turn: Color;
}) {
  const score = ev?.lines[0]?.score;
  const white = evalBarPercent(score);
  const whiteAhead = score ? winPercentFor(score, 'white') >= 50 : true;
  return (
    <div
      className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`}
      role="img"
      aria-label={
        score
          ? `Evaluation bar: ${formatScoreShort(score)} for ${whiteAhead ? 'White' : 'Black'}`
          : 'Evaluation bar'
      }
    >
      <div className="eval-fill" style={{ height: `${white}%` }} />
      <div className="eval-mid" />
      {score && (
        <span className={`eval-num ${whiteAhead ? 'white-side' : 'black-side'}`}>
          {formatScoreShort(score)}
        </span>
      )}
      <span className="sr-only">{turn}</span>
    </div>
  );
}

function AnalysisEvalBar() {
  const node = useCurrent();
  const orientation = useAnalysis((s) => s.orientation);
  const engineOn = useAnalysis((s) => s.engineOn);
  const practice = useAnalysis((s) => s.practice);
  useAnalysis((s) => s.evalRev);
  const ev = engineOn && !practice ? useAnalysis.getState().evals.get(epdOf(node.fen)) : undefined;
  return (
    <EvalBar
      ev={ev}
      orientation={orientation}
      turn={node.fen.includes(' w ') ? 'white' : 'black'}
    />
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function MaterialDiff({ fen, color }: { fen: string; color: Color }) {
  const pos = positionFromFen(fen);
  const roles = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
  const other: Color = color === 'white' ? 'black' : 'white';
  const icons: Array<{ role: string; n: number }> = [];
  for (const role of roles) {
    const diff = pos.board.pieces(color, role).size() - pos.board.pieces(other, role).size();
    if (diff > 0) icons.push({ role, n: diff });
  }
  const score = materialOf(pos, color) - materialOf(pos, other);
  if (!icons.length && score <= 0) return null;
  return (
    <span
      className="material"
      aria-label={`${colorName(color)} material advantage ${score > 0 ? `+${score}` : 'none'}`}
    >
      {icons.flatMap(({ role, n }) =>
        Array.from({ length: n }, (_, i) => (
          <i key={`${role}${i}`} className={`pc ${other} ${role}`} />
        )),
      )}
      {score > 0 && <span className="material-score">+{score}</span>}
    </span>
  );
}

function PlayerStrip({ side }: { side: 'top' | 'bottom' }) {
  const node = useCurrent();
  const tree = useAnalysis((s) => s.tree);
  const orientation = useAnalysis((s) => s.orientation);
  const color: Color = (side === 'bottom') === (orientation === 'white') ? 'white' : 'black';
  const tag = color === 'white' ? 'White' : 'Black';
  const name = tree.headers.get(tag);
  const elo = tree.headers.get(`${tag}Elo`);
  const toMove = node.fen.split(' ')[1] === color[0];
  let clock: number | undefined;
  for (const n of tree.path(node.id).reverse()) {
    if (n.uci && moverOf(n) === color && n.clock !== undefined) {
      clock = n.clock;
      break;
    }
  }
  return (
    <div className={`player-strip ${side} ${toMove ? 'to-move' : ''}`}>
      <span className={`side-dot ${color}`} aria-hidden="true" />
      <span className="player-name">{name && name !== '?' ? name : colorName(color)}</span>
      {elo && elo !== '?' && <span className="player-elo">{elo}</span>}
      <MaterialDiff fen={node.fen} color={color} />
      {clock !== undefined && <span className="player-clock">{formatClock(clock)}</span>}
    </div>
  );
}

function AnalysisControls() {
  const a = useAnalysis();
  const node = a.tree.get(a.currentId) ?? a.tree.root;
  const atStart = node === a.tree.root;
  const atEnd = !node.children.length;
  const inCheck = positionFromFen(node.fen).isCheck();
  return (
    <div className="controls" role="toolbar" aria-label="Board controls">
      <div className="control-group">
        <Button
          tone="quiet"
          icon={<ChevronFirst size={20} />}
          label="First move (Home)"
          disabled={atStart}
          onClick={a.first}
        />
        <Button
          tone="quiet"
          icon={<ChevronLeft size={22} />}
          label="Previous move (←)"
          disabled={atStart}
          onClick={a.prev}
        />
        <Button
          tone="quiet"
          icon={<ChevronRight size={22} />}
          label="Next move (→)"
          disabled={atEnd}
          onClick={a.next}
        />
        <Button
          tone="quiet"
          icon={<ChevronLast size={20} />}
          label="Last move (End)"
          disabled={atEnd}
          onClick={a.last}
        />
      </div>
      <div className="control-group">
        <Button
          tone="quiet"
          icon={<FlipVertical2 size={18} />}
          label="Flip board (F)"
          onClick={a.flip}
        />
        <Button
          tone="quiet"
          icon={<Crosshair size={18} />}
          label={
            inCheck ? 'Threats are not shown while in check' : "Show the opponent's threat (X)"
          }
          className={a.threatOn ? 'is-on' : ''}
          aria-pressed={a.threatOn}
          disabled={inCheck || !!a.practice}
          onClick={() => a.setThreat(!a.threatOn)}
        />
        <Button
          tone="default"
          icon={<Zap size={16} />}
          disabled={!!a.practice}
          onClick={playBestMove}
          label="Play the best move (Space)"
        >
          Best move
        </Button>
      </div>
    </div>
  );
}

export function AnalysisView() {
  return (
    <div className="workspace">
      <section className="stage" aria-label="Board">
        <PlayerStrip side="top" />
        <div className="board-row">
          <AnalysisEvalBar />
          <AnalysisBoard />
        </div>
        <PlayerStrip side="bottom" />
        <AnalysisControls />
      </section>
      <aside className="desk" aria-label="Analysis">
        <EnginePanel />
        <OpeningLine />
        <MoveList />
        <ToolTabs />
      </aside>
    </div>
  );
}
