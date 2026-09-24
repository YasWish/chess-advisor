import { useEffect, useMemo, useState } from 'react';
import { playMoveSound } from '../audio/sound';
import { threatKey } from '../controllers/liveAnalysis';
import {
  probeTablebase,
  tablebaseEligible,
  tbMoveOutcome,
  tbOutcome,
  type TbResult,
} from '../engine/tablebase';
import { colorName, epdOf, nullMoveFen, pieceCount, positionFromFen } from '../lib/chess';
import { describeThreat, explainBestMove, positionInsights, type Insight } from '../lib/insights';
import { bookMoves, loadOpenings, lookupOpening, openingsReady } from '../lib/openings';
import type { MoveClass } from '../lib/tree';
import { useAnalysis } from '../state/analysis';
import { useUi, type ToolTab } from '../state/ui';
import { ReviewPanel } from './ReviewPanel';
import { San } from './ui';

const GRADE_PHRASE: Record<MoveClass, string> = {
  brilliant: 'a brilliant move',
  great: 'a great move',
  best: 'the best move',
  excellent: 'excellent',
  good: 'good',
  book: 'a book move',
  forced: 'the only legal move',
  inaccuracy: 'an inaccuracy',
  mistake: 'a mistake',
  miss: 'a missed win',
  blunder: 'a blunder',
};

function useNode() {
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  useAnalysis((s) => s.rev);
  return tree.get(currentId) ?? tree.root;
}

function play(uci: string) {
  const played = useAnalysis.getState().play(uci);
  if (played) playMoveSound(played);
}

function InsightItem({ insight }: { insight: Insight }) {
  const setFocus = useUi((s) => s.setFocus);
  return (
    <li
      className={`insight tone-${insight.tone}`}
      onMouseEnter={() => setFocus(insight.squares)}
      onMouseLeave={() => setFocus([])}
      onFocus={() => setFocus(insight.squares)}
      onBlur={() => setFocus([])}
      tabIndex={insight.squares.length ? 0 : undefined}
    >
      {insight.text}
    </li>
  );
}

