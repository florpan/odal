import { hexArea, hexCentre, hexDistance, hexRing, worldToHex } from './hex';
import { idx } from './tree';
import type { GameState, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Tile grid helpers: blocking, adjacency and placement on the hex grid.
// A footprint is a centre hex plus every hex within `radius` steps (radius 0
// is a single hex). Pathfinding lives in pathfinding.ts.
// ---------------------------------------------------------------------------

/** The hex a world position is in. */
export function tileOf(p: Vec2): Vec2 {
  return worldToHex(p);
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

/** Every hex of a footprint centred on (x, y) with the given radius. */
export function footprintTiles(x: number, y: number, radius: number): Vec2[] {
  return hexArea(x, y, radius);
}

/**
 * Tiles nothing can walk through: nodes and buildings. With `forOwner`, that
 * player's `passable` buildings (gates) are left open, so pathfinding for their
 * units walks through them while everyone else goes around.
 */
export function computeBlocked(state: GameState, forOwner?: number): Uint8Array {
  const { width: w, height: h } = state;
  const g = new Uint8Array(w * h);
  for (const id in state.nodes) {
    const n = state.nodes[id];
    g[n.y * w + n.x] = 1;
  }
  const defs = idx(state.tree).buildings;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (forOwner !== undefined && b.owner === forOwner && defs[b.type].passable) continue;
    stampFootprint(g, w, h, b.x, b.y, b.r, 1);
  }
  return g;
}

/** Set every tile of a footprint to `value` in a w×h grid. */
export function stampFootprint(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
  value: number,
) {
  for (const t of footprintTiles(x, y, radius)) if (inBounds(w, h, t.x, t.y)) grid[t.y * w + t.x] = value;
}

export function isWalkable(blocked: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return inBounds(w, h, x, y) && blocked[y * w + x] === 0;
}

/** The ring of tiles surrounding a footprint. */
export function adjacentTiles(x: number, y: number, radius: number): Vec2[] {
  return hexRing(x, y, radius + 1);
}

/** True if the position's hex touches the footprint (or is inside it). */
export function isAdjacentTo(pos: Vec2, x: number, y: number, radius: number): boolean {
  return hexDistance(tileOf(pos), { x, y }) <= radius + 1;
}

/** Closest (by straight-line distance) walkable tile from a candidate list. */
export function nearestWalkableTile(
  blocked: Uint8Array,
  w: number,
  h: number,
  candidates: Vec2[],
  from: Vec2,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!isWalkable(blocked, w, h, c.x, c.y)) continue;
    const cc = hexCentre(c.x, c.y);
    const dx = cc.x - from.x;
    const dy = cc.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** First walkable tile found in expanding rings around a footprint. */
export function findFreeTileNear(
  blocked: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
  maxRing = 6,
): Vec2 | null {
  for (let r = radius + 1; r <= radius + maxRing; r++) {
    for (const t of hexRing(x, y, r)) if (isWalkable(blocked, w, h, t.x, t.y)) return t;
  }
  return null;
}

export function canPlaceFootprint(
  blocked: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
): boolean {
  for (const t of footprintTiles(x, y, radius)) if (!isWalkable(blocked, w, h, t.x, t.y)) return false;
  return true;
}

/**
 * Distance from a world position to the edge of a footprint, treating the
 * footprint as a disc: inradius 0.5 for a single hex, one hex more per ring.
 * Zero inside.
 */
export function footprintDistance(p: Vec2, x: number, y: number, radius: number): number {
  const c = hexCentre(x, y);
  return Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - 0.5 - radius);
}
