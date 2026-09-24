import { useEffect } from 'react';
import { useAnalysis } from '../state/analysis';
import { useUi } from '../state/ui';
import { playBestMove } from './analysisMoves';
import { runReview } from './review';

/** Global keyboard shortcuts, ignored while typing or when a dialog is open. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.key === ' ' || e.key === 'Enter') && target?.closest('button, a, [role="switch"]'))
        return;
      const ui = useUi.getState();
      if (ui.dialog || ui.promotion) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const handled = (): void => e.preventDefault();

      if (e.key === '?') return (handled(), ui.open('help'));
      if (key === 'i') return (handled(), ui.open('import'));
      if (key === 's') return (handled(), ui.open('share'));
      if (ui.mode !== 'analysis') return;

      const a = useAnalysis.getState();
      switch (key) {
        case 'ArrowLeft':
          return (handled(), a.prev());
        case 'ArrowRight':
          return (handled(), a.next());
        case 'ArrowUp':
        case 'Home':
          return (handled(), a.first());
        case 'ArrowDown':
        case 'End':
          return (handled(), a.last());
        case 'f':
          return (handled(), a.flip());
        case 'l':
          return (handled(), a.setEngine(!a.engineOn));
        case 'x':
          return (handled(), a.setThreat(!a.threatOn));
        case ' ':
          return (handled(), playBestMove());
        case 'r':
          return (handled(), void runReview());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
