import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Color } from '../lib/chess';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { BRUSHES } from './boardStyles';

export interface BoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  /** Which side may move; undefined makes the board view-only. */
  movable?: Color | 'both';
  dests?: Map<string, string[]>;
  lastMove?: [string, string];
  check?: boolean;
  shapes?: DrawShape[];
  premovable?: boolean;
  onMove?: (orig: string, dest: string) => void;
  /** Change this to force the board to re-sync, e.g. after a rejected move. */
  sync?: unknown;
  /** Set when the opponent has just moved, so a queued premove can fire. */
  premoveToken?: unknown;
  label?: string;
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | undefined>(undefined);
  const onMove = useRef(props.onMove);
  const coordinates = useSettings((s) => s.coordinates);
  const animation = useSettings((s) => s.animation);
  const showDests = useSettings((s) => s.showDests);

  useLayoutEffect(() => {
    onMove.current = props.onMove;
  });

  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, {
      coordinates,
      animation: { enabled: animation, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, events: { after: (o, d) => onMove.current?.(o, d) } },
      draggable: { showGhost: true },
      drawable: { brushes: { ...defaultBrushes(), ...BRUSHES } },
      premovable: { enabled: false },
    });
    api.current = cg;
    return () => {
      cg.destroy();
      api.current = undefined;
    };
    // Recreate the board when coordinates are toggled; everything else is updated in place.
  }, [coordinates]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    fen,
    orientation,
    turnColor,
    movable,
    dests,
    lastMove,
    check,
    premovable,
    sync,
    premoveToken,
  } = props;
  useEffect(() => {
    const cfg: Config = {
      fen,
      orientation,
      turnColor,
      check: !!check,
      lastMove: lastMove as Key[] | undefined,
      animation: { enabled: animation, duration: 180 },
      movable: {
        color: movable,
        dests: movable ? (dests as Map<Key, Key[]> | undefined) : new Map(),
        showDests,
        free: false,
      },
      premovable: { enabled: !!premovable, showDests },
      viewOnly: false,
    };
    api.current?.set(cfg);
  }, [
    fen,
    orientation,
    turnColor,
    movable,
    dests,
    lastMove,
    check,
    premovable,
    sync,
    animation,
    showDests,
    coordinates,
  ]);

  useEffect(() => {
    if (premoveToken !== undefined) api.current?.playPremove();
  }, [premoveToken]);

  useEffect(() => {
    api.current?.setAutoShapes(props.shapes ?? []);
  }, [props.shapes, fen, orientation, coordinates]);

  return (
    <div
      ref={el}
      className="cg-host"
      role="application"
      aria-label={props.label ?? 'Chess board'}
    />
  );
}

function defaultBrushes() {
  return {
    green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
    red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
    blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
    yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  };
}

const PROMOTION_ROLES: Role[] = ['queen', 'knight', 'rook', 'bishop'];

/** Piece picker shown over the promotion square's file, like on the big sites. */
export function PromotionPicker({ orientation }: { orientation: Color }) {
  const request = useUi((s) => s.promotion);
  if (!request) return null;
  const file = request.square.charCodeAt(0) - 97;
  const left = (orientation === 'white' ? file : 7 - file) * 12.5;
  const fromTop = (request.square[1] === '8') === (orientation === 'white');
  return (
    <div
      className="promotion"
      onClick={() => request.resolve(undefined)}
      role="dialog"
      aria-label="Choose a promotion piece"
    >
      <div
        className={`promotion-column ${fromTop ? 'top' : 'bottom'}`}
        style={{ left: `${left}%` }}
      >
        {PROMOTION_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className="promotion-choice"
            aria-label={`Promote to ${role}`}
            onClick={(e) => {
              e.stopPropagation();
              request.resolve(role);
            }}
          >
            <i className={`pc ${request.color} ${role}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
