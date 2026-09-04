import { useEffect, useRef } from 'react';
import { useApp } from '../hooks';

const SIZE = 180;

/**
 * Owns a small 2D canvas and hands drawing to the game session each frame,
 * the same bridge pattern as GameCanvas. Left click moves the camera,
 * right click moves the selected units.
 */
export function Minimap() {
  const session = useApp((s) => s.session);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!session || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      session.drawMinimap(ctx, canvas.width, canvas.height);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!session) return;
    const r = e.currentTarget.getBoundingClientRect();
    session.minimapClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.button);
  };

  return (
    <canvas
      ref={ref}
      className="minimap"
      width={SIZE}
      height={SIZE}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
