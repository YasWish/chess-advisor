import { parseBestMove, parseInfo, type UciInfo } from '../lib/uci';

export type EngineState = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchLimits {
  depth?: number;
  movetime?: number;
  nodes?: number;
  infinite?: boolean;
  wtime?: number;
  btime?: number;
  winc?: number;
  binc?: number;
  searchmoves?: string[];
}

export interface SearchRequest {
  /** Root position; `moves` are played from it so the engine can see repetitions. */
  fen: string;
  moves?: string[];
  multiPv?: number;
  limits: SearchLimits;
  options?: Record<string, string | number | boolean>;
  onInfo?: (info: UciInfo) => void;
}

export interface SearchResult {
  bestmove?: string;
  ponder?: string;
  /** Latest info per MultiPV line, best first. */
  lines: UciInfo[];
  /** The search ended because it was stopped or replaced, not because it hit its limit. */
  interrupted: boolean;
  error?: string;
}

interface Job extends SearchRequest {
  resolve: (r: SearchResult) => void;
  lines: Map<number, UciInfo>;
  started: boolean;
  stopRequested: boolean;
}

const ENGINE_FILE = 'engine/stockfish-19-lite-single.js';

function limitsToGo(l: SearchLimits): string {
  if (l.infinite) return 'go infinite';
  const parts = ['go'];
  for (const key of ['depth', 'movetime', 'nodes', 'wtime', 'btime', 'winc', 'binc'] as const) {
    const v = l[key];
    if (v !== undefined) parts.push(key, String(Math.max(0, Math.round(v))));
  }
  if (l.searchmoves?.length) parts.push('searchmoves', ...l.searchmoves);
  return parts.join(' ');
}

/**
 * A single Stockfish instance running in a Web Worker.
 *
 * Only one search runs at a time. Starting a new search stops the current one and waits
 * for its `bestmove` before sending the next `position`/`go`, so output from an old search
 * can never be attributed to a new position.
 */
export class StockfishEngine {
  state: EngineState = 'idle';
  name = 'Stockfish 19';
  error?: string;
  loadProgress = 0;

  private worker?: Worker;
  private starting?: Promise<void>;
  private current?: Job;
  private queued?: Job;
  private applied = new Map<string, string>();
  private stateListeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(state: EngineState, error?: string): void {
    this.state = state;
    this.error = error;
    for (const fn of this.stateListeners) fn();
  }

  /** Starts the worker once. Safe to call repeatedly; retries after a failure. */
  init(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const fail = (message: string) => {
        this.worker?.terminate();
        this.worker = undefined;
        this.starting = undefined;
        this.setState('error', message);
        reject(new Error(message));
      };
      if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') {
        fail('This browser cannot run WebAssembly workers, which the engine needs.');
        return;
      }
      this.setState('loading');
      let worker: Worker;
      try {
        worker = new Worker(`${import.meta.env.BASE_URL}${ENGINE_FILE}`);
      } catch {
        fail('The engine could not be started.');
        return;
      }
      const timeout = window.setTimeout(
        () => fail('The engine did not start within 30 seconds.'),
        30_000,
      );
      worker.onmessage = (e: MessageEvent) => {
        const data: unknown = e.data;
        if (data && typeof data === 'object' && 'percent' in data) {
          this.loadProgress = Number((data as { percent: number }).percent) || 0;
          for (const fn of this.stateListeners) fn();
          return;
        }
        if (typeof data !== 'string') return;
        for (const line of data.split('\n')) {
          if (line.startsWith('id name '))
            this.name = line
              .slice(8)
              .replace(/\s+WASM$/i, '')
              .trim();
          else if (line === 'uciok') {
            window.clearTimeout(timeout);
            this.setState('ready');
            resolve();
          } else this.onLine(line);
        }
      };
      worker.onerror = (e) => {
        window.clearTimeout(timeout);
        e.preventDefault();
        fail(e.message ? `The engine crashed: ${e.message}` : 'The engine crashed.');
        this.current?.resolve({ lines: [], interrupted: true, error: 'The engine crashed.' });
        this.current = undefined;
      };
      this.worker = worker;
      worker.postMessage('setoption name CanOutputEngineDownloadProgress');
      worker.postMessage('uci');
    });
    return this.starting;
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  get busy(): boolean {
    return this.current !== undefined;
  }

  /** Runs a search. Any queued search is dropped and any running search is stopped first. */
  search(req: SearchRequest): Promise<SearchResult> {
    return new Promise((resolve) => {
      const job: Job = { ...req, resolve, lines: new Map(), started: false, stopRequested: false };
      this.queued?.resolve({ lines: [], interrupted: true });
      this.queued = job;
      if (this.current) this.stopCurrent();
      else void this.launch();
    });
  }

  /** Stops the running search (its promise resolves with what it found) and drops queued work. */
  stop(): void {
    this.queued?.resolve({ lines: [], interrupted: true });
    this.queued = undefined;
    this.stopCurrent();
  }

  private stopCurrent(): void {
    const job = this.current;
    if (!job || job.stopRequested) return;
    job.stopRequested = true;
    if (job.started) this.send('stop');
  }

  private async launch(): Promise<void> {
    const job = this.queued;
    if (!job || this.current) return;
    this.queued = undefined;
    this.current = job;
    try {
      await this.init();
    } catch (err) {
      this.current = undefined;
      job.resolve({ lines: [], interrupted: true, error: (err as Error).message });
      return;
    }
    if (job.stopRequested) {
      this.current = undefined;
      job.resolve({ lines: [], interrupted: true });
      void this.launch();
      return;
    }
    const options: Record<string, string | number | boolean> = {
      MultiPV: job.multiPv ?? 1,
      ...job.options,
    };
    for (const [name, value] of Object.entries(options)) {
      const v = String(value);
      if (this.applied.get(name) !== v) {
        this.send(`setoption name ${name} value ${v}`);
        this.applied.set(name, v);
      }
    }
    const moves = job.moves?.length ? ` moves ${job.moves.join(' ')}` : '';
    this.send(`position fen ${job.fen}${moves}`);
    this.send(limitsToGo(job.limits));
    job.started = true;
  }

  private onLine(line: string): void {
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (!info || info.bound) return;
      job.lines.set(info.multipv, info);
      job.onInfo?.(info);
      return;
    }
    const best = parseBestMove(line);
    if (!best) return;
    this.current = undefined;
    job.resolve({
      ...best,
      lines: [...job.lines.values()].sort((a, b) => a.multipv - b.multipv),
      interrupted: job.stopRequested,
    });
    void this.launch();
  }

  /** Forget hash tables between unrelated games. */
  newGame(): void {
    if (this.state === 'ready' && !this.current) this.send('ucinewgame');
  }
}

export const engine = new StockfishEngine();

export type EngineOwner = 'analysis' | 'review' | 'play' | 'practice';

/**
 * One engine, several features. Whoever holds the lock may search; analysis gets it back
 * whenever another feature releases it.
 */
class EngineLock {
  owner: EngineOwner = 'analysis';
  private listeners = new Set<(owner: EngineOwner) => void>();

  acquire(owner: EngineOwner): void {
    if (this.owner === owner) return;
    engine.stop();
    this.owner = owner;
    for (const fn of this.listeners) fn(owner);
  }

  release(owner: EngineOwner): void {
    if (this.owner !== owner) return;
    engine.stop();
    this.owner = 'analysis';
    for (const fn of this.listeners) fn(this.owner);
  }

  subscribe(fn: (owner: EngineOwner) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const engineLock = new EngineLock();
