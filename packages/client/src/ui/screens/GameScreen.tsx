import { useEffect, useState } from 'react';
import { RestartButton } from '../dialogs/RestartButton';
import { GameCanvas } from '../GameCanvas';
import { useApp } from '../hooks';
import { HelpBar } from '../hud/HelpBar';
import { Messages } from '../hud/Messages';
import { Minimap } from '../hud/Minimap';
import { ModeHint } from '../hud/ModeHint';
import { SelectionCard } from '../hud/SelectionPanel';
import { TopBar } from '../hud/TopBar';
import { KeysOverlay } from './KeysOverlay';
import { TechTreeOverlay } from './TechTreeOverlay';

/** Phones and short landscape windows: the card becomes a bottom sheet and the minimap starts hidden. */
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

/**
 * The in-game HUD: a top bar, a selection card (what is selected plus its actions) that floats over the
 * board, and a minimap in the corner that can be hidden. Nothing spans the bottom, so the board stays
 * visible on a phone; on wide screens the card sits bottom-left and the minimap bottom-right.
 */
export function GameScreen() {
  const error = useApp((s) => s.error);
  const overlay = useApp((s) => s.overlay);
  const compact = useCompact();
  const [showMap, setShowMap] = useState(() => !window.matchMedia(COMPACT_QUERY).matches);
  return (
    <div className="game-screen">
      <GameCanvas />
      <div className={`hud${compact ? ' compact' : ''}`}>
        <TopBar>
          <button
            type="button"
            className={`small${showMap ? ' active' : ''}`}
            onClick={() => setShowMap((v) => !v)}
            title="Show or hide the minimap"
          >
            Map
          </button>
          <RestartButton />
        </TopBar>
        <HelpBar />
        <Messages />
        <ModeHint />
        {error && <div className="hud-error">{error}</div>}
        <SelectionCard />
        {showMap && (
          <div className="minimap-box">
            <Minimap />
          </div>
        )}
        {overlay === 'tree' && <TechTreeOverlay />}
        {overlay === 'keys' && <KeysOverlay />}
      </div>
    </div>
  );
}
