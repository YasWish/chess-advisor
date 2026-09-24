import { create } from 'zustand';
import { playMoveSound, sound } from '../audio/sound';
import { engine, engineLock } from '../engine/stockfish';
import {
  INITIAL_FEN,
  epdOf,
  fenOf,
  positionFromFen,
  playUci,
  positionOutcome,
  resultString,
  type Color,
  type Outcome,
} from '../lib/chess';
import { GameTree } from '../lib/tree';
import { useAnalysis } from '../state/analysis';
import { useUi } from '../state/ui';
import { runReview } from './review';

export interface Level {
  level: number;
  name: string;
  elo: string;
  /** Uses Stockfish's calibrated UCI_Elo when set. */
  uciElo?: number;
  skill?: number;
  depth?: number;
  movetime: number;
  /** Chance of an outright random move, to imitate beginner play. */
  randomness?: number;
}

export const LEVELS: Level[] = [
  { level: 1, name: 'Beginner', elo: '≈600', skill: 0, depth: 1, movetime: 50, randomness: 0.3 },
  { level: 2, name: 'Novice', elo: '≈900', skill: 1, depth: 2, movetime: 100, randomness: 0.12 },
  { level: 3, name: 'Casual', elo: '≈1150', skill: 3, depth: 4, movetime: 150, randomness: 0.04 },
  { level: 4, name: 'Club player', elo: '1400', uciElo: 1400, movetime: 500 },
  { level: 5, name: 'Intermediate', elo: '1700', uciElo: 1700, movetime: 600 },
  { level: 6, name: 'Advanced', elo: '2000', uciElo: 2000, movetime: 800 },
  { level: 7, name: 'Expert', elo: '2300', uciElo: 2300, movetime: 1000 },
  { level: 8, name: 'Master', elo: '2600', uciElo: 2600, movetime: 1200 },
  { level: 9, name: 'Grandmaster', elo: '2900', uciElo: 2900, movetime: 1500 },
  { level: 10, name: 'Full strength', elo: 'max', movetime: 2000 },
];

export interface TimeControl {
  id: string;
  label: string;
  minutes: number;
  increment: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: 'none', label: 'No clock', minutes: 0, increment: 0 },
  { id: '3+2', label: '3 + 2', minutes: 3, increment: 2 },
  { id: '5+3', label: '5 + 3', minutes: 5, increment: 3 },
  { id: '10+5', label: '10 + 5', minutes: 10, increment: 5 },
  { id: '15+10', label: '15 + 10', minutes: 15, increment: 10 },
  { id: '30+0', label: '30 + 0', minutes: 30, increment: 0 },
];

export interface PlayMove {
  uci: string;
  san: string;
  fen: string;
}

interface PlayStore {
  phase: 'setup' | 'playing' | 'over';
  color: Color | 'random';
  playerColor: Color;
  level: number;
  timeControl: string;
  fromCurrent: boolean;
  startFen: string;
  moves: PlayMove[];
  /** Remaining milliseconds; the running side's clock is `clock - (now - turnStart)`. */
  clock: Record<Color, number>;
  turnStart?: number;
  thinking: boolean;
  outcome?: Outcome;
  hint?: string;
  lastEngineCp?: number;
  paused: boolean;
  /** View-only: show the board from the engine's side. */
  flipped: boolean;
  configure(
    patch: Partial<Pick<PlayStore, 'color' | 'level' | 'timeControl' | 'fromCurrent'>>,
  ): void;
}

export const usePlay = create<PlayStore>()((set) => ({
  phase: 'setup',
  color: 'white',
  playerColor: 'white',
  level: 5,
  timeControl: '10+5',
  fromCurrent: false,
  startFen: INITIAL_FEN,
  moves: [],
  clock: { white: 0, black: 0 },
  thinking: false,
  paused: false,
  flipped: false,
  configure: (patch) => set(patch),
}));

export const flipPlayBoard = () => usePlay.setState({ flipped: !usePlay.getState().flipped });

const tc = () =>
  TIME_CONTROLS.find((t) => t.id === usePlay.getState().timeControl) ?? TIME_CONTROLS[0]!;
const timed = () => tc().minutes > 0;
export const playFen = () => {
  const s = usePlay.getState();
  return s.moves.at(-1)?.fen ?? s.startFen;
};
const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

export function remaining(color: Color, now = performance.now()): number {
  const s = usePlay.getState();
  const running =
    s.phase === 'playing' && !s.paused && s.turnStart !== undefined && turnOf(playFen()) === color;
  return Math.max(0, s.clock[color] - (running ? now - s.turnStart! : 0));
}

