import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadOpenings, openingOfLine, openingsReady } from '../lib/openings';
import { CLASS_GLYPH, CLASS_LABEL } from '../lib/review';
import { moveNumberOf, moverOf, type TreeNode } from '../lib/tree';
import { useAnalysis } from '../state/analysis';
import { CLASS_COLOR } from './classColors';
import { San } from './ui';

const NAG_SYMBOL: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
};
const LIST_GLYPHS = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

interface MenuState {
  x: number;
  y: number;
  id: string;
}

function Move({
  node,
  numbered,
  onMenu,
}: {
  node: TreeNode;
  numbered: boolean;
  onMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const current = useAnalysis((s) => s.currentId === node.id);
  const goto = useAnalysis((s) => s.goto);
  const cls = node.review?.cls;
  const white = moverOf(node) === 'white';
  return (
    <button
      type="button"
      className={`mv ${current ? 'current' : ''}`}
      data-id={node.id}
      data-san={node.san}
      aria-current={current ? 'true' : undefined}
      onClick={() => goto(node.id)}
      onContextMenu={(e) => onMenu(e, node.id)}
      title={cls ? CLASS_LABEL[cls] : undefined}
    >
      {numbered && (
        <span className="mv-num">
          {moveNumberOf(node)}
          {white ? '.' : '…'}
        </span>
      )}
      <San san={node.san!} color={moverOf(node)} />
      {node.nags?.map((g) =>
        NAG_SYMBOL[g] ? (
          <span key={g} className="mv-nag">
            {NAG_SYMBOL[g]}
          </span>
        ) : null,
      )}
      {cls && LIST_GLYPHS.has(cls) && (
        <span
          className="mv-glyph"
          style={{ color: CLASS_COLOR[cls] }}
          aria-label={CLASS_LABEL[cls]}
        >
          {CLASS_GLYPH[cls]}
        </span>
      )}
    </button>
  );
}

function Comments({ node }: { node: TreeNode }) {
  if (!node.comments?.length) return null;
  return <span className="comment">{node.comments.join(' ')}</span>;
}

/** Renders the continuation after `parent` inline, with sub-variations in parentheses. */
function inline(
  parent: TreeNode,
  forceNumber: boolean,
  onMenu: (e: React.MouseEvent, id: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  let p = parent;
  let force = forceNumber;
  while (p.children.length) {
    const [main, ...alts] = p.children as [TreeNode, ...TreeNode[]];
    out.push(
      <Move
        key={main.id}
        node={main}
        numbered={force || moverOf(main) === 'white'}
        onMenu={onMenu}
      />,
    );
    force = false;
    if (main.comments?.length) {
      out.push(<Comments key={`${main.id}c`} node={main} />);
      force = true;
    }
    for (const alt of alts) {
      out.push(
        <span key={`${alt.id}v`} className="subline">
          <Move node={alt} numbered onMenu={onMenu} />
          <Comments node={alt} />
          {inline(alt, !!alt.comments?.length, onMenu)}
        </span>,
      );
      force = true;
    }
    p = main;
  }
  return out;
}

export function MoveList() {
  const tree = useAnalysis((s) => s.tree);
  const rev = useAnalysis((s) => s.rev);
  const currentId = useAnalysis((s) => s.currentId);
  const promote = useAnalysis((s) => s.promote);
  const remove = useAnalysis((s) => s.remove);
  const [menu, setMenu] = useState<MenuState>();
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the current move visible by scrolling the list itself; scrollIntoView would also
  // scroll the page, which on phones yanks the board out of view.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[data-id="${currentId}"]`);
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 6;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 6;
  }, [currentId, rev]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const onMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, id });
  };

  const main = tree.mainline();
  const cells: ReactNode[] = [];
  if (tree.root.comments?.length)
    cells.push(
      <div key="intro" className="interrupt">
        <Comments node={tree.root} />
      </div>,
    );
  let needsIndex = true;
  for (let i = 1; i < main.length; i++) {
    const node = main[i]!;
    const parent = main[i - 1]!;
    const white = moverOf(node) === 'white';
    if (white || needsIndex) {
      cells.push(
        <span key={`${node.id}i`} className="mv-index">
          {moveNumberOf(node)}
        </span>,
      );
      if (!white)
        cells.push(
          <span key={`${node.id}e`} className="mv-empty">
            …
          </span>,
        );
    }
    cells.push(<Move key={node.id} node={node} numbered={false} onMenu={onMenu} />);
    const variations = parent.children.slice(1);
    const interrupted = variations.length > 0 || !!node.comments?.length;
    needsIndex = false;
    if (interrupted) {
      if (white) cells.push(<span key={`${node.id}f`} className="mv-empty" />);
      cells.push(
        <div key={`${node.id}x`} className="interrupt">
          <Comments node={node} />
          {variations.map((v) => (
            <div key={v.id} className="variation">
              <Move node={v} numbered onMenu={onMenu} />
              <Comments node={v} />
              {inline(v, !!v.comments?.length, onMenu)}
            </div>
          ))}
        </div>,
      );
      needsIndex = true;
    }
  }
  const result = tree.headers.get('Result');

  return (
    <section className="panel moves" aria-label="Moves">
      <div className="moves-scroll" ref={scroller}>
        {main.length < 2 ? (
          <p className="moves-empty">Make a move on the board, or import a game to start.</p>
        ) : (
          <div className="move-grid">{cells}</div>
        )}
        {result && result !== '*' && main.length > 1 && (
          <p className="result">{result.replace('1/2', '½')}</p>
        )}
      </div>
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!tree.isMainline(menu.id) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => (promote(menu.id), setMenu(undefined))}
            >
              Promote to main line
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => (remove(menu.id), setMenu(undefined))}
          >
            Delete from here
          </button>
        </div>
      )}
    </section>
  );
}

export function OpeningLine() {
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  useAnalysis((s) => s.rev);
  const [ready, setReady] = useState(openingsReady());
  useEffect(() => {
    if (!ready) void loadOpenings().then(() => setReady(true));
  }, [ready]);
  const opening = ready ? openingOfLine(tree.path(currentId)) : undefined;
  if (!opening) return null;
  return (
    <p className="opening-line" title="Opening names from the Lichess openings database">
      <span className="eco">{opening.eco}</span> {opening.name}
    </p>
  );
}
