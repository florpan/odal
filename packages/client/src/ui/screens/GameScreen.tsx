import { useEffect, useState } from 'react';
import { RestartButton } from '../dialogs/RestartButton';
import { GameCanvas } from '../GameCanvas';
import { useApp } from '../hooks';
import { ActionBar } from '../hud/ActionBar';
import { HelpBar } from '../hud/HelpBar';
import { Messages } from '../hud/Messages';
import { Minimap } from '../hud/Minimap';
import { ModeHint } from '../hud/ModeHint';
import { SelectionPanel } from '../hud/SelectionPanel';
import { TopBar } from '../hud/TopBar';
import type { HudModel } from '../../game';
import { KeysOverlay } from './KeysOverlay';
import { TechTreeOverlay } from './TechTreeOverlay';

/** Phones and short landscape windows: the bottom panel would cover most of the board. */
const COMPACT_QUERY = '(pointer: coarse), (max-height: 520px)';

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

function title(sel: HudModel['selection']): string {
  switch (sel.kind) {
    case 'none':
      return 'Nothing selected';
    case 'units':
      return `${sel.count} units`;
    default:
      return sel.name;
  }
}

export function GameScreen() {
  const error = useApp((s) => s.error);
  const overlay = useApp((s) => s.overlay);
  const selection = useApp((s) => s.hud.selection);
  const compact = useCompact();
  // In the compact layout the panel is a one-line strip; it opens on request and closes again after
  // an action or when the selection is cleared, so the board stays visible.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (selection.kind === 'none') setOpen(false);
  }, [selection.kind]);

  return (
    <div className="game-screen">
      <GameCanvas />
      <div className={`hud${compact ? ' compact' : ''}`}>
        <TopBar>
          <RestartButton />
        </TopBar>
        <HelpBar />
        <Messages />
        <ModeHint />
        {error && <div className="hud-error">{error}</div>}
        <div className={`hud-bottom${open ? ' open' : ''}`}>
          {compact && (
            <button type="button" className="hud-toggle" onClick={() => setOpen((o) => !o)}>
              <span>{title(selection)}</span>
              <span className="chev">{open ? '\u25BE' : '\u25B4'}</span>
            </button>
          )}
          <div className="hud-panels">
            <SelectionPanel />
            <ActionBar onAction={() => compact && setOpen(false)} />
            <Minimap />
          </div>
        </div>
        {overlay === 'tree' && <TechTreeOverlay />}
        {overlay === 'keys' && <KeysOverlay />}
      </div>
    </div>
  );
}
