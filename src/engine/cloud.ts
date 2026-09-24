import { epdOf } from '../lib/chess';
import type { PositionEval, PvLine } from '../lib/eval';

interface CloudResponse {
  depth: number;
  knodes: number;
  pvs: Array<{ moves: string; cp?: number; mate?: number }>;
}

const misses = new Set<string>();
let pausedUntil = 0;

/**
 * Looks a position up in the Lichess cloud evaluation database (millions of positions,
 * mostly openings, analysed deeply). Returns undefined when the position is unknown,
 * when Lichess is rate-limiting us, or when the network is unavailable; the local engine
 * covers every one of those cases. Scores are from White's point of view.
 */
export async function fetchCloudEval(
  fen: string,
  multiPv: number,
  signal?: AbortSignal,
): Promise<PositionEval | undefined> {
  const key = `${epdOf(fen)}|${multiPv}`;
  if (misses.has(key) || Date.now() < pausedUntil) return undefined;
  try {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) {
      misses.add(key);
      return undefined;
    }
    if (res.status === 429) {
      pausedUntil = Date.now() + 60_000;
      return undefined;
    }
    if (!res.ok) return undefined;
    const data = (await res.json()) as CloudResponse;
    const lines: PvLine[] = data.pvs
      .filter((pv) => pv.moves)
      .map((pv, i) => ({
        multipv: i + 1,
        score: pv.mate !== undefined ? { mate: pv.mate } : { cp: pv.cp ?? 0 },
        moves: pv.moves.split(' '),
      }));
    if (!lines.length) return undefined;
    return {
      epd: epdOf(fen),
      depth: data.depth,
      lines,
      nodes: data.knodes * 1000,
      source: 'cloud',
      done: true,
    };
  } catch {
    return undefined;
  }
}
