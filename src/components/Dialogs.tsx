import { Code, Copy, Download, ExternalLink, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  copyText,
  downloadFile,
  gameLink,
  loadText,
  positionLink,
} from '../controllers/persistence';
import { engine } from '../engine/stockfish';
import { exportPgn } from '../lib/pgn';
import { chesscomGames, lichessGamePgn, lichessGames, type RemoteGame } from '../services/games';
import { useAnalysis } from '../state/analysis';
import {
  BOARD_THEMES,
  PIECE_SETS,
  useSettings,
  type BoardTheme,
  type PieceSet,
} from '../state/settings';
import { useUi } from '../state/ui';
import { Button, Kbd, Modal, Segmented, Switch } from './ui';

const REPO = 'https://github.com/YasWish/chess-advisor';

type ImportTab = 'paste' | 'lichess' | 'chesscom';

function GameRow({ game, onPick }: { game: RemoteGame; onPick: (g: RemoteGame) => void }) {
  return (
    <li>
      <button type="button" className="game-row" onClick={() => onPick(game)}>
        <span className="game-players">
          <span>
            {game.white}
            {game.whiteRating ? <small> {game.whiteRating}</small> : null}
          </span>
          <span className="game-vs">vs</span>
          <span>
            {game.black}
            {game.blackRating ? <small> {game.blackRating}</small> : null}
          </span>
        </span>
        <span className="game-result">{game.result}</span>
        <span className="game-meta">
          {game.speed} · {game.date.toLocaleDateString()}
          {game.opening ? ` · ${game.opening}` : ''}
        </span>
      </button>
    </li>
  );
}

