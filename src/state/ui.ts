import type { Role } from 'chessops/types';
import { create } from 'zustand';
import type { Color } from '../lib/chess';

export type Mode = 'analysis' | 'play' | 'setup';
export type DialogName = 'import' | 'share' | 'settings' | 'help';
export type ToolTab = 'insights' | 'openings' | 'endgame' | 'review';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface PromotionRequest {
  color: Color;
  square: string;
  resolve: (role: Role | undefined) => void;
}

interface UiStore {
  mode: Mode;
  dialog?: DialogName;
  tab: ToolTab;
  toasts: Toast[];
  promotion?: PromotionRequest;
  /** Squares to emphasise on the board when hovering an insight. */
  focusSquares: string[];
  setMode(mode: Mode): void;
  open(dialog: DialogName): void;
  close(): void;
  setTab(tab: ToolTab): void;
  toast(text: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismiss(id: number): void;
  askPromotion(color: Color, square: string): Promise<Role | undefined>;
  setFocus(squares: string[]): void;
}

let toastSeq = 0;

export const useUi = create<UiStore>()((set, get) => ({
  mode: 'analysis',
  tab: 'insights',
  toasts: [],
  focusSquares: [],
  setMode: (mode) => set({ mode, dialog: undefined }),
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: undefined }),
  setTab: (tab) => set({ tab }),
  toast: (text, tone = 'info', action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, action }] });
    window.setTimeout(() => get().dismiss(id), action ? 8000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  askPromotion: (color, square) =>
    new Promise((resolve) => {
      set({
        promotion: {
          color,
          square,
          resolve: (role) => {
            set({ promotion: undefined });
            resolve(role);
          },
        },
      });
    }),
  setFocus: (focusSquares) => set({ focusSquares }),
}));
