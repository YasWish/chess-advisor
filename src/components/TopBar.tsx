import { CircleHelp, Import, Moon, Settings, Share2, Sun } from 'lucide-react';
import { useSettings } from '../state/settings';
import { useUi, type Mode } from '../state/ui';
import { Button } from './ui';
import { useResolvedTheme } from './useTheme';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'play', label: 'Play' },
  { id: 'setup', label: 'Set up' },
];

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="7" className="logo-bg" />
      <path
        className="logo-rook"
        d="M8 26h16v-3h-2v-2h-1v-9h2V6h-3v2.5h-2.5V6h-3v2.5H12V6H9v6h2v9h-1v2H8z"
      />
    </svg>
  );
}

export function TopBar() {
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const open = useUi((s) => s.open);
  const update = useSettings((s) => s.update);
  const dark = useResolvedTheme() === 'dark';
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to the board
      </a>
      <a
        className="brand"
        href="./"
        aria-label="Chess Advisor, start page"
        onClick={(e) => (e.preventDefault(), setMode('analysis'))}
      >
        <Logo />
        <span className="brand-name">Chess Advisor</span>
      </a>
      <nav className="modes" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={mode === m.id ? 'on' : ''}
            aria-current={mode === m.id ? 'page' : undefined}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <Button
          tone="quiet"
          icon={<Import size={18} />}
          onClick={() => open('import')}
          label="Import a game or position (I)"
        >
          <span className="hide-sm">Import</span>
        </Button>
        <Button
          tone="quiet"
          icon={<Share2 size={18} />}
          onClick={() => open('share')}
          label="Share and export (S)"
        >
          <span className="hide-sm">Share</span>
        </Button>
        <Button
          tone="quiet"
          icon={dark ? <Sun size={18} /> : <Moon size={18} />}
          label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
          onClick={() => update({ theme: dark ? 'light' : 'dark' })}
        />
        <Button
          tone="quiet"
          icon={<Settings size={18} />}
          label="Settings"
          onClick={() => open('settings')}
        />
        <Button
          tone="quiet"
          icon={<CircleHelp size={18} />}
          label="Help and keyboard shortcuts (?)"
          onClick={() => open('help')}
        />
      </div>
    </header>
  );
}
