import { useApp } from './hooks';
import { GameScreen } from './screens/GameScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { StartScreen } from './screens/StartScreen';

/** Screen switch. Which screen is shown is decided by the game session via the store. */
export function App() {
  const screen = useApp((s) => s.screen);
  switch (screen) {
    case 'start':
      return <StartScreen />;
    case 'lobby':
      return <LobbyScreen />;
    case 'game':
      return <GameScreen />;
  }
}
