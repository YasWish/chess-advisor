import { useSyncExternalStore } from 'react';
import { useSettings } from '../state/settings';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(fn: () => void): () => void {
  const mq = query();
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

/** The theme actually in effect: the user's choice, or the system's when set to "system". */
export function useResolvedTheme(): 'dark' | 'light' {
  const theme = useSettings((s) => s.theme);
  const systemDark = useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => true,
  );
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
