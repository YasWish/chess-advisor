import { AlertTriangle, Cloud, Cpu, RotateCw } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { playMoveSound } from '../audio/sound';
import { practiceNext, practiceReveal, stopPractice } from '../controllers/review';
import { threatKey } from '../controllers/liveAnalysis';
import { engine } from '../engine/stockfish';
import {
  describeOutcome,
  epdOf,
  nullMoveFen,
  positionFromFen,
  positionOutcome,
  readFen,
  playUci,
  type Color,
} from '../lib/chess';
import { formatScore, informator, type PvLine, type Score } from '../lib/eval';
import { useAnalysis } from '../state/analysis';
import { useSettings } from '../state/settings';
import { Button, San, Segmented } from './ui';

function useEngineStatus() {
  return useSyncExternalStore(
    (fn) => engine.onChange(fn),
    () => `${engine.state}|${engine.name}|${engine.error ?? ''}`,
  );
}

function formatNps(nps?: number): string {
  if (!nps) return '';
  return nps >= 1e6 ? `${(nps / 1e6).toFixed(1)}M nodes/s` : `${Math.round(nps / 1e3)}k nodes/s`;
}

/** Plays the first `upto + 1` moves of a principal variation into the tree. */
function playLine(line: PvLine, upto: number): void {
  const a = useAnalysis.getState();
  let last;
  for (const uci of line.moves.slice(0, upto + 1)) last = a.play(uci) ?? last;
  if (last) playMoveSound(last);
}

function Line({ fen, line, threat }: { fen: string; line: PvLine; threat: boolean }) {
  const start = readFen(fen);
  if (!start.ok) return null;
  const pos = start.pos;
  let number = pos.fullmoves;
  const tokens: Array<{ san: string; color: Color; prefix: string }> = [];
  for (const [i, uci] of line.moves.slice(0, 12).entries()) {
    const color = pos.turn;
    const played = playUci(pos, uci);
    if (!played) break;
    const prefix = color === 'white' ? `${number}.` : i === 0 ? `${number}…` : '';
    if (color === 'black') number++;
    tokens.push({ san: played.san, color, prefix });
  }
  return (
    <li className={`pv ${threat ? 'pv-threat' : ''}`}>
      <span className="pv-score">{formatScore(line.score)}</span>
      <span className="pv-moves">
        {tokens.map((t, i) => (
          <button
            key={i}
            type="button"
            className="pv-move"
            onClick={() => !threat && playLine(line, i)}
            disabled={threat}
            title={threat ? undefined : 'Play this line up to here'}
          >
            {t.prefix && <span className="pv-num">{t.prefix}</span>}
            <San san={t.san} color={t.color} />
          </button>
        ))}
      </span>
    </li>
  );
}

function Wdl({ wdl }: { wdl: [number, number, number] }) {
  const [w, d, l] = [wdl[0] / 10, wdl[1] / 10, wdl[2] / 10];
  return (
    <div
      className="wdl"
      role="img"
      aria-label={`White wins ${w.toFixed(0)}%, draw ${d.toFixed(0)}%, Black wins ${l.toFixed(0)}%`}
    >
      <span className="wdl-w" style={{ flexGrow: w }} />
      <span className="wdl-d" style={{ flexGrow: d }} />
      <span className="wdl-l" style={{ flexGrow: l }} />
      <span className="wdl-legend">
        White {w.toFixed(0)}% · draw {d.toFixed(0)}% · Black {l.toFixed(0)}%
      </span>
    </div>
  );
}

function Verdict({ score }: { score: Score }) {
  const info = informator(score);
  return (
    <div className="verdict">
      <span className="verdict-score">{formatScore(score)}</span>
      <span className="verdict-symbol" aria-hidden="true">
        {info.symbol}
      </span>
      <span className="verdict-label">{info.label}</span>
    </div>
  );
}

