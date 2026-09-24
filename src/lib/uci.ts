/** A parsed `info` line that carries a principal variation. Scores are from the side to move. */
export interface UciInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: { cp?: number; mate?: number };
  bound?: 'lower' | 'upper';
  wdl?: [number, number, number];
  nodes?: number;
  nps?: number;
  time?: number;
  pv: string[];
}

const NUMERIC = new Set([
  'depth',
  'seldepth',
  'multipv',
  'nodes',
  'nps',
  'time',
  'hashfull',
  'tbhits',
]);

/** Parses `info depth 20 seldepth 28 multipv 1 score cp 35 wdl 50 900 50 nodes … pv e2e4 e7e5`. */
export function parseInfo(line: string): UciInfo | undefined {
  if (!line.startsWith('info ')) return undefined;
  const t = line.split(/\s+/);
  const out: Partial<UciInfo> & { multipv: number } = { multipv: 1 };
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    const key = t[i]!;
    if (key === 'string') return undefined;
    if (key === 'pv') {
      out.pv = t.slice(i + 1).filter(Boolean);
      break;
    }
    if (key === 'score') {
      const kind = t[i + 1];
      const value = Number(t[i + 2]);
      if ((kind === 'cp' || kind === 'mate') && Number.isFinite(value)) {
        out.score = kind === 'cp' ? { cp: value } : { mate: value };
        hasScore = true;
      }
      i += 2;
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
        out.bound = t[i + 1] === 'lowerbound' ? 'lower' : 'upper';
        i++;
      }
      continue;
    }
    if (key === 'wdl') {
      const w = Number(t[i + 1]);
      const d = Number(t[i + 2]);
      const l = Number(t[i + 3]);
      if ([w, d, l].every(Number.isFinite)) out.wdl = [w, d, l];
      i += 3;
      continue;
    }
    if (NUMERIC.has(key)) {
      const value = Number(t[i + 1]);
      if (Number.isFinite(value)) (out as unknown as Record<string, number>)[key] = value;
      i++;
    }
  }
  if (!hasScore || out.depth === undefined || !out.pv?.length) return undefined;
  return out as UciInfo;
}

export function parseBestMove(line: string): { bestmove?: string; ponder?: string } | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const [, best, , ponder] = line.split(/\s+/);
  return {
    bestmove: best && best !== '(none)' ? best : undefined,
    ponder: ponder || undefined,
  };
}

export interface UciOption {
  name: string;
  type: string;
  default?: string;
  min?: number;
  max?: number;
}

/** Parses `option name Hash type spin default 16 min 1 max 33554432`. */
export function parseOption(line: string): UciOption | undefined {
  const m =
    /^option name (.+?) type (\w+)(?: default (.*?))?(?: min (-?\d+))?(?: max (-?\d+))?$/.exec(
      line.trim(),
    );
  if (!m) return undefined;
  return {
    name: m[1]!,
    type: m[2]!,
    default: m[3],
    min: m[4] !== undefined ? Number(m[4]) : undefined,
    max: m[5] !== undefined ? Number(m[5]) : undefined,
  };
}