let flagTimer: number | undefined;
let gameId = 0;

function watchFlags(): void {
  window.clearInterval(flagTimer);
  if (!timed()) return;
  flagTimer = window.setInterval(() => {
    const s = usePlay.getState();
    if (s.phase !== 'playing' || s.paused) return;
    const side = turnOf(playFen());
    if (remaining(side) > 0) return;
    const pos = positionFromFen(playFen());
    const other: Color = side === 'white' ? 'black' : 'white';
    end(
      pos.hasInsufficientMaterial(other)
        ? { termination: 'timeout' }
        : { winner: other, termination: 'timeout' },
    );
  }, 100);
}

function end(outcome: Outcome): void {
  window.clearInterval(flagTimer);
  const s = usePlay.getState();
  const now = performance.now();
  const side = turnOf(playFen());
  const clock = { ...s.clock };
  if (s.turnStart !== undefined && timed()) clock[side] = remaining(side, now);
  usePlay.setState({
    phase: 'over',
    outcome,
    thinking: false,
    turnStart: undefined,
    clock,
    hint: undefined,
  });
  engine.stop();
  engineLock.release('play');
  sound.gameEnd();
}

function repetitions(fen: string): number {
  const s = usePlay.getState();
  const key = epdOf(fen);
  return [s.startFen, ...s.moves.map((m) => m.fen)].filter((f) => epdOf(f) === key).length;
}

/** Applies a move for whichever side is to move, updating clocks. */
function apply(uci: string): boolean {
  const s = usePlay.getState();
  const pos = positionFromFen(playFen());
  const mover = pos.turn;
  const played = playUci(pos, uci);
  if (!played) return false;
  const fen = fenOf(pos);
  const now = performance.now();
  const clock = { ...s.clock };
  if (timed() && s.turnStart !== undefined)
    clock[mover] = remaining(mover, now) + tc().increment * 1000;
  usePlay.setState({
    moves: [...s.moves, { uci: played.uci, san: played.san, fen }],
    clock,
    turnStart: timed() ? now : undefined,
    hint: undefined,
  });
  playMoveSound(played);
  const outcome = positionOutcome(positionFromFen(fen), repetitions(fen));
  if (outcome) end(outcome);
  return true;
}

async function engineTurn(): Promise<void> {
  const s = usePlay.getState();
  if (s.phase !== 'playing' || s.paused || turnOf(playFen()) === s.playerColor) return;
  const id = gameId;
  const level = LEVELS[s.level - 1] ?? LEVELS[4]!;
  usePlay.setState({ thinking: true });
  engineLock.acquire('play');
  const started = performance.now();
  let uci: string | undefined;

  const pos = positionFromFen(playFen());
  if (level.randomness && Math.random() < level.randomness) {
    const options: string[] = [];
    for (const [from, dests] of pos.allDests()) {
      for (const to of dests) {
        const promo = pos.board.getRole(from) === 'pawn' && (to >= 56 || to < 8) ? 'q' : '';
        options.push(sq(from) + sq(to) + promo);
      }
    }
    uci = options[Math.floor(Math.random() * options.length)];
  } else {
    const clocks = timed()
      ? {
          wtime: remaining('white'),
          btime: remaining('black'),
          winc: tc().increment * 1000,
          binc: tc().increment * 1000,
        }
      : { movetime: level.movetime };
    const result = await engine.search({
      fen: s.startFen,
      moves: s.moves.map((m) => m.uci),
      multiPv: 1,
      limits: { ...clocks, ...(level.depth ? { depth: level.depth } : {}) },
      options: level.uciElo
        ? {
            UCI_LimitStrength: true,
            UCI_Elo: level.uciElo,
            'Skill Level': 20,
            UCI_ShowWDL: false,
            Hash: 32,
          }
        : {
            UCI_LimitStrength: false,
            'Skill Level': level.skill ?? 20,
            UCI_ShowWDL: false,
            Hash: 32,
          },
    });
    uci = result.bestmove;
    const cp = result.lines[0]?.score.cp;
    if (cp !== undefined) usePlay.setState({ lastEngineCp: cp });
  }
  // Give instant replies a human pace so the move is noticeable.
  const wait = Math.max(0, 350 - (performance.now() - started));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  if (id !== gameId || usePlay.getState().phase !== 'playing' || usePlay.getState().paused) return;
  usePlay.setState({ thinking: false });
  if (uci) apply(uci);
}

const sq = (n: number) => String.fromCharCode(97 + (n % 8)) + (Math.floor(n / 8) + 1);

