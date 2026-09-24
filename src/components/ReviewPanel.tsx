import { useEffect, useMemo, useRef, useState } from 'react';
import { cancelReview, mistakesOf, runReview, startPractice } from '../controllers/review';
import { colorName, type Color } from '../lib/chess';
import { formatScore } from '../lib/eval';
import { CLASS_GLYPH, CLASS_LABEL, CLASS_ORDER } from '../lib/review';
import { moveNumberOf, moverOf, type MoveClass } from '../lib/tree';
import { useAnalysis, type ReviewSummary } from '../state/analysis';
import { useSettings } from '../state/settings';
import { CLASS_COLOR } from './classColors';
import { Button, San, Segmented } from './ui';

const REVIEW_DEPTHS = [
  { value: 12, label: 'Quick', title: 'Depth 12' },
  { value: 14, label: 'Standard', title: 'Depth 14' },
  { value: 18, label: 'Deep', title: 'Depth 18 — slower, more reliable' },
];

const KEY_CLASSES: MoveClass[] = ['brilliant', 'great', 'miss', 'blunder', 'mistake'];

function EvalGraph({ review }: { review: ReviewSummary }) {
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  const goto = useAnalysis((s) => s.goto);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [hover, setHover] = useState<number>();
  const height = 110;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(120, Math.round(entry!.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = review.whiteWin.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const y = (w: number) => height - (w / 100) * height;
  const line = review.whiteWin
    .map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w).toFixed(1)}`)
    .join('');
  const area = `${line}L${width},${height}L0,${height}Z`;
  const currentIndex = review.nodeIds.indexOf(currentId);

  const indexAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((clientX - rect.left) / rect.width) * (n - 1))));
  };
  const hovered = hover !== undefined ? tree.get(review.nodeIds[hover]!) : undefined;

  return (
    <div
      className="eval-graph"
      ref={box}
      onPointerMove={(e) => setHover(indexAt(e.clientX))}
      onPointerLeave={() => setHover(undefined)}
      onClick={(e) => goto(review.nodeIds[indexAt(e.clientX)]!)}
      role="img"
      aria-label="Evaluation graph: White's winning chances over the game. Click to jump to a move."
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect className="graph-black" x="0" y="0" width={width} height={height} />
        <path className="graph-white" d={area} />
        <line className="graph-mid" x1="0" x2={width} y1={height / 2} y2={height / 2} />
        <path className="graph-line" d={line} />
        {review.nodeIds.map((id, i) => {
          const cls = tree.get(id)?.review?.cls;
          if (!cls || !KEY_CLASSES.includes(cls)) return null;
          return (
            <circle
              key={id}
              cx={x(i)}
              cy={y(review.whiteWin[i]!)}
              r="3.6"
              fill={CLASS_COLOR[cls]}
              className="graph-dot"
            />
          );
        })}
        {currentIndex >= 0 && (
          <line
            className="graph-cursor"
            x1={x(currentIndex)}
            x2={x(currentIndex)}
            y1="0"
            y2={height}
          />
        )}
        {hover !== undefined && (
          <line className="graph-hover" x1={x(hover)} x2={x(hover)} y1="0" y2={height} />
        )}
      </svg>
      {hovered?.san && (
        <span
          className="graph-tip"
          style={{ left: Math.min(width - 110, Math.max(0, x(hover!) - 50)) }}
        >
          {moveNumberOf(hovered)}
          {moverOf(hovered) === 'white' ? '. ' : '… '}
          {hovered.san} {formatScore(review.scores[hover!]!)}
        </span>
      )}
    </div>
  );
}

function Accuracy({ color, review }: { color: Color; review: ReviewSummary }) {
  const tree = useAnalysis((s) => s.tree);
  const acc = review.accuracy[color];
  const name = tree.headers.get(color === 'white' ? 'White' : 'Black');
  return (
    <div className={`accuracy acc-${color}`}>
      <span className="acc-name">{name && name !== '?' ? name : colorName(color)}</span>
      <span className="acc-value">{acc !== undefined ? acc.toFixed(1) : '–'}</span>
      <span className="acc-caption">
        accuracy{review.acpl[color] !== undefined ? ` · ${review.acpl[color]} ACPL` : ''}
      </span>
    </div>
  );
}

export function ReviewPanel() {
  const review = useAnalysis((s) => s.review);
  const progress = useAnalysis((s) => s.reviewProgress);
  const tree = useAnalysis((s) => s.tree);
  const goto = useAnalysis((s) => s.goto);
  useAnalysis((s) => s.rev);
  const depth = useSettings((s) => s.reviewDepth);
  const update = useSettings((s) => s.update);
  const plies = tree.mainline().length - 1;

  const keyMoments = useMemo(
    () =>
      review ? tree.mainline().filter((n) => n.review && KEY_CLASSES.includes(n.review.cls)) : [],
    [review, tree],
  );

  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <div className="review-running">
        <p>
          {progress.phase === 'analysing'
            ? `Analysing position ${progress.done} of ${progress.total}…`
            : `Double-checking critical move ${progress.done + 1} of ${progress.total} with a deeper search…`}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <Button tone="quiet" onClick={cancelReview}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="review-start">
        <p>
          Stockfish analyses every move of the main line, grades each one — from brilliant to
          blunder — and computes both players' accuracy the way Lichess does.
        </p>
        <div className="review-controls">
          <Segmented
            label="Review depth"
            value={depth}
            onChange={(v) => update({ reviewDepth: v })}
            options={REVIEW_DEPTHS}
          />
          <Button tone="primary" disabled={plies < 1} onClick={() => void runReview()}>
            Review {plies ? `${plies} ${plies === 1 ? 'move' : 'moves'}` : 'game'}
          </Button>
        </div>
      </div>
    );
  }

  const classes = CLASS_ORDER.filter((c) => review.counts.white[c] || review.counts.black[c]);
  return (
    <div className="review">
      <div className="accuracies">
        <Accuracy color="white" review={review} />
        <Accuracy color="black" review={review} />
      </div>
      <EvalGraph review={review} />
      <table className="class-table">
        <thead>
          <tr>
            <th scope="col">Move quality</th>
            <th scope="col">White</th>
            <th scope="col">Black</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c}>
              <th scope="row">
                <span
                  className="class-glyph"
                  style={{ background: CLASS_COLOR[c] }}
                  aria-hidden="true"
                >
                  {CLASS_GLYPH[c]}
                </span>
                {CLASS_LABEL[c]}
              </th>
              <td>{review.counts.white[c] ?? 0}</td>
              <td>{review.counts.black[c] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {keyMoments.length > 0 && (
        <>
          <h3>Key moments</h3>
          <ul className="moments">
            {keyMoments.map((n) => (
              <li key={n.id}>
                <button type="button" className="moment" onClick={() => goto(n.id)}>
                  <span
                    className="class-glyph"
                    style={{ background: CLASS_COLOR[n.review!.cls] }}
                    aria-hidden="true"
                  >
                    {CLASS_GLYPH[n.review!.cls]}
                  </span>
                  <span>
                    {moveNumberOf(n)}
                    {moverOf(n) === 'white' ? '.' : '…'} <San san={n.san!} color={moverOf(n)} />
                  </span>
                  <span className="muted">
                    {CLASS_LABEL[n.review!.cls]}
                    {n.review!.bestSan && n.review!.bestUci !== n.uci
                      ? ` · best was ${n.review!.bestSan}`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="practice-start">
        {(['white', 'black'] as const).map((c) => {
          const count = mistakesOf(c).length;
          return (
            <Button key={c} disabled={!count} onClick={() => startPractice(c)}>
              Practise {colorName(c)}'s mistakes ({count})
            </Button>
          );
        })}
      </div>
      <p className="fineprint">
        Depth {review.depth}. Grades use winning-chance loss: inaccuracy ≥ 5, mistake ≥ 10, blunder
        ≥ 15 points.{' '}
        <button type="button" className="link" onClick={() => void runReview()}>
          Run again
        </button>
      </p>
    </div>
  );
}