function PracticeCard() {
  const p = useAnalysis((s) => s.practice)!;
  const done = p.status === 'finished';
  return (
    <section className="panel practice" aria-live="polite">
      <header className="panel-head">
        <h2>Practise your mistakes</h2>
        <span className="muted">
          {Math.min(p.index + 1, p.items.length)} of {p.items.length}
        </span>
      </header>
      <p className={`practice-msg practice-${p.status}`}>{p.message}</p>
      <div className="practice-actions">
        {!done && p.status !== 'correct' && p.status !== 'revealed' && (
          <Button onClick={practiceReveal} disabled={p.status === 'checking'}>
            Show the answer
          </Button>
        )}
        {!done && (
          <Button
            tone={p.status === 'correct' || p.status === 'revealed' ? 'primary' : 'default'}
            onClick={practiceNext}
          >
            {p.index + 1 >= p.items.length ? 'Finish' : 'Next mistake'}
          </Button>
        )}
        <Button tone="quiet" onClick={stopPractice}>
          {done ? 'Close' : 'Stop practising'}
        </Button>
      </div>
    </section>
  );
}

const DEPTHS = [
  { value: 16, label: '16' },
  { value: 22, label: '22' },
  { value: 30, label: '30' },
  { value: 0, label: '∞', title: 'Keep searching until you move on' },
];

export function EnginePanel() {
  const status = useEngineStatus();
  const [state, name, error] = status.split('|');
  const engineOn = useAnalysis((s) => s.engineOn);
  const threatOn = useAnalysis((s) => s.threatOn);
  const practice = useAnalysis((s) => s.practice);
  const setEngine = useAnalysis((s) => s.setEngine);
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  useAnalysis((s) => s.evalRev);
  const depthSetting = useSettings((s) => s.depth);
  const update = useSettings((s) => s.update);

  if (practice) return <PracticeCard />;

  const node = tree.get(currentId) ?? tree.root;
  const pos = positionFromFen(node.fen);
  const outcome = positionOutcome(pos);
  const threatFen = threatOn ? nullMoveFen(node.fen) : undefined;
  const fen = threatFen ?? node.fen;
  const key = threatFen ? threatKey(epdOf(threatFen)) : epdOf(node.fen);
  const ev = engineOn ? useAnalysis.getState().evals.get(key) : undefined;
  const best = ev?.lines[0];
  const searching = engineOn && engine.busy;

  return (
    <section className="panel engine" aria-label="Engine analysis">
      <header className="panel-head">
        <button
          type="button"
          role="switch"
          aria-checked={engineOn}
          className="switch"
          onClick={() => setEngine(!engineOn)}
          title="Turn the engine on or off (L)"
        >
          <span className="switch-knob" />
        </button>
        <h2 className="engine-name">{threatOn ? 'Threat analysis' : name}</h2>
        <span className="engine-meta">
          {ev?.source === 'cloud' ? (
            <span className="badge" title="Evaluation from the Lichess cloud database">
              <Cloud size={13} /> Cloud, depth {ev.depth}
            </span>
          ) : ev ? (
            <span className="badge" title={formatNps(ev.nps)}>
              <Cpu size={13} /> Depth {ev.depth}
              {depthSetting > 0 ? `/${depthSetting}` : ''}
            </span>
          ) : null}
        </span>
        <Segmented
          label="Search depth"
          value={depthSetting}
          onChange={(v) => update({ depth: v })}
          options={DEPTHS}
        />
      </header>

      {!engineOn ? (
        <p className="engine-empty">
          The engine is off. Turn it on to see the best moves and an evaluation.
        </p>
      ) : outcome ? (
        <p className="engine-empty engine-outcome">{describeOutcome(outcome)}.</p>
      ) : state === 'error' ? (
        <div className="engine-error">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <Button
            tone="quiet"
            icon={<RotateCw size={14} />}
            onClick={() => void engine.init().then(() => setEngine(true))}
          >
            Retry
          </Button>
        </div>
      ) : threatOn && !threatFen ? (
        <p className="engine-empty">
          You are in check, so there is no threat to show — the check is the threat.
        </p>
      ) : !best ? (
        <p className="engine-empty">{state === 'loading' ? `Starting ${name}…` : 'Thinking…'}</p>
      ) : (
        <>
          {!threatOn && <Verdict score={best.score} />}
          {!threatOn && ev?.wdl && <Wdl wdl={ev.wdl} />}
          <ol className={`pvs ${searching ? 'live' : ''}`}>
            {ev!.lines.map((line) => (
              <Line key={line.multipv} fen={fen} line={line} threat={threatOn} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