export function startGame(): void {
  const s = usePlay.getState();
  const playerColor: Color =
    s.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : s.color;
  let startFen = INITIAL_FEN;
  if (s.fromCurrent) {
    const a = useAnalysis.getState();
    const fen = (a.tree.get(a.currentId) ?? a.tree.root).fen;
    if (!positionFromFen(fen).isEnd()) startFen = fen;
  }
  gameId++;
  const ms = tc().minutes * 60_000;
  usePlay.setState({
    phase: 'playing',
    playerColor,
    startFen,
    moves: [],
    clock: { white: ms, black: ms },
    turnStart: timed() ? performance.now() : undefined,
    thinking: false,
    outcome: undefined,
    hint: undefined,
    lastEngineCp: undefined,
    paused: false,
  });
  engineLock.acquire('play');
  engine.newGame();
  watchFlags();
  void engineTurn();
}

export function playerMove(uci: string): boolean {
  const s = usePlay.getState();
  if (s.phase !== 'playing' || s.thinking || turnOf(playFen()) !== s.playerColor) return false;
  if (!apply(uci)) return false;
  void engineTurn();
  return true;
}

export function resign(): void {
  const s = usePlay.getState();
  if (s.phase === 'playing')
    end({ winner: s.playerColor === 'white' ? 'black' : 'white', termination: 'resignation' });
}

export function offerDraw(): void {
  const s = usePlay.getState();
  if (s.phase !== 'playing') return;
  // The engine accepts when it sees no advantage for itself after the opening.
  const accepts = s.moves.length >= 30 && (s.lastEngineCp ?? 100) <= 15;
  if (accepts) end({ termination: 'agreement' });
  else useUi.getState().toast('Stockfish declines the draw.');
}

export function takeback(): void {
  const s = usePlay.getState();
  if (s.phase !== 'playing' || !s.moves.length) return;
  gameId++;
  engine.stop();
  const mine = turnOf(playFen()) === s.playerColor;
  const drop = s.thinking || !mine ? 1 : 2;
  const moves = s.moves.slice(0, Math.max(0, s.moves.length - drop));
  usePlay.setState({
    moves,
    thinking: false,
    hint: undefined,
    turnStart: timed() ? performance.now() : undefined,
  });
  void engineTurn();
}

export async function hint(): Promise<void> {
  const s = usePlay.getState();
  if (s.phase !== 'playing' || s.thinking || turnOf(playFen()) !== s.playerColor) return;
  const result = await engine.search({
    fen: s.startFen,
    moves: s.moves.map((m) => m.uci),
    multiPv: 1,
    limits: { depth: 14, movetime: 1500 },
    options: { UCI_LimitStrength: false, 'Skill Level': 20 },
  });
  if (usePlay.getState().moves.length === s.moves.length)
    usePlay.setState({ hint: result.bestmove });
}

/** Leaving the Play tab pauses the game (and the clocks); coming back resumes it. */
export function setPaused(paused: boolean): void {
  const s = usePlay.getState();
  if (s.phase !== 'playing' || s.paused === paused) return;
  if (paused) {
    const side = turnOf(playFen());
    const clock = { ...s.clock };
    if (timed()) clock[side] = remaining(side);
    gameId++;
    usePlay.setState({ paused: true, clock, turnStart: undefined, thinking: false });
    engineLock.release('play');
  } else {
    usePlay.setState({ paused: false, turnStart: timed() ? performance.now() : undefined });
    engineLock.acquire('play');
    void engineTurn();
  }
}

export function backToSetup(): void {
  gameId++;
  window.clearInterval(flagTimer);
  engine.stop();
  engineLock.release('play');
  usePlay.setState({
    phase: 'setup',
    moves: [],
    outcome: undefined,
    thinking: false,
    hint: undefined,
  });
}

/** Opens the finished (or current) game on the analysis board and starts a review. */
export function reviewGame(): void {
  const s = usePlay.getState();
  const level = LEVELS[s.level - 1]!;
  const engineName = `Stockfish (${level.name})`;
  const headers = new Map<string, string>([
    ['Event', 'Casual game vs Stockfish'],
    ['Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.')],
    ['White', s.playerColor === 'white' ? 'You' : engineName],
    ['Black', s.playerColor === 'black' ? 'You' : engineName],
    ['Result', resultString(s.outcome)],
  ]);
  const tree = new GameTree(s.startFen, headers);
  let id = tree.root.id;
  for (const m of s.moves) id = tree.addMove(id, m.uci)?.node.id ?? id;
  if (s.phase === 'playing') backToSetup();
  useAnalysis.getState().load(tree, { orientation: s.playerColor, at: 'end' });
  useUi.getState().setMode('analysis');
  void runReview();
}
