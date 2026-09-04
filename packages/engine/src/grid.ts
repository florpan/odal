import type { GameState, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Tile grid helpers: blocking, adjacency, placement and A* pathfinding.
// ---------------------------------------------------------------------------

export function tileOf(p: Vec2): Vec2 {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

/** 1 = blocked (tree, rock or building footprint), 0 = walkable. */
export function computeBlocked(state: GameState): Uint8Array {
  const { width: w, height: h } = state;
  const g = new Uint8Array(w * h);
  for (const id in state.nodes) {
    const n = state.nodes[id];
    g[n.y * w + n.x] = 1;
  }
  for (const id in state.buildings) {
    const b = state.buildings[id];
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (inBounds(w, h, x, y)) g[y * w + x] = 1;
      }
    }
  }
  return g;
}

export function isWalkable(blocked: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return inBounds(w, h, x, y) && blocked[y * w + x] === 0;
}

/** The ring of tiles surrounding a rectangular footprint. */
export function adjacentTiles(x: number, y: number, w: number, h: number): Vec2[] {
  const out: Vec2[] = [];
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      const inside = tx >= x && tx < x + w && ty >= y && ty < y + h;
      if (!inside) out.push({ x: tx, y: ty });
    }
  }
  return out;
}

/** True if the position's tile touches the footprint (Chebyshev distance 1). */
export function isAdjacentTo(pos: Vec2, x: number, y: number, w: number, h: number): boolean {
  const t = tileOf(pos);
  return t.x >= x - 1 && t.x <= x + w && t.y >= y - 1 && t.y <= y + h;
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
    const dx = c.x + 0.5 - from.x;
    const dy = c.y + 0.5 - from.y;
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
  fw: number,
  fh: number,
  maxRing = 6,
): Vec2 | null {
  for (let r = 1; r <= maxRing; r++) {
    for (let ty = y - r; ty <= y + fh - 1 + r; ty++) {
      for (let tx = x - r; tx <= x + fw - 1 + r; tx++) {
        const onRing = tx === x - r || tx === x + fw - 1 + r || ty === y - r || ty === y + fh - 1 + r;
        if (!onRing) continue;
        if (isWalkable(blocked, w, h, tx, ty)) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

export function canPlaceFootprint(
  blocked: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  fw: number,
  fh: number,
): boolean {
  for (let ty = y; ty < y + fh; ty++) {
    for (let tx = x; tx < x + fw; tx++) {
      if (!isWalkable(blocked, w, h, tx, ty)) return false;
    }
  }
  return true;
}

/** Distance from a point to the nearest point of a tile rectangle. */
export function rectDistance(p: Vec2, x: number, y: number, w: number, h: number): number {
  const cx = Math.max(x, Math.min(p.x, x + w));
  const cy = Math.max(y, Math.min(p.y, y + h));
  return Math.hypot(p.x - cx, p.y - cy);
}

// ---------------------------------------------------------------------------
// A* over the tile grid, 8-directional, no corner cutting.
// Returns the list of tile centres to walk through (start excluded, goal included),
// or null if the goal is unreachable. The start tile may be blocked (e.g. a unit
// standing where a building was just placed) and is always allowed.
// ---------------------------------------------------------------------------

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export function findPath(
  blocked: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Vec2[] | null {
  if (!inBounds(w, h, sx, sy) || !inBounds(w, h, tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  if (blocked[ty * w + tx]) return null;

  const n = w * h;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: number[] = [];

  const heur = (x: number, y: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };

  const start = sy * w + sx;
  const goal = ty * w + tx;
  g[start] = 0;
  f[start] = heur(sx, sy);
  push(start);

  while (heap.length) {
    const cur = pop();
    if (cur === goal) {
      const path: Vec2[] = [];
      let i = cur;
      while (i !== start) {
        path.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
        i = came[i];
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(w, h, nx, ny)) continue;
      const ni = ny * w + nx;
      if (blocked[ni] || closed[ni]) continue;
      if (dx !== 0 && dy !== 0 && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        f[ni] = ng + heur(nx, ny);
        push(ni);
      }
    }
  }
  return null;
}
