/** Fetches a player's recent games from Lichess or Chess.com (public APIs, no login). */

export interface RemoteGame {
  id: string;
  site: 'lichess' | 'chesscom';
  url: string;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  result: '1-0' | '0-1' | '½-½' | '*';
  speed: string;
  date: Date;
  opening?: string;
  pgn: string;
}

export class ImportError extends Error {}

const cleanName = (u: string) => u.trim().replace(/^@/, '');

async function get(url: string, accept: string): Promise<Response> {
  let lastError: unknown;
  // Chess.com occasionally drops CORS headers on the first request; one retry fixes it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, { headers: { Accept: accept } });
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw new ImportError(
    `Could not reach ${new URL(url).host}. Check your connection. (${String(lastError)})`,
  );
}

interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  createdAt: number;
  winner?: 'white' | 'black';
  status: string;
  players: Record<
    'white' | 'black',
    { user?: { name: string }; rating?: number; aiLevel?: number }
  >;
  opening?: { name: string };
  pgn: string;
}

export async function lichessGames(username: string, max = 20): Promise<RemoteGame[]> {
  const user = cleanName(username);
  if (!/^[\w-]{2,30}$/.test(user))
    throw new ImportError('That does not look like a Lichess username.');
  const res = await get(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&clocks=true&opening=true`,
    'application/x-ndjson',
  );
  if (res.status === 404) throw new ImportError(`No Lichess player is called “${user}”.`);
  if (res.status === 429)
    throw new ImportError('Lichess is rate-limiting requests. Try again in a minute.');
  if (!res.ok) throw new ImportError(`Lichess answered with an error (${res.status}).`);
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LichessGame)
    .filter((g) => g.variant === 'standard' || g.variant === 'fromPosition')
    .map((g) => ({
      id: g.id,
      site: 'lichess' as const,
      url: `https://lichess.org/${g.id}`,
      white:
        g.players.white.user?.name ??
        (g.players.white.aiLevel ? `Stockfish level ${g.players.white.aiLevel}` : 'Anonymous'),
      black:
        g.players.black.user?.name ??
        (g.players.black.aiLevel ? `Stockfish level ${g.players.black.aiLevel}` : 'Anonymous'),
      whiteRating: g.players.white.rating,
      blackRating: g.players.black.rating,
      result:
        g.winner === 'white'
          ? '1-0'
          : g.winner === 'black'
            ? '0-1'
            : ['draw', 'stalemate'].includes(g.status)
              ? '½-½'
              : '*',
      speed: g.speed,
      date: new Date(g.createdAt),
      opening: g.opening?.name,
      pgn: g.pgn,
    }));
}

/** Accepts a Lichess game URL or ID and returns its PGN. */
export async function lichessGamePgn(input: string): Promise<string> {
  const m = /(?:lichess\.org\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/|$|\?|#)/.exec(
    input.trim() + '/',
  );
  if (!m) throw new ImportError('Paste a Lichess game link, e.g. https://lichess.org/abcd1234.');
  const res = await get(
    `https://lichess.org/game/export/${m[1]}?clocks=true&opening=true`,
    'application/x-chess-pgn',
  );
  if (res.status === 404) throw new ImportError('That Lichess game does not exist or is private.');
  if (!res.ok) throw new ImportError(`Lichess answered with an error (${res.status}).`);
  return res.text();
}

interface ChesscomGame {
  url: string;
  pgn?: string;
  time_class: string;
  end_time: number;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  eco?: string;
}

const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

export async function chesscomGames(username: string, max = 20): Promise<RemoteGame[]> {
  const user = cleanName(username).toLowerCase();
  if (!/^[\w-]{2,30}$/.test(user))
    throw new ImportError('That does not look like a Chess.com username.');
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user)}`;
  const res = await get(`${base}/games/archives`, 'application/json');
  if (res.status === 404) throw new ImportError(`No Chess.com player is called “${user}”.`);
  if (!res.ok) throw new ImportError(`Chess.com answered with an error (${res.status}).`);
  const archives = ((await res.json()) as { archives: string[] }).archives.slice(-3).reverse();
  const games: RemoteGame[] = [];
  for (const archive of archives) {
    const r = await get(archive, 'application/json');
    if (!r.ok) continue;
    const month = ((await r.json()) as { games: ChesscomGame[] }).games;
    for (const g of month.reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      const opening = g.eco
        ?.split('/openings/')[1]
        ?.replace(/-/g, ' ')
        .replace(/\.\.\..*$/, '');
      games.push({
        id: g.url.split('/').pop() ?? g.url,
        site: 'chesscom',
        url: g.url,
        white: g.white.username,
        black: g.black.username,
        whiteRating: g.white.rating,
        blackRating: g.black.rating,
        result:
          g.white.result === 'win'
            ? '1-0'
            : g.black.result === 'win'
              ? '0-1'
              : DRAWS.includes(g.white.result)
                ? '½-½'
                : '*',
        speed: g.time_class,
        date: new Date(g.end_time * 1000),
        opening,
        pgn: g.pgn,
      });
      if (games.length >= max) return games;
    }
  }
  return games;
}
