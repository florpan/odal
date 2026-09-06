import type { Vec2 } from './types';

// ---------------------------------------------------------------------------
// Hex grid geometry. Pointy-top hexes in horizontal rows; odd rows are shifted
// half a hex to the right ("odd-r" offset coordinates).
//
// Storage: a tile is (col, row) = Vec2 {x, y}, indexed row * width + col, so
// every w×h Uint8Array in the engine (blocking, vision, fog) is unchanged.
// Math: neighbours and distances go through axial coordinates (q, r).
// World: continuous positions where neighbouring hexes in a row are 1 apart.
// A hex is therefore about one unit wide, which keeps speeds, ranges and
// radii in the tech tree meaningful as "about one hex".
// ---------------------------------------------------------------------------

/** Distance between the centres of two hexes next to each other in a row. */
export const HEX_WIDTH = 1;
/** Circumradius (centre to corner). The inradius, centre to edge, is HEX_WIDTH / 2. */
export const HEX_R = HEX_WIDTH / Math.sqrt(3);
/** Distance between the centres of two adjacent rows. */
export const ROW_H = HEX_R * 1.5;

/** Axial coordinates; the six neighbour directions. */
const AXIAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function offsetToAxial(col: number, row: number): { q: number; r: number } {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

export function axialToOffset(q: number, r: number): Vec2 {
  return { x: q + ((r - (r & 1)) >> 1), y: r };
}

/** World position of a hex's centre. */
export function hexCentre(col: number, row: number): Vec2 {
  return { x: col + 0.5 + (row & 1) * 0.5, y: (row + 0.5) * ROW_H };
}

/** The hex containing a world position (offset coordinates; may be out of bounds). */
export function worldToHex(p: Vec2): Vec2 {
  // Fractional axial coordinates relative to the centre of hex (0,0), then cube rounding.
  const px = p.x - 0.5;
  const py = p.y - 0.5 * ROW_H;
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / HEX_R;
  const r = ((2 / 3) * py) / HEX_R;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const o = axialToOffset(rq, rr);
  return { x: o.x + 0, y: o.y + 0 }; // + 0 turns -0 into 0
}

/** Number of steps between two hexes. */
export function hexDistance(a: Vec2, b: Vec2): number {
  const p = offsetToAxial(a.x, a.y);
  const q = offsetToAxial(b.x, b.y);
  const dq = p.q - q.q;
  const dr = p.r - q.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** The six hexes around one (some may be out of bounds). */
export function hexNeighbours(col: number, row: number): Vec2[] {
  const { q, r } = offsetToAxial(col, row);
  return AXIAL_DIRS.map(([dq, dr]) => axialToOffset(q + dq, r + dr));
}

/** All hexes at exactly `radius` steps from the centre (the centre itself for radius 0). */
export function hexRing(col: number, row: number, radius: number): Vec2[] {
  if (radius <= 0) return [{ x: col, y: row }];
  const c = offsetToAxial(col, row);
  const out: Vec2[] = [];
  // Start `radius` steps along direction 4, then walk each side.
  let q = c.q + AXIAL_DIRS[4][0] * radius;
  let r = c.r + AXIAL_DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(axialToOffset(q, r));
      q += AXIAL_DIRS[side][0];
      r += AXIAL_DIRS[side][1];
    }
  }
  return out;
}

/** All hexes within `radius` steps of the centre, centre first. */
export function hexArea(col: number, row: number, radius: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k <= radius; k++) out.push(...hexRing(col, row, k));
  return out;
}

/** The hexes on a straight line from `a` to `b`, both included. */
export function hexLine(a: Vec2, b: Vec2): Vec2[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ x: a.x, y: a.y }];
  const p = offsetToAxial(a.x, a.y);
  const q = offsetToAxial(b.x, b.y);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Lerp in cube coordinates, nudged off the exact edge so rounding is stable, then round.
    const fq = p.q + (q.q - p.q) * t + 1e-6;
    const fr = p.r + (q.r - p.r) * t + 1e-6;
    const fs = -fq - fr;
    let rq = Math.round(fq);
    let rr = Math.round(fr);
    const rs = Math.round(fs);
    const dq = Math.abs(rq - fq);
    const dr = Math.abs(rr - fr);
    const ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    out.push(axialToOffset(rq, rr));
  }
  return out;
}

/** Size of the map in world units: `width` columns (plus the odd-row overhang) by `height` rows. */
export function worldSize(width: number, height: number): Vec2 {
  return { x: width + 0.5, y: height * ROW_H };
}
