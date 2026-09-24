import { useEffect } from 'react';
import { BOARD_THEMES, useSettings } from '../state/settings';

const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
const ROLE_CHAR: Record<(typeof ROLES)[number], string> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
};

/**
 * Points the piece and board CSS variables at the chosen set and colours. Using custom
 * properties (not an injected stylesheet) keeps the app compatible with a strict CSP.
 */
export function useBoardStyles(): void {
  const pieceSet = useSettings((s) => s.pieceSet);
  const boardTheme = useSettings((s) => s.boardTheme);
  useEffect(() => {
    const root = document.documentElement.style;
    // Absolute URLs: a relative url() inside a custom property would be resolved against the
    // stylesheet that uses the variable (in /assets/), not against the page.
    const base = new URL(`${import.meta.env.BASE_URL}pieces/${pieceSet}/`, document.baseURI).href;
    for (const role of ROLES) {
      for (const color of ['white', 'black'] as const) {
        const code = `${color[0]}${ROLE_CHAR[role]}`;
        root.setProperty(`--piece-${code}`, `url('${base}${code}.svg')`);
      }
    }
    const t = BOARD_THEMES[boardTheme];
    root.setProperty('--sq-light', t.light);
    root.setProperty('--sq-dark', t.dark);
  }, [pieceSet, boardTheme]);
}

export const BRUSHES = {
  best: { key: 'best', color: '#d9a93d', opacity: 0.92, lineWidth: 11 },
  alt: { key: 'alt', color: '#d9a93d', opacity: 0.5, lineWidth: 7 },
  threat: { key: 'threat', color: '#c8412f', opacity: 0.85, lineWidth: 10 },
  good: { key: 'good', color: '#4f9a52', opacity: 0.85, lineWidth: 10 },
  focus: { key: 'focus', color: '#e2b33c', opacity: 0.95, lineWidth: 6 },
  hint: { key: 'hint', color: '#4f86c6', opacity: 0.85, lineWidth: 11 },
};
