import { hexCentre, hexDistance, hexNeighbours } from './hex';
import { inBounds } from './grid';
import type { Vec2 } from './types';

// ---------------------------------------------------------------------------
// Pathfinding, as a service: everything it knows about the world comes in
// through `NavGrid`, and the only caller is movement.ts (goTo). Per-unit
// variations (a lumbering brute that only walks straight lines, a scout that
// pays less for rough ground) belong here as extra parameters, never in the
// systems that ask for a path.
// ---------------------------------------------------------------------------

/** The walkable world as one unit sees it: 1 = blocked, indexed row * width + col. */
export interface NavGrid {
  blocked: Uint8Array;
  width: number;
  height: number;
}

/**
 * A* over the hex grid. Returns the world positions (hex centres) to walk
 * through, start excluded and goal included, or null when the goal cannot be
 * reached. The start hex may be blocked (a unit standing where a building was
 * just placed) and is always allowed.
 */
export function findPath(nav: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const { blocked, width: w, height: h } = nav;
  const sx = from.x;
  const sy = from.y;
  const tx = to.x;
  const ty = to.y;
  if (!inBounds(w, h, sx, sy) || !inBounds(w, h, tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  if (blocked[ty * w + tx]) return null;

  const n = w * h;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: number[] = [];

  const heur = (x: number, y: number) => hexDistance({ x, y }, to);
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
        path.push(hexCentre(i % w, Math.floor(i / w)));
        i = came[i];
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const nb of hexNeighbours(cx, cy)) {
      if (!inBounds(w, h, nb.x, nb.y)) continue;
      const ni = nb.y * w + nb.x;
      if (blocked[ni] || closed[ni]) continue;
      const ng = g[cur] + 1;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        f[ni] = ng + heur(nb.x, nb.y);
        push(ni);
      }
    }
  }
  return null;
}