function InsightsPanel() {
  const node = useNode();
  const tree = useAnalysis((s) => s.tree);
  const engineOn = useAnalysis((s) => s.engineOn);
  const threatOn = useAnalysis((s) => s.threatOn);
  const setThreat = useAnalysis((s) => s.setThreat);
  const practice = useAnalysis((s) => s.practice);
  useAnalysis((s) => s.evalRev);
  const pos = useMemo(() => positionFromFen(node.fen), [node.fen]);

  const ev = useAnalysis.getState().evals.get(epdOf(node.fen));
  // Cheap enough to recompute on every engine update, so the text follows the live search.
  const explanation = ev?.lines[0] ? explainBestMove(node.fen, ev.lines[0], ev.lines) : undefined;
  const nullFen = nullMoveFen(node.fen);
  const threatEval = nullFen
    ? useAnalysis.getState().evals.get(threatKey(epdOf(nullFen)))
    : undefined;
  const threat =
    threatOn && nullFen && threatEval?.lines[0]
      ? describeThreat(nullFen, threatEval.lines[0])
      : undefined;
  const observations = useMemo(() => positionInsights(node.fen), [node.fen]);
  const review = node.review;
  const parent = tree.parent(node.id);

  if (practice) return <p className="tab-empty">Hints are hidden while you practise.</p>;
  if (pos.isEnd()) return <p className="tab-empty">The game is over in this position.</p>;

  return (
    <div className="insights">
      {review && parent && (
        <section className="insight-block">
          <h3>
            <San san={node.san!} color={pos.turn === 'white' ? 'black' : 'white'} /> was{' '}
            {GRADE_PHRASE[review.cls]}
          </h3>
          {review.bestSan &&
            review.bestUci !== node.uci &&
            ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(review.cls) && (
              <p>
                Better was{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    useAnalysis.getState().goto(parent.id);
                    play(review.bestUci!);
                  }}
                >
                  <San san={review.bestSan} color={pos.turn === 'white' ? 'black' : 'white'} />
                </button>
                .
              </p>
            )}
        </section>
      )}

      <section className="insight-block">
        <h3>Best move</h3>
        {!engineOn ? (
          <p className="muted">Turn the engine on for an explanation of the best move.</p>
        ) : explanation ? (
          <>
            <p className="explain-summary">{explanation.summary}</p>
            <ul className="explain-points">
              {explanation.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">Analysing…</p>
        )}
      </section>

      <section className="insight-block">
        <h3>Threats</h3>
        {!nullFen ? (
          <p>{colorName(pos.turn)} is in check and must deal with it first.</p>
        ) : threatOn ? (
          threat ? (
            <p className={`insight tone-${threat.tone}`}>{threat.text}</p>
          ) : (
            <p className="muted">Looking for threats…</p>
          )
        ) : (
          <p>
            <button type="button" className="link" onClick={() => setThreat(true)}>
              Show what {colorName(pos.turn === 'white' ? 'black' : 'white')} is threatening
            </button>{' '}
            <span className="muted">(X)</span>
          </p>
        )}
      </section>

      <section className="insight-block">
        <h3>Position</h3>
        <ul className="insight-list">
          {observations.map((o) => (
            <InsightItem key={o.text} insight={o} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function OpeningsPanel() {
  const node = useNode();
  const [ready, setReady] = useState(openingsReady());
  useEffect(() => {
    if (!ready) void loadOpenings().then(() => setReady(true));
  }, [ready]);
  const moves = useMemo(() => (ready ? bookMoves(node.fen) : []), [ready, node.fen]);
  const here = ready ? lookupOpening(node.fen) : undefined;
  if (!ready) return <p className="tab-empty">Loading openings…</p>;
  const turn = node.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  return (
    <div className="openings">
      {here ? (
        <p className="opening-here">
          <span className="eco">{here.eco}</span> {here.name}
        </p>
      ) : (
        <p className="muted">This position is not a named opening position.</p>
      )}
      {moves.length ? (
        <>
          <h3>Named continuations</h3>
          <ul className="book-moves">
            {moves.map((m) => (
              <li key={m.uci}>
                <button type="button" className="book-move" onClick={() => play(m.uci)}>
                  <span className="book-san">
                    <San san={m.san} color={turn} />
                  </span>
                  <span className="book-name">
                    <span className="eco">{m.opening.eco}</span> {m.opening.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">No named opening continues from here.</p>
      )}
      <p className="fineprint">
        Names from the Lichess chess-openings database (public domain), matched by position, so
        transpositions are recognised.
      </p>
    </div>
  );
}

const OUTCOME_LABEL = { win: 'Win', draw: 'Draw', loss: 'Loss', unknown: '?' } as const;

function EndgamePanel() {
  const node = useNode();
  const [state, setState] = useState<{ fen: string; result?: TbResult; failed?: boolean }>();
  const eligible = tablebaseEligible(node.fen);
  useEffect(() => {
    if (!eligible) return;
    const ctrl = new AbortController();
    void probeTablebase(node.fen, ctrl.signal).then((result) => {
      if (!ctrl.signal.aborted) setState({ fen: node.fen, result, failed: !result });
    });
    return () => ctrl.abort();
  }, [eligible, node.fen]);

  if (!eligible) {
    return (
      <p className="tab-empty">
        Perfect endgame play from the Syzygy tablebases appears once 7 or fewer pieces remain and
        castling is no longer possible. This position has {pieceCount(node.fen)} pieces.
      </p>
    );
  }
  if (!state || state.fen !== node.fen)
    return <p className="tab-empty">Consulting the tablebase…</p>;
  if (state.failed || !state.result)
    return (
      <p className="tab-empty">
        The Lichess tablebase could not be reached. Check your connection.
      </p>
    );
  const r = state.result;
  const turn = node.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const outcome = tbOutcome(r.category);
  const headline = r.checkmate
    ? 'Checkmate.'
    : r.stalemate
      ? 'Stalemate.'
      : outcome === 'win'
        ? `${colorName(turn)} wins with correct play.`
        : outcome === 'loss'
          ? `${colorName(turn)} loses with correct play.`
          : outcome === 'draw'
            ? 'A draw with correct play.'
            : 'Unknown.';
  return (
    <div className="tablebase">
      <p className={`tb-headline tb-${outcome}`}>
        {headline}
        {r.dtm != null && <span className="muted"> Mate in {Math.ceil(Math.abs(r.dtm) / 2)}.</span>}
      </p>
      <ul className="tb-moves">
        {r.moves.slice(0, 14).map((m) => {
          const o = tbMoveOutcome(m);
          return (
            <li key={m.uci}>
              <button type="button" className="tb-move" onClick={() => play(m.uci)}>
                <span className="tb-san">
                  <San san={m.san} color={turn} />
                </span>
                <span className={`tb-badge tb-${o}`}>{OUTCOME_LABEL[o]}</span>
                <span className="muted">
                  {m.checkmate
                    ? 'checkmate'
                    : m.dtm != null
                      ? `DTM ${Math.abs(m.dtm)}`
                      : m.dtz != null
                        ? `DTZ ${Math.abs(m.dtz)}`
                        : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fineprint">
        Syzygy 7-piece tablebases via the Lichess tablebase API. DTZ counts moves until the 50-move
        counter resets.
      </p>
    </div>
  );
}

const TABS: Array<{ id: ToolTab; label: string }> = [
  { id: 'insights', label: 'Insights' },
  { id: 'review', label: 'Review' },
  { id: 'openings', label: 'Openings' },
  { id: 'endgame', label: 'Endgame' },
];

export function ToolTabs() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const node = useNode();
  const reviewing = useAnalysis((s) => !!s.reviewProgress);
  const eligible = tablebaseEligible(node.fen);
  return (
    <section className="panel tools">
      <div className="tabs" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'endgame' && eligible && (
              <span className="tab-dot" aria-label="(available)" />
            )}
            {t.id === 'review' && reviewing && (
              <span className="tab-dot live" aria-label="(running)" />
            )}
          </button>
        ))}
      </div>
      <div
        className="tab-body"
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'insights' && <InsightsPanel />}
        {tab === 'openings' && <OpeningsPanel />}
        {tab === 'endgame' && <EndgamePanel />}
        {tab === 'review' && <ReviewPanel />}
      </div>
    </section>
  );
}
