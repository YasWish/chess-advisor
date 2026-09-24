import { useEffect } from 'react';
import { AnalysisView } from './components/AnalysisView';
import { useBoardStyles } from './components/boardStyles';
import { Dialogs } from './components/Dialogs';
import { PlayView } from './components/PlayView';
import { SetupView } from './components/SetupView';
import { TopBar } from './components/TopBar';
import { Toaster } from './components/ui';
import { useResolvedTheme } from './components/useTheme';
import { useHotkeys } from './controllers/hotkeys';
import { startLiveAnalysis } from './controllers/liveAnalysis';
import { restoreSession, startAutosave } from './controllers/persistence';
import { setPaused } from './controllers/play';
import { engine } from './engine/stockfish';
import { useUi } from './state/ui';

export function App() {
  const mode = useUi((s) => s.mode);
  const theme = useResolvedTheme();
  useBoardStyles();
  useHotkeys();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1a1612' : '#e6e8e4');
  }, [theme]);

  useEffect(() => {
    restoreSession();
    const stops = [startLiveAnalysis(), startAutosave()];
    engine.init().catch(() => {
      // The engine panel shows the error and offers a retry.
    });
    return () => stops.forEach((stop) => stop());
  }, []);

  useEffect(() => setPaused(mode !== 'play'), [mode]);

  return (
    <>
      <TopBar />
      <main id="main" className={`app-main mode-${mode}`}>
        {mode === 'analysis' && <AnalysisView />}
        {mode === 'play' && <PlayView />}
        {mode === 'setup' && <SetupView />}
      </main>
      <Dialogs />
      <Toaster />
    </>
  );
}
