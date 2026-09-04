import { useEffect, useRef } from 'react';
import { useApp } from './hooks';

/**
 * The single bridge between React and the game. React owns the <canvas>
 * element; the session draws into it and listens for input on it. Nothing
 * here re-renders while the game runs, and the effect's cleanup tears the
 * renderer down completely (StrictMode mounts twice in development).
 */
export function GameCanvas() {
  const session = useApp((s) => s.session);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!session || !ref.current) return;
    return session.attach(ref.current);
  }, [session]);

  return (
    <div className="game-view">
      <canvas ref={ref} className="game-canvas" />
    </div>
  );
}
