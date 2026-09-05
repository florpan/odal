import type { ReactNode } from 'react';
import { toggleOverlay } from '../../app/store';
import { useApp } from '../hooks';

export function TopBar({ children }: { children?: ReactNode }) {
  const player = useApp((s) => s.hud.player);
  const resources = useApp((s) => s.hud.resources);
  const pop = useApp((s) => s.hud.pop);
  const overlay = useApp((s) => s.overlay);
  return (
    <div className="topbar">
      <span className="player-tag" style={{ color: player?.color }}>
        {player?.name ?? ''}
      </span>
      {resources.map((r) => (
        <span key={r.id} className="res" title={r.name}>
          {r.icon} {r.amount}
        </span>
      ))}
      <span className="res" title="Population">
        👥 {pop.used} / {pop.cap}
      </span>
      <span className="spacer" />
      <button
        type="button"
        className={`small${overlay === 'tree' ? ' active' : ''}`}
        onClick={() => toggleOverlay('tree')}
      >
        Tech tree (Tab)
      </button>
      <button
        type="button"
        className={`small${overlay === 'keys' ? ' active' : ''}`}
        onClick={() => toggleOverlay('keys')}
        title="All mouse and keyboard controls"
      >
        Controls (F1)
      </button>
      {children}
    </div>
  );
}
