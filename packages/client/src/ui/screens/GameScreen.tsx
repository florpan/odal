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
import { KeysOverlay } from './KeysOverlay';
import { TechTreeOverlay } from './TechTreeOverlay';

export function GameScreen() {
  const error = useApp((s) => s.error);
  const overlay = useApp((s) => s.overlay);
  return (
    <div className="game-screen">
      <GameCanvas />
      <div className="hud">
        <TopBar>
          <RestartButton />
        </TopBar>
        <HelpBar />
        <Messages />
        <ModeHint />
        {error && <div className="hud-error">{error}</div>}
        <div className="hud-bottom">
          <SelectionPanel />
          <ActionBar />
          <Minimap />
        </div>
        {overlay === 'tree' && <TechTreeOverlay />}
        {overlay === 'keys' && <KeysOverlay />}
      </div>
    </div>
  );
}
