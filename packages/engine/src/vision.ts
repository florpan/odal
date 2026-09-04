import { idx } from './tree';
import type { GameState } from './types';

// ---------------------------------------------------------------------------
// Fog of war. A vision grid is 1 where the player can currently see.
// Both server (to filter snapshots) and client (to draw fog) compute this
// from the player's own units and buildings, so nothing extra is sent.
// ---------------------------------------------------------------------------

export function stampCircle(grid: Uint8Array, w: number, h: number, cx: number, cy: number, r: number) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) grid[y * w + x] = 1;
    }
  }
}

export function computeVision(state: GameState, playerId: number, out?: Uint8Array): Uint8Array {
  const { width: w, height: h } = state;
  const defs = idx(state.tree);
  const grid = out && out.length === w * h ? out.fill(0) : new Uint8Array(w * h);
  for (const id in state.units) {
    const u = state.units[id];
    if (u.owner === playerId) stampCircle(grid, w, h, u.x, u.y, defs.units[u.type].vision);
  }
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === playerId) stampCircle(grid, w, h, b.x + b.w / 2, b.y + b.h / 2, defs.buildings[b.type].vision);
  }
  return grid;
}

export function isVisible(vision: Uint8Array, w: number, x: number, y: number): boolean {
  return vision[Math.floor(y) * w + Math.floor(x)] === 1;
}

/** A building is visible if any tile of its footprint is. */
export function isBuildingVisible(
  vision: Uint8Array,
  w: number,
  x: number,
  y: number,
  bw: number,
  bh: number,
): boolean {
  for (let ty = y; ty < y + bh; ty++) for (let tx = x; tx < x + bw; tx++) if (vision[ty * w + tx]) return true;
  return false;
}
