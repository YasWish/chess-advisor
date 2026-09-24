import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const BOARD_THEMES = {
  walnut: { name: 'Walnut', light: '#e6d2b0', dark: '#a0714a' },
  brown: { name: 'Classic brown', light: '#f0d9b5', dark: '#b58863' },
  green: { name: 'Tournament green', light: '#eeeed2', dark: '#769656' },
  blue: { name: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  slate: { name: 'Slate', light: '#d5d8dc', dark: '#6f7985' },
  lilac: { name: 'Lilac', light: '#e9e1ef', dark: '#9d86b3' },
} as const;

export const PIECE_SETS = {
  cburnett: 'Cburnett',
  merida: 'Merida',
  chessnut: 'Chessnut',
  celtic: 'Celtic',
  fantasy: 'Fantasy',
  spatial: 'Spatial',
} as const;

export type BoardTheme = keyof typeof BOARD_THEMES;
export type PieceSet = keyof typeof PIECE_SETS;
export type ThemeMode = 'system' | 'dark' | 'light';

export interface Settings {
  theme: ThemeMode;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
  coordinates: boolean;
  animation: boolean;
  showDests: boolean;
  figurines: boolean;
  sound: boolean;
  volume: number;
  voice: boolean;
  cloudEval: boolean;
  multiPv: number;
  /** Target search depth; 0 means keep searching until stopped. */
  depth: number;
  arrows: boolean;
  hashMb: number;
  reviewDepth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  boardTheme: 'walnut',
  pieceSet: 'cburnett',
  coordinates: true,
  animation: true,
  showDests: true,
  figurines: true,
  sound: true,
  volume: 0.6,
  voice: false,
  cloudEval: true,
  multiPv: 3,
  depth: 22,
  arrows: true,
  hashMb: 64,
  reviewDepth: 14,
};

interface SettingsStore extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'chess-advisor:settings',
      version: 1,
      partialize: ({ update: _u, reset: _r, ...rest }) => rest,
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<Settings>) }),
    },
  ),
);
