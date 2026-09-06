import { footprintTiles } from './grid';
import { ROW_H, hexCentre, worldToHex } from './hex';
import { idx } from './tree';
import type { GameState } from './types';

// ---------------------------------------------------------------------------
// Fog of war. A vision grid is 1 where the player can currently see.
// Both server (to filter snapshots) and client (to draw fog) compute this
// from the player's own units and buildings, so nothing extra is sent.
// ---------------------------------------------------------------------------

/** Mark every hex whose centre is within `r` world units of (cx, cy). */
export function stampCircle(grid: Uint8Array, w: number, h: number, cx: number, cy: number, r: number) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor((cy - r) / ROW_H) - 1);
  const y1 = Math.min(h - 1, Math.ceil((cy + r) / ROW_H));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = hexCentre(x, y);
      const dx = c.x - cx;
      const dy = c.y - cy;
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
    if (b.owner !== playerId) continue;
    const c = hexCentre(b.x, b.y);
    stampCircle(grid, w, h, c.x, c.y, defs.buildings[b.type].vision);
  }
  return grid;
}

/** True when the hex under a world position is visible. */
export function isVisible(vision: Uint8Array, w: number, x: number, y: number): boolean {
  const t = worldToHex({ x, y });
  return vision[t.y * w + t.x] === 1;
}

/** A building is visible if any hex of its footprint is. */
export function isBuildingVisible(vision: Uint8Array, w: number, x: number, y: number, radius: number): boolean {
  for (const t of footprintTiles(x, y, radius)) if (t.x >= 0 && t.x < w && vision[t.y * w + t.x]) return true;
  return false;
}
