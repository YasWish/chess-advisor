import { describe, expect, it } from 'vitest';
import {
  INITIAL_FEN,
  countLegalMoves,
  epdOf,
  nullMoveFen,
  playUci,
  positionFromFen,
  positionOutcome,
  readFen,
  sanLine,
} from '../src/lib/chess';
import {
  formatScore,
  fromSideToMove,
  informator,
  winPercent,
  winPercentFromCp,
} from '../src/lib/eval';
import { GameTree, moveNumberOf, moverOf } from '../src/lib/tree';
import { parseBestMove, parseInfo, parseOption } from '../src/lib/uci';

describe('chess helpers', () => {
  it('rejects illegal positions with readable errors', () => {
    expect(readFen('not a fen')).toMatchObject({ ok: false });
    const r = readFen('8/8/8/8/8/8/8/8 w - - 0 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty|king/i);
  });

  it('normalises king-takes-rook castling to standard UCI', () => {
    const pos = positionFromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const played = playUci(pos, 'e1h1');
    expect(played?.uci).toBe('e1g1');
    expect(played?.san).toBe('O-O');
    expect(played?.isCastle).toBe(true);
  });

  it('refuses illegal and under-specified promotion moves', () => {
    const pos = positionFromFen('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(playUci(pos.clone(), 'a7a8')).toBeUndefined();
    expect(playUci(pos.clone(), 'a7a8q')?.san).toBe('a8=Q+');
  });

  it('converts UCI lines to SAN and stops at illegal moves', () => {
    expect(sanLine(INITIAL_FEN, ['e2e4', 'e7e5', 'g1f3', 'e1e2'])).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('builds a null-move position for threat detection, but not when in check', () => {
    expect(nullMoveFen(INITIAL_FEN)?.split(' ')[1]).toBe('b');
    expect(nullMoveFen('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1')).toBeUndefined();
  });

  it('detects game endings', () => {
    const mate = positionFromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(positionOutcome(mate)).toEqual({ winner: 'black', termination: 'checkmate' });
    expect(positionOutcome(positionFromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))?.termination).toBe(
      'stalemate',
    );
    expect(countLegalMoves(positionFromFen(INITIAL_FEN))).toBe(20);
  });

  it('uses EPD (no move counters) as the position key', () => {
    expect(epdOf(INITIAL_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
});

describe('evaluation math', () => {
  it('maps centipawns to winning chances symmetrically', () => {
    expect(winPercentFromCp(0)).toBeCloseTo(50);
    expect(winPercentFromCp(300) + winPercentFromCp(-300)).toBeCloseTo(100);
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -2 })).toBe(0);
  });

  it('converts engine scores to White’s point of view', () => {
    expect(fromSideToMove({ cp: 35 }, 'black')).toEqual({ cp: -35 });
    expect(fromSideToMove({ mate: 2 }, 'black')).toEqual({ mate: -2 });
    expect(fromSideToMove({ mate: 0 }, 'white')).toEqual({ cp: -1000 });
  });

  it('formats scores the way players write them', () => {
    expect(formatScore({ cp: 34 })).toBe('+0.34');
    expect(formatScore({ cp: -120 })).toBe('\u22121.20');
    expect(formatScore({ mate: -3 })).toBe('#\u22123');
    expect(informator({ cp: 45 }).symbol).toBe('⩲');
    expect(informator({ cp: -200 }).symbol).toBe('−+');
  });
});

describe('UCI parsing', () => {
  it('parses Stockfish 19 info lines with WDL', () => {
    const info = parseInfo(
      'info depth 14 seldepth 19 multipv 1 score cp -28 wdl 6 940 54 nodes 183672 nps 365153 hashfull 61 time 503 pv b8c6 d2d4 e5d4',
    );
    expect(info).toMatchObject({
      depth: 14,
      seldepth: 19,
      multipv: 1,
      score: { cp: -28 },
      wdl: [6, 940, 54],
    });
    expect(info?.pv).toEqual(['b8c6', 'd2d4', 'e5d4']);
  });

  it('keeps bound markers and ignores lines without a PV', () => {
    expect(parseInfo('info depth 9 multipv 2 score mate 3 lowerbound nodes 1 pv a1a2')?.bound).toBe(
      'lower',
    );
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeUndefined();
    expect(parseInfo('info depth 3 currmove e2e4 currmovenumber 1')).toBeUndefined();
  });

  it('parses bestmove and options', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({
      bestmove: 'e2e4',
      ponder: 'e7e5',
    });
    expect(parseBestMove('bestmove (none)')).toEqual({ bestmove: undefined, ponder: undefined });
    expect(
      parseOption('option name UCI_Elo type spin default 1320 min 1320 max 3190'),
    ).toMatchObject({
      name: 'UCI_Elo',
      min: 1320,
      max: 3190,
    });
  });
});

describe('game tree', () => {
  it('adds moves, reuses existing continuations and tracks move numbers', () => {
    const tree = new GameTree();
    const e4 = tree.addMove(tree.root.id, 'e2e4')!;
    expect(e4.isNew).toBe(true);
    expect(tree.addMove(tree.root.id, 'e2e4')!.isNew).toBe(false);
    const e5 = tree.addMove(e4.node.id, 'e7e5')!.node;
    expect([moverOf(e4.node), moveNumberOf(e4.node)]).toEqual(['white', 1]);
    expect([moverOf(e5), moveNumberOf(e5)]).toEqual(['black', 1]);
    expect(tree.addMove(e5.id, 'e1e3')).toBeUndefined();
  });

  it('keeps variations and can promote them to the main line', () => {
    const tree = new GameTree();
    const e4 = tree.addMove(tree.root.id, 'e2e4')!.node;
    tree.addMove(e4.id, 'e7e5');
    const c5 = tree.addMove(e4.id, 'c7c5')!.node;
    const nf3 = tree.addMove(c5.id, 'g1f3')!.node;
    expect(tree.mainline().map((n) => n.san)).toEqual([undefined, 'e4', 'e5']);
    expect(tree.isMainline(nf3.id)).toBe(false);
    tree.promote(nf3.id);
    expect(tree.mainline().map((n) => n.san)).toEqual([undefined, 'e4', 'c5', 'Nf3']);
    expect(tree.ucisTo(nf3.id)).toEqual(['e2e4', 'c7c5', 'g1f3']);
    expect(tree.remove(c5.id)).toBe(e4.id);
    expect(tree.get(nf3.id)).toBeUndefined();
  });

  it('numbers moves correctly from a FEN with Black to move', () => {
    const tree = new GameTree('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const reply = tree.addMove(tree.root.id, 'c7c5')!.node;
    expect([moverOf(reply), moveNumberOf(reply)]).toEqual(['black', 1]);
  });
});
