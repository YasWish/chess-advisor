import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainBestMove, describeThreat, positionInsights } from '../src/lib/insights';
import { bookMoves, lookupOpening, setOpeningsDb } from '../src/lib/openings';
import { completeFen, exportPgn, importPgn, looksLikeFen } from '../src/lib/pgn';
import {
  averageCpLoss,
  classifyPly,
  gameAccuracy,
  isSacrifice,
  moveAccuracy,
} from '../src/lib/review';
import { findPins, forkTargets, hangingPieces, weakBackRank } from '../src/lib/tactics';
import { positionFromFen } from '../src/lib/chess';

const SAMPLE = `[Event "Casual"]
[White "Anderssen"]
[Black "Kieseritzky"]
[Result "1-0"]

1. e4 { King's pawn [%clk 0:05:00] } e5 2. f4 (2. Nf3 Nc6 3. Bb5) 2... exf4 3. Bc4 $1 Qh4+ 4. Kf1 1-0`;

describe('PGN', () => {
  it('imports variations, comments, NAGs and clocks', () => {
    const { games, errors } = importPgn(SAMPLE);
    expect(errors).toEqual([]);
    const tree = games[0]!;
    const main = tree.mainline();
    expect(main.map((n) => n.san).slice(1)).toEqual([
      'e4',
      'e5',
      'f4',
      'exf4',
      'Bc4',
      'Qh4+',
      'Kf1',
    ]);
    expect(main[1]!.comments).toEqual(["King's pawn"]);
    expect(main[1]!.clock).toBe(300);
    expect(main[5]!.nags).toEqual([1]);
    expect(main[2]!.children.map((c) => c.san)).toEqual(['f4', 'Nf3']);
    expect(tree.headers.get('White')).toBe('Anderssen');
  });

  it('round-trips through export', () => {
    const tree = importPgn(SAMPLE).games[0]!;
    const pgn = exportPgn(tree);
    expect(pgn).toContain('(2. Nf3 Nc6 3. Bb5)');
    expect(pgn).toContain('[%clk 0:05:00]');
    const again = importPgn(pgn).games[0]!;
    expect(again.mainline().map((n) => n.uci)).toEqual(tree.mainline().map((n) => n.uci));
  });

  it('keeps a custom starting position', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const tree = importPgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 Kd7 *`).games[0]!;
    expect(tree.root.fen).toBe(fen);
    expect(exportPgn(tree)).toContain(`[FEN "${fen}"]`);
  });

  it('reports illegal moves instead of failing silently', () => {
    const { errors } = importPgn('1. e4 e5 2. Ke3 *');
    expect(errors[0]).toMatch(/illegal move \(Ke3\)/);
  });

  it('recognises and completes bare FENs', () => {
    expect(looksLikeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(true);
    expect(looksLikeFen('1. e4 e5')).toBe(false);
    expect(completeFen('8/8/8/8/8/8/8/K6k b')).toBe('8/8/8/8/8/8/8/K6k b - - 0 1');
  });
});

describe('openings', () => {
  setOpeningsDb(
    JSON.parse(readFileSync(new URL('../src/data/openings.json', import.meta.url), 'utf8')),
  );

  it('names positions, including transpositions', () => {
    const ruyLopez = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    expect(lookupOpening(ruyLopez)).toMatchObject({ eco: 'C60' });
    expect(lookupOpening(ruyLopez)?.name).toMatch(/Ruy Lopez/);
  });

  it('lists book continuations', () => {
    const moves = bookMoves('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(moves.length).toBeGreaterThan(15);
    expect(moves.find((m) => m.san === 'e4')?.opening.name).toMatch(/King's Pawn/);
  });
});

describe('review', () => {
  it('computes Lichess move accuracy', () => {
    expect(moveAccuracy(50, 55)).toBe(100);
    // 103.1668·e^(−0.04354·20) − 3.1669 + 1 (uncertainty bonus)
    expect(moveAccuracy(60, 40)).toBeCloseTo(41.0, 1);
  });

  it('classifies moves by winning chances lost', () => {
    const base = {
      color: 'white' as const,
      played: 'e2e4',
      legalMoves: 20,
      isBook: false,
      isSacrifice: false,
    };
    expect(classifyPly({ ...base, before: { cp: 30 }, after: { cp: 25 }, best: 'e2e4' }).cls).toBe(
      'best',
    );
    expect(classifyPly({ ...base, before: { cp: 30 }, after: { cp: -60 }, best: 'd2d4' }).cls).toBe(
      'inaccuracy',
    );
    expect(
      classifyPly({ ...base, before: { cp: 30 }, after: { cp: -400 }, best: 'd2d4' }).cls,
    ).toBe('blunder');
    expect(
      classifyPly({
        ...base,
        before: { cp: 30 },
        after: { cp: 25 },
        best: 'e2e4',
        secondBest: { cp: -250 },
      }).cls,
    ).toBe('great');
    expect(
      classifyPly({ ...base, legalMoves: 1, before: { cp: 0 }, after: { cp: -500 } }).cls,
    ).toBe('forced');
  });

  it('flags a missed chance after an opponent error', () => {
    const v = classifyPly({
      color: 'black',
      played: 'a7a6',
      best: 'd8h4',
      before: { cp: -500 },
      after: { cp: 0 },
      legalMoves: 30,
      isBook: false,
      isSacrifice: false,
      previousOpponentClass: 'blunder',
    });
    expect(v.cls).toBe('miss');
  });

  it('gives near-perfect accuracy to flawless play and less to blunders', () => {
    const flat = Array.from({ length: 21 }, () => 52);
    const clean = gameAccuracy(flat, 'white');
    expect(clean.white).toBeGreaterThan(99);
    // White's 6th move (index 10 → 11) throws away a level position.
    const blunder = [...flat];
    blunder.splice(11, 10, ...Array.from({ length: 10 }, () => 10));
    expect(gameAccuracy(blunder, 'white').black!).toBeGreaterThan(
      gameAccuracy(blunder, 'white').white!,
    );
    expect(averageCpLoss([{ cp: 20 }, { cp: -300 }, { cp: -280 }], 'white').white).toBe(320);
    // A verification search replaces the evaluation pair for that move.
    const verified = [{ before: { cp: 40 }, after: { cp: 30 } }, undefined];
    expect(averageCpLoss([{ cp: 20 }, { cp: -300 }, { cp: -280 }], 'white', verified).white).toBe(
      10,
    );
  });

  it('grades a move within one search, not on the noise between two searches', () => {
    // Opera Game, 15.Bxd7+: a separate search of the position after the move found a
    // better defence than the first search did, and the move looked like a blunder.
    const facts = {
      color: 'white' as const,
      before: { cp: 1155 },
      after: { cp: 241 },
      played: 'b5d7',
      best: 'b3b8',
      legalMoves: 40,
      isBook: false,
      isSacrifice: false,
    };
    expect(classifyPly(facts).cls).toBe('blunder');
    expect(classifyPly({ ...facts, playedScore: { cp: 1120 } }).cls).toBe('best');
  });

  it('does not call an obvious recapture a great move', () => {
    const base = {
      color: 'white' as const,
      played: 'd1f3',
      best: 'd1f3',
      legalMoves: 30,
      isBook: false,
      isSacrifice: false,
    };
    const only = { ...base, before: { cp: 100 }, after: { cp: 100 }, secondBest: { cp: -250 } };
    expect(classifyPly(only).cls).toBe('great');
    expect(classifyPly({ ...only, isRecapture: true }).cls).toBe('best');
  });

  it('recognises a genuine sacrifice (the Greek gift)', () => {
    const greekGift = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
    expect(isSacrifice(greekGift, 'd3h7')).toBe(true);
    expect(isSacrifice(greekGift, 'a2a3')).toBe(false);
  });
});

describe('tactics and explanations', () => {
  it('finds forks, pins, hanging pieces and weak back ranks', () => {
    const fork = positionFromFen('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1');
    const after = fork.clone();
    after.play({ from: 35, to: 50 }); // Nd5-c7+
    expect(forkTargets(after.board, 50).length).toBe(2);

    const pin = positionFromFen('4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1');
    expect(findPins(pin.board, 'black')[0]).toMatchObject({ absolute: true });

    const hanging = positionFromFen('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1');
    expect(hangingPieces(hanging.board, 'black').map((h) => h.role)).toEqual(['knight']);

    const backRank = positionFromFen('3r2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1');
    expect(weakBackRank(backRank.board, 'white')).toBe(true);
  });

  it('explains a winning fork in plain English', () => {
    const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
    const ex = explainBestMove(fen, {
      multipv: 1,
      score: { cp: 500 },
      moves: ['d5c7', 'e8d7', 'c7a8'],
    });
    expect(ex?.summary).toMatch(/^Nc7\+ .*fork/i);
    expect(ex?.points.join(' ')).toMatch(/wins material/);
  });

  it('explains a mating queen sacrifice (the Opera Game)', () => {
    const fen = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 16';
    const ex = explainBestMove(fen, {
      multipv: 1,
      score: { mate: 2 },
      moves: ['b3b8', 'd7b8', 'd1d8'],
    });
    expect(ex?.summary).toBe('Qb8+ sacrifices the queen on b8 with check.');
    expect(ex?.points[0]).toBe('White has a forced mate in 2: 16. Qb8+ Nxb8 17. Rd8#.');
  });

  it('describes mate threats', () => {
    // Null-move position: Black to move threatens Rd1#.
    const fen = '3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1';
    const threat = describeThreat(fen, { multipv: 1, score: { mate: -1 }, moves: ['d8d1'] });
    expect(threat?.text).toMatch(/checkmate/);
    expect(positionInsights(fen).length).toBeGreaterThan(0);
  });
});
