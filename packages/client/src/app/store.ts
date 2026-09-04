import { createStore } from 'zustand/vanilla';
import type { LobbyInfo } from '@odal/engine';
import type { GameSession } from '../game/session';
import { EMPTY_HUD } from '../game/viewmodel';
import type { HudModel } from '../game/viewmodel';

// ---------------------------------------------------------------------------
// The one place where the game (pure TS) and the UI (React) meet.
//
// - Game code writes here with appStore.setState(...) (zustand/vanilla, no React).
// - UI reads with the useApp(selector) hook (ui/hooks.ts) and calls methods on
//   the session. UI never reaches into the renderer or the world directly.
// ---------------------------------------------------------------------------

export type Screen = 'start' | 'lobby' | 'game';
export type Connection = 'idle' | 'connecting' | 'open' | 'closed';
/** Full-screen panels over the game. `null` = playing. */
export type Overlay = 'tree' | null;

export interface AppState {
  screen: Screen;
  connection: Connection;
  error: string | null;
  you: string;
  room: string;
  lobby: LobbyInfo | null;
  session: GameSession | null;
  hud: HudModel;
  overlay: Overlay;
}

export const appStore = createStore<AppState>(() => ({
  screen: 'start',
  connection: 'idle',
  error: null,
  you: '',
  room: 'main',
  lobby: null,
  session: null,
  hud: EMPTY_HUD,
  overlay: null,
}));

export function toggleOverlay(which: Exclude<Overlay, null>) {
  appStore.setState((s) => ({ overlay: s.overlay === which ? null : which }));
}

/** Leave the current session and go back to the start screen. */
export function leaveGame() {
  appStore.getState().session?.dispose();
  appStore.setState({
    screen: 'start',
    connection: 'idle',
    lobby: null,
    session: null,
    hud: EMPTY_HUD,
    error: null,
    overlay: null,
  });
}
