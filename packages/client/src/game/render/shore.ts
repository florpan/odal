import { hexCentre, hexNeighbours } from '@odal/engine';
import type { GameState } from '@odal/engine';

// ---------------------------------------------------------------------------
// Which ground tile a hex shows. A hex next to the island's water gets one of
// its terrain's `shore` tiles: the one for its longest run of consecutive water
// edges, turned so the tile's water side (authored towards +z, i.e. world angle
// 90°) faces the middle of that run. Other impassable terrain (mountains) is not
// a coast.
// ---------------------------------------------------------------------------

export interface Shore {
  /** Consecutive water edges, 1..6. */
  run: number;
  /** World angle (radians, atan2(y, x)) of the middle of the run. */
  angle: number;
}

/** The longest run of water neighbours around hex (x, y), or null if it has none, is water itself, or the map has no water. */
export function shoreOf(state: GameState, x: number, y: number): Shore | null {
  const { width: w, height: h } = state;
  const waterId = state.tree.rules.map.island?.water;
  if (!waterId) return null;
  const waterIdx = state.tree.terrain.findIndex((t) => t.id === waterId);
  if (state.terrain[y * w + x] === waterIdx) return null;
  const c = hexCentre(x, y);
  const ns = hexNeighbours(x, y);
  const water = ns.map((n) => n.x >= 0 && n.y >= 0 && n.x < w && n.y < h && state.terrain[n.y * w + n.x] === waterIdx);
  if (!water.some(Boolean)) return null;
  if (water.every(Boolean)) return { run: 6, angle: 0 };

  // Walk the ring twice so a run wrapping past index 5 is seen whole.
  let best = { start: 0, len: 0 };
  let start = -1;
  for (let i = 0; i < 12; i++) {
    if (water[i % 6]) {
      if (start < 0) start = i;
      const len = Math.min(6, i - start + 1);
      if (len > best.len) best = { start, len };
    } else start = -1;
  }
  let dx = 0;
  let dy = 0;
  for (let i = best.start; i < best.start + best.len; i++) {
    const n = hexCentre(ns[i % 6].x, ns[i % 6].y);
    dx += n.x - c.x;
    dy += n.y - c.y;
  }
  return { run: best.len, angle: Math.atan2(dy, dx) };
}

/** Which tile file a hex shows, and how far to turn it about the vertical axis (three.js rotation.y). */
export function tileOf(state: GameState, x: number, y: number): { model: string | undefined; rotation: number } {
  const def = state.tree.terrain[state.terrain[y * state.width + x]];
  const shore = def.visual.shore?.length ? shoreOf(state, x, y) : null;
  if (!shore) return { model: def.visual.model, rotation: 0 };
  const list = def.visual.shore!;
  const model = list[Math.min(shore.run, list.length) - 1];
  // Authored water side at world angle 90°; rotation.y turns a direction by -rotation, so 90° - angle.
  return { model, rotation: Math.PI / 2 - shore.angle };
}