function ImportDialog() {
  const close = useUi((s) => s.close);
  const toast = useUi((s) => s.toast);
  const [tab, setTab] = useState<ImportTab>('paste');
  const [text, setText] = useState('');
  const [user, setUser] = useState('');
  const [games, setGames] = useState<RemoteGame[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const finish = (pgn: string) => {
    const err = loadText(pgn);
    if (err) return setError(err);
    close();
    useUi.getState().setMode('analysis');
    toast('Loaded. Use the arrow keys to step through the moves.', 'success');
  };

  const pasteSubmit = async () => {
    setError(undefined);
    const t = text.trim();
    if (/lichess\.org\/[a-zA-Z0-9]{8}/.test(t)) {
      setBusy(true);
      try {
        finish(await lichessGamePgn(t));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (/chess\.com\/(game|analysis)/.test(t)) {
      setError(
        'Chess.com game links cannot be fetched directly. Use the Chess.com tab to pick the game from the player’s recent games, or paste its PGN.',
      );
      return;
    }
    finish(t);
  };

  const fetchGames = async () => {
    setError(undefined);
    setGames(undefined);
    setBusy(true);
    try {
      const list = tab === 'lichess' ? await lichessGames(user) : await chesscomGames(user);
      setGames(list);
      if (!list.length) setError('No standard games found for this player recently.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File) => {
    if (file.size > 5_000_000) return setError('That file is too large (limit 5 MB).');
    setText(await file.text());
  };

  return (
    <Modal open onClose={close} title="Import a game or position" wide>
      <Segmented
        label="Import source"
        value={tab}
        onChange={(v) => (setTab(v), setError(undefined), setGames(undefined))}
        options={[
          { value: 'paste', label: 'PGN, FEN or link' },
          { value: 'lichess', label: 'Lichess player' },
          { value: 'chesscom', label: 'Chess.com player' },
        ]}
      />
      {tab === 'paste' ? (
        <form
          className="import-form"
          onSubmit={(e) => {
            e.preventDefault();
            void pasteSubmit();
          }}
        >
          <textarea
            className="input mono"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              '[Event "…"]\n1. e4 e5 2. Nf3 Nc6 …\n\nor a FEN such as\nrnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\n\nor a Lichess game link'
            }
            spellCheck={false}
            autoFocus
            aria-label="PGN, FEN or Lichess link"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
          />
          <div className="form-row">
            <label className="file-pick">
              <input
                type="file"
                accept=".pgn,.txt,application/x-chess-pgn,text/plain"
                onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
              />
              Open a .pgn file
            </label>
            <Button tone="primary" type="submit" disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="spin" size={16} /> : null}
              Load
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="import-form"
          onSubmit={(e) => {
            e.preventDefault();
            void fetchGames();
          }}
        >
          <div className="form-row">
            <input
              className="input"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={tab === 'lichess' ? 'Lichess username' : 'Chess.com username'}
              aria-label="Username"
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
            />
            <Button tone="primary" type="submit" disabled={busy || !user.trim()}>
              {busy ? <Loader2 className="spin" size={16} /> : null}
              Find games
            </Button>
          </div>
          {games && games.length > 0 && (
            <ul className="game-list">
              {games.map((g) => (
                <GameRow key={g.id} game={g} onPick={(game) => finish(game.pgn)} />
              ))}
            </ul>
          )}
          <p className="fineprint">
            Uses the public {tab === 'lichess' ? 'Lichess' : 'Chess.com'} API directly from your
            browser. Nothing is sent anywhere else.
          </p>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function ShareDialog() {
  const close = useUi((s) => s.close);
  const tree = useAnalysis((s) => s.tree);
  const currentId = useAnalysis((s) => s.currentId);
  const orientation = useAnalysis((s) => s.orientation);
  const reviewed = useAnalysis((s) => !!s.review);
  const [variations, setVariations] = useState(true);
  const [comments, setComments] = useState(true);
  const [annotations, setAnnotations] = useState(reviewed);
  const node = tree.get(currentId) ?? tree.root;
  const pgn = useMemo(
    () => exportPgn(tree, { variations, comments, annotations, clocks: true }),
    [tree, variations, comments, annotations],
  );
  const flip = orientation === 'black';
  const lichessUrl = `https://lichess.org/analysis/${node.fen.replace(/ /g, '_')}${flip ? '?color=black' : ''}`;
  const name = `${(tree.headers.get('White') ?? 'white').replace(/\W+/g, '_')}-vs-${(tree.headers.get('Black') ?? 'black').replace(/\W+/g, '_')}.pgn`;
  return (
    <Modal open onClose={close} title="Share and export" wide>
      <div className="share-block">
        <label className="field-label" htmlFor="share-fen">
          Position (FEN)
        </label>
        <div className="form-row">
          <input
            id="share-fen"
            className="input mono"
            readOnly
            value={node.fen}
            onFocus={(e) => e.target.select()}
          />
          <Button
            icon={<Copy size={16} />}
            label="Copy FEN"
            onClick={() => void copyText(node.fen, 'FEN')}
          />
        </div>
        <div className="share-links">
          <Button
            icon={<Copy size={16} />}
            onClick={() => void copyText(positionLink(node.fen, flip), 'Position link')}
          >
            Copy link to this position
          </Button>
          <Button
            icon={<Copy size={16} />}
            onClick={() => void copyText(gameLink(tree, flip), 'Game link')}
          >
            Copy link to the game
          </Button>
          <a className="btn btn-quiet" href={lichessUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open in Lichess
          </a>
        </div>
      </div>
      <div className="share-block">
        <span className="field-label">PGN</span>
        <div className="share-options">
          <label>
            <input
              type="checkbox"
              checked={variations}
              onChange={(e) => setVariations(e.target.checked)}
            />{' '}
            Variations
          </label>
          <label>
            <input
              type="checkbox"
              checked={comments}
              onChange={(e) => setComments(e.target.checked)}
            />{' '}
            Comments
          </label>
          <label title={reviewed ? '' : 'Run a game review first'}>
            <input
              type="checkbox"
              checked={annotations}
              disabled={!reviewed}
              onChange={(e) => setAnnotations(e.target.checked)}
            />{' '}
            Engine evaluations and move grades
          </label>
        </div>
        <textarea
          className="input mono"
          rows={8}
          readOnly
          value={pgn}
          aria-label="PGN"
          onFocus={(e) => e.target.select()}
        />
        <div className="form-row end">
          <Button icon={<Copy size={16} />} onClick={() => void copyText(pgn, 'PGN')}>
            Copy PGN
          </Button>
          <Button
            tone="primary"
            icon={<Download size={16} />}
            onClick={() => downloadFile(name, pgn)}
          >
            Download .pgn
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const close = useUi((s) => s.close);
  const s = useSettings();
  return (
    <Modal open onClose={close} title="Settings" wide>
      <div className="settings">
        <section>
          <h3>Appearance</h3>
          <div className="field">
            <span className="field-label">Theme</span>
            <Segmented
              label="Theme"
              value={s.theme}
              onChange={(theme) => s.update({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Board</span>
            <div className="swatches" role="radiogroup" aria-label="Board colours">
              {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((key) => {
                const t = BOARD_THEMES[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={s.boardTheme === key}
                    title={t.name}
                    className={`swatch ${s.boardTheme === key ? 'on' : ''}`}
                    onClick={() => s.update({ boardTheme: key })}
                    style={{
                      background: `conic-gradient(${t.dark} 0 25%, ${t.light} 0 50%, ${t.dark} 0 75%, ${t.light} 0)`,
                    }}
                  >
                    <span className="sr-only">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Pieces</span>
            <div className="piece-sets" role="radiogroup" aria-label="Piece set">
              {(Object.keys(PIECE_SETS) as PieceSet[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={s.pieceSet === key}
                  className={`piece-set ${s.pieceSet === key ? 'on' : ''}`}
                  onClick={() => s.update({ pieceSet: key })}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}pieces/${key}/wN.svg`}
                    alt=""
                    width={36}
                    height={36}
                  />
                  <span>{PIECE_SETS[key]}</span>
                </button>
              ))}
            </div>
          </div>
          <Switch
            label="Coordinates"
            checked={s.coordinates}
            onChange={(coordinates) => s.update({ coordinates })}
          />
          <Switch
            label="Piece animation"
            checked={s.animation}
            onChange={(animation) => s.update({ animation })}
          />
          <Switch
            label="Show legal moves"
            checked={s.showDests}
            onChange={(showDests) => s.update({ showDests })}
          />
          <Switch
            label="Figurine notation"
            hint="Draw piece letters as small pieces: ♘f3 instead of Nf3"
            checked={s.figurines}
            onChange={(figurines) => s.update({ figurines })}
          />
        </section>
        <section>
          <h3>Engine</h3>
          <div className="field">
            <span className="field-label">Lines shown</span>
            <Segmented
              label="Lines"
              value={s.multiPv}
              onChange={(multiPv) => s.update({ multiPv })}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
            />
          </div>
          <div className="field">
            <span className="field-label">Hash memory</span>
            <Segmented
              label="Hash memory"
              value={s.hashMb}
              onChange={(hashMb) => s.update({ hashMb })}
              options={[16, 32, 64, 128, 256].map((n) => ({ value: n, label: `${n} MB` }))}
            />
          </div>
          <Switch
            label="Best-move arrows"
            checked={s.arrows}
            onChange={(arrows) => s.update({ arrows })}
          />
          <Switch
            label="Lichess cloud evaluations"
            hint="Instant deep evaluations for known positions. Sends the position (FEN) to lichess.org."
            checked={s.cloudEval}
            onChange={(cloudEval) => s.update({ cloudEval })}
          />
          <p className="fineprint">Running: {engine.name}, single-threaded WebAssembly build.</p>
          <h3>Sound</h3>
          <Switch label="Move sounds" checked={s.sound} onChange={(sound) => s.update({ sound })} />
          <div className="field">
            <label className="field-label" htmlFor="volume">
              Volume
            </label>
            <input
              id="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              disabled={!s.sound}
              onChange={(e) => s.update({ volume: Number(e.target.value) })}
            />
          </div>
          <Switch
            label="Speak the best move"
            hint="Reads the move aloud when you press Best move"
            checked={s.voice}
            onChange={(voice) => s.update({ voice })}
          />
          <Button tone="quiet" onClick={s.reset}>
            Restore defaults
          </Button>
        </section>
      </div>
    </Modal>
  );
}

const SHORTCUTS: Array<[string[], string]> = [
  [['←', '→'], 'Previous / next move'],
  [['Home', 'End'], 'Start / end of the line'],
  [['↑', '↓'], 'Start / end of the line'],
  [['Space'], 'Play the engine’s best move'],
  [['L'], 'Engine on / off'],
  [['X'], 'Show the opponent’s threat'],
  [['F'], 'Flip the board'],
  [['R'], 'Review the game'],
  [['I'], 'Import'],
  [['S'], 'Share and export'],
  [['?'], 'This help'],
];

function HelpDialog() {
  const close = useUi((s) => s.close);
  return (
    <Modal open onClose={close} title="Help" wide>
      <div className="help">
        <section>
          <h3>Keyboard</h3>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what + keys.join()}>
                <dt>
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <h3>Board</h3>
          <p>
            Drag or click pieces to move. Right-click and drag to draw arrows; shift or ctrl changes
            their colour. Right-click a move in the list to promote or delete a variation.
          </p>
        </section>
        <section>
          <h3>About</h3>
          <p>
            Chess Advisor {__APP_VERSION__} runs {engine.name} in your browser as WebAssembly, so
            analysis works offline and your games stay on your device. Optional online features
            (cloud evaluations, tablebases, game import) talk to the public Lichess and Chess.com
            APIs.
          </p>
          <p>
            Free software under the GNU General Public License v3 or later. Built on Stockfish,
            chessground and chessops (GPL-3.0), with piece sets from the Lichess project and opening
            names from the Lichess chess-openings database (CC0).
          </p>
          <p className="about-links">
            <a className="btn btn-quiet" href={REPO} target="_blank" rel="noreferrer">
              <Code size={16} /> Source code
            </a>
            <a className="btn btn-quiet" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
              Report a problem
            </a>
          </p>
        </section>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (dialog === 'import') return <ImportDialog />;
  if (dialog === 'share') return <ShareDialog />;
  if (dialog === 'settings') return <SettingsDialog />;
  if (dialog === 'help') return <HelpDialog />;
  return null;
}
