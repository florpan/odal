import { hexArea, hexCentre, hexDistance, hexLine, hexNeighbours, hexRing, worldSize, worldToHex } from './hex';
import { fractalNoise, terrainNoise } from './noise';
import { mulberry32 } from './rng';
import type { NodeDef, Spawn, TechTree } from './content';
import type { ResourceNode, Vec2 } from './types';

export interface GeneratedMap {
  /** Per hex: index into `tree.terrain`. */
  terrain: number[];
  /** Per hex: elevation in steps (0 without `rules.map.relief`). */
  elevation: number[];
  nodes: Record<number, ResourceNode>;
  nextId: number;
  starts: Vec2[];
}

/**
 * Seeded map generation, in passes so no start is left without its basics:
 *
 * 0. Terrain: every hex is `rules.map.ground`; with `rules.map.island` the map
 *    becomes an island: 2D noise cut at a quantile so `island.land` of the map is
 *    land, pushed under water towards the edge so the sea surrounds it, and only
 *    the largest landmass kept. Bays, inlets and peninsulas; the shape says
 *    nothing about where the middle is.
 * 1. `rules.map.starts` start slots on a ring around the centre, evenly spaced
 *    at a random rotation, on land. Players at the edges, the middle in between.
 * 1b. Features: `rules.map.features` clumps of other terrain (hills, mountains)
 *    random-walked over the ground, away from the start clearings.
 * 2. Home zones: every slot gets each node type's `spawn.perStart` clusters or
 *    deposits somewhere between the start clearing and `rules.homeRadius`.
 * 3. The per-1000-land-hexes scatter from each `spawn` rule, anywhere on land
 *    or, with `zone: 'centre'`, only in the middle fifth (contested resources).
 * 4. Connectivity: a corridor is carved for any start that cannot reach the centre.
 * 5. Relief: quantised noise, independent of the coast, gives every land hex an
 *    elevation step; land hexes differ by at most one step from each other, but
 *    the coast keeps its height, so high ground meets the sea as a cliff.
 *
 * Positions are hexes (offset coordinates); radii are in hexes. Deterministic
 * for a given tree, seed and size.
 */
export function generateMap(tree: TechTree, seed: number, w: number, h: number): GeneratedMap {
  const rng = mulberry32(seed);
  const { rules } = tree;
  const nodes: Record<number, ResourceNode> = {};
  /** Hexes nothing can spawn on: water and already placed nodes. */
  const occupied = new Set<number>();
  let nextId = 1;
  const TAU = Math.PI * 2;
  const size = worldSize(w, h);
  const cx = size.x / 2;
  const cy = size.y / 2;
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // 0. Terrain.
  const groundIdx = tree.terrain.findIndex((t) => t.id === rules.map.ground);
  const terrain: number[] = new Array<number>(w * h).fill(groundIdx);
  const island = rules.map.island;
  const waterIdx = island ? tree.terrain.findIndex((t) => t.id === island.water) : -1;
  const isWater = (i: number) => terrain[i] === waterIdx;
  /** How far out (fraction of the half-size) land may reach before the sea band. */
  const edge = island ? 1 - island.shore : 1;
  if (island) {
    // Score every hex: fractal coast noise minus a gentle push-down that grows from a third of the way
    // out to the edge. The push is weak enough that the noise decides where the coast is, so the
    // outline wanders far in and out; only the sea band at the edge is certain. The distance is a
    // rounded square rather than a circle so land can reach into the corners.
    const score = new Float64Array(w * h).fill(-Infinity);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = hexCentre(x, y);
        const nx = Math.abs((c.x - cx) / cx);
        const ny = Math.abs((c.y - cy) / cy);
        // The sea band's inner edge wanders too, so land never runs straight along it; the outermost
        // few hexes are always sea so the map's rectangle never shows.
        const raw = Math.cbrt(nx * nx * nx + ny * ny * ny);
        const d = raw + (fractalNoise(c.x, c.y, island.scale, seed + 401, 3) - 0.5) * 0.5;
        if (d >= edge || raw >= 0.96) continue;
        // The noise spreads about ±0.12 around 0.5, so the bias must be of that order or it decides
        // the coast by itself; only the last tenth before the sea band gets a wall.
        const push = smoothstep(edge * 0.5, edge, d) * 0.15 + smoothstep(edge * 0.9, edge, d);
        // Domain warp: sample the coast noise at a point displaced by two more noise fields, which
        // turns its round lobes into peninsulas, fjords and bays.
        const warp = island.scale * 0.8;
        const wx = (fractalNoise(c.x, c.y, island.scale, seed + 201, 3) - 0.5) * warp;
        const wy = (fractalNoise(c.x, c.y, island.scale, seed + 301, 3) - 0.5) * warp;
        score[y * w + x] = fractalNoise(c.x + wx, c.y + wy, island.scale, seed + 101) - push;
      }
    }
    // Land is the best-scoring `island.land` of the map, so the amount of land is the same on every
    // seed. Only the largest landmass survives; if the cut left it well short of that (two masses of
    // similar size), lower the water a little and try again until they join.
    const inside = Array.from(score.filter((s) => s > -Infinity)).sort((a, b) => a - b);
    const wanted = Math.round(island.land * w * h);
    for (let extra = 0; extra <= 0.3; extra += 0.05) {
      const n = Math.round(wanted * (1 + extra));
      const threshold = n >= inside.length ? -Infinity : inside[inside.length - n];
      for (let i = 0; i < w * h; i++) terrain[i] = score[i] < threshold ? waterIdx : groundIdx;
      keepLargestLandmass(terrain, groundIdx, waterIdx, w, h);
      if (terrain.filter((t) => t === groundIdx).length >= wanted * 0.85) break;
    }
    // One sea: water that does not touch the map edge is land.
    fillLakes(terrain, groundIdx, waterIdx, w, h);
    for (let i = 0; i < w * h; i++) if (isWater(i)) occupied.add(i);
  }

  const isLand = (x: number, y: number) => inMap(x, y) && terrain[y * w + x] === groundIdx;
  const landCount = terrain.filter((t) => t === groundIdx).length;
  const per1000 = landCount / 1000;

  const place = (type: string, amount: number, x: number, y: number) => {
    if (!inMap(x, y)) return;
    const key = y * w + x;
    if (occupied.has(key)) return;
    occupied.add(key);
    nodes[nextId] = { id: nextId, type, x, y, amount };
    nextId++;
  };

  /** Blob that is dense in the middle and thins out towards the edge. */
  const forest = (def: NodeDef, sp: Spawn & { kind: 'forest' }, fx: number, fy: number) => {
    const r = sp.radius[0] + rng() * (sp.radius[1] - sp.radius[0]);
    const centre = hexCentre(fx, fy);
    for (const t of hexArea(fx, fy, Math.ceil(r))) {
      const c = hexCentre(t.x, t.y);
      const d = Math.hypot(c.x - centre.x, c.y - centre.y) / r;
      if (d > 1) continue;
      if (rng() < 1 - d * d * 0.85) place(def.id, def.amount, t.x, t.y);
    }
  };

  /** A seed rock plus a short random walk of neighbours. */
  const deposit = (def: NodeDef, sp: Spawn & { kind: 'deposit' }, x: number, y: number) => {
    const count = sp.size[0] + Math.floor(rng() * (sp.size[1] - sp.size[0] + 1));
    for (let n = 0; n < count; n++) {
      place(def.id, def.amount, x, y);
      const next = hexNeighbours(x, y)[Math.floor(rng() * 6)];
      x = next.x;
      y = next.y;
    }
  };

  const spawnAt = (def: NodeDef, x: number, y: number) =>
    def.spawn.kind === 'forest' ? forest(def, def.spawn, x, y) : deposit(def, def.spawn, x, y);

  /** The hex under a world position. */
  const hexAt = (x: number, y: number) => worldToHex({ x, y });
  /** The land hex nearest to `p` (p itself when it is land). */
  const nearestLand = (p: Vec2): Vec2 => {
    for (let r = 0; r < Math.max(w, h); r++) {
      const hit = hexRing(p.x, p.y, r).find((t) => isLand(t.x, t.y));
      if (hit) return hit;
    }
    return p;
  };
  /** The middle of the map, or the land nearest to it: what every start must be able to reach. */
  const centre = nearestLand(hexAt(cx, cy));

  // 1. Start slots. The ring leaves room for a whole home zone inside the sea band (or map edge).
  const starts: Vec2[] = [];
  const margin = rules.homeRadius + 2;
  const rx = Math.max(4, cx * edge * 0.9 - margin);
  const ry = Math.max(4, cy * edge * 0.9 - margin);
  const rot = rng() * TAU;
  for (let i = 0; i < rules.map.starts; i++) {
    const a = rot + (i / rules.map.starts) * TAU;
    let s = hexAt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    // Should the coast have wandered this far in, step towards the middle until on land.
    if (!isLand(s.x, s.y)) s = hexLine(s, centre).find((t) => isLand(t.x, t.y)) ?? nearestLand(s);
    starts.push(s);
  }
  // The start hexes themselves stay free: the starting building goes there.
  for (const s of starts) occupied.add(s.y * w + s.x);

  // 1b. Features: clumps of hills, mountains, ... on the ground, clear of the start clearings.
  //     They join `occupied` so no node spawns on them.
  const nearStart = (x: number, y: number) =>
    starts.some((s) => hexDistance(s, { x, y }) <= rules.startClearRadius + 1);
  for (const f of rules.map.features) {
    const fIdx = tree.terrain.findIndex((t) => t.id === f.terrain);
    const count = Math.round(f.per1000 * per1000);
    for (let k = 0; k < count; k++) {
      let x = 2 + Math.floor(rng() * (w - 4));
      let y = 2 + Math.floor(rng() * (h - 4));
      const n = f.size[0] + Math.floor(rng() * (f.size[1] - f.size[0] + 1));
      for (let step = 0; step < n; step++) {
        const i = y * w + x;
        if (isLand(x, y) && !occupied.has(i) && !nearStart(x, y)) {
          terrain[i] = fIdx;
          occupied.add(i);
        }
        const next = hexNeighbours(x, y)[Math.floor(rng() * 6)];
        x = next.x;
        y = next.y;
      }
    }
  }

  // 2. Home zones, placed first so they win the tiles. A cluster whose seed hex is
  //    already taken (water, or a deposit landing in a forest) is re-rolled a few times.
  const inner = rules.startClearRadius + 1;
  const outer = Math.max(inner + 1, rules.homeRadius);
  for (const s of starts) {
    const c = hexCentre(s.x, s.y);
    for (const def of tree.nodes) {
      for (let k = 0; k < def.spawn.perStart; k++) {
        for (let tries = 0; tries < 12; tries++) {
          const a = rng() * TAU;
          const d = inner + rng() * (outer - inner);
          const t = hexAt(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d);
          if (!inMap(t.x, t.y) || occupied.has(t.y * w + t.x)) continue;
          if (hexDistance(t, s) > rules.homeRadius) continue; // world distance rounds up to one hex more
          spawnAt(def, t.x, t.y);
          break;
        }
      }
    }
  }

  // 3. Scatter.
  const randomIn = (zone: Spawn['zone']): Vec2 => {
    if (zone === 'centre') {
      return {
        x: Math.floor(w / 2 + (rng() - 0.5) * w * 0.4),
        y: Math.floor(h / 2 + (rng() - 0.5) * h * 0.4),
      };
    }
    return { x: 2 + Math.floor(rng() * (w - 4)), y: 2 + Math.floor(rng() * (h - 4)) };
  };
  for (const def of tree.nodes) {
    const sp = def.spawn;
    const count = Math.round((sp.kind === 'forest' ? sp.clustersPer1000Tiles : sp.depositsPer1000Tiles) * per1000);
    for (let i = 0; i < count; i++) {
      const p = randomIn(sp.zone);
      if (isLand(p.x, p.y)) spawnAt(def, p.x, p.y);
    }
  }

  // 4. Connectivity. On a hex grid a ring of trees is a real wall (no diagonal
  //    gaps), so every start must be able to reach the middle: any that cannot
  //    gets a one-hex corridor carved along the cheapest route, through trees
  //    and features first and through water (a causeway) only when it must.
  const byTile = new Map<number, number>();
  for (const id in nodes) byTile.set(nodes[id].y * w + nodes[id].x, Number(id));
  const blockedAt = (i: number) => byTile.has(i) || !tree.terrain[terrain[i]].passable;
  const costAt = (i: number) => (isWater(i) ? 8 : blockedAt(i) ? 3 : 1);
  for (const s of starts) {
    if (reaches(blockedAt, w, h, s, centre)) continue;
    for (const t of corridor(costAt, w, h, s, centre)) {
      const i = t.y * w + t.x;
      const id = byTile.get(i);
      if (id !== undefined) {
        delete nodes[id];
        byTile.delete(i);
      }
      terrain[i] = groundIdx;
    }
  }

  // 5. Relief.
  const elevation: number[] = new Array<number>(w * h).fill(0);
  const relief = rules.map.relief;
  if (relief) {
    const values = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const c = hexCentre(i % w, Math.floor(i / w));
      values[i] = terrainNoise(c.x, c.y, relief.scale, seed);
    }
    // Thresholds at quantiles of the land values, so the mix of levels is the same on every map:
    // level 0 is the lowest 45%, the rest is shared out with the higher levels rarer.
    const land = Array.from(values.filter((_, i) => !isWater(i))).sort((a, b) => a - b);
    const weights = Array.from({ length: relief.levels }, (_, k) => relief.levels - k);
    const total = weights.reduce((a, b) => a + b, 0);
    const thresholds: number[] = [];
    let cum = 0.45;
    for (const wgt of weights) {
      thresholds.push(land[Math.min(land.length - 1, Math.floor(cum * land.length))] ?? Infinity);
      cum += (0.55 * wgt) / total;
    }
    for (let i = 0; i < w * h; i++) {
      if (isWater(i)) continue;
      let level = 0;
      for (const t of thresholds) if (values[i] >= t) level++;
      elevation[i] = level;
    }
    // Every slope between land hexes is a single step. Water does not count: the sea stays at 0 and
    // high ground meets it as a cliff.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < w * h; i++) {
        if (elevation[i] === 0 || isWater(i)) continue;
        const x = i % w;
        const y = Math.floor(i / w);
        let lowest = elevation[i];
        for (const n of hexNeighbours(x, y)) {
          if (!inMap(n.x, n.y) || isWater(n.y * w + n.x)) continue;
          lowest = Math.min(lowest, elevation[n.y * w + n.x]);
        }
        if (elevation[i] > lowest + 1) {
          elevation[i] = lowest + 1;
          changed = true;
        }
      }
    }
  }

  return { terrain, elevation, nodes, nextId, starts };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Turn every patch of `ground` but the largest connected one into `water`. */
function keepLargestLandmass(terrain: number[], ground: number, water: number, w: number, h: number) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (terrain[start] !== ground || label[start] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      for (const n of hexNeighbours(i % w, Math.floor(i / w))) {
        if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
        const j = n.y * w + n.x;
        if (terrain[j] !== ground || label[j] >= 0) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    sizes.push(count);
  }
  if (sizes.length < 2) return;
  const largest = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < w * h; i++) if (label[i] >= 0 && label[i] !== largest) terrain[i] = water;
}

/** Turn every patch of `water` that does not reach the map edge into `ground`. */
function fillLakes(terrain: number[], ground: number, water: number, w: number, h: number) {
  const sea = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    if (terrain[i] === water && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) {
      sea[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    for (const n of hexNeighbours(i % w, Math.floor(i / w))) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
      const j = n.y * w + n.x;
      if (terrain[j] !== water || sea[j]) continue;
      sea[j] = 1;
      stack.push(j);
    }
  }
  for (let i = 0; i < w * h; i++) if (terrain[i] === water && !sea[i]) terrain[i] = ground;
}

/** Flood fill over free hexes: can `from` walk to `to`? */
function reaches(blockedAt: (i: number) => boolean, w: number, h: number, from: Vec2, to: Vec2): boolean {
  const target = to.y * w + to.x;
  if (blockedAt(target)) return false;
  const seen = new Uint8Array(w * h);
  const stack: Vec2[] = [from];
  seen[from.y * w + from.x] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    if (p.y * w + p.x === target) return true;
    for (const n of hexNeighbours(p.x, p.y)) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
      const i = n.y * w + n.x;
      if (seen[i] || blockedAt(i)) continue;
      seen[i] = 1;
      stack.push(n);
    }
  }
  return false;
}

/** The cheapest route from `from` to `to` (Dijkstra over `costAt` per hex entered), both included. */
function corridor(costAt: (i: number) => number, w: number, h: number, from: Vec2, to: Vec2): Vec2[] {
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const start = from.y * w + from.x;
  const target = to.y * w + to.x;
  dist[start] = 0;
  // A binary heap of [distance, hex]; stale entries are skipped via `done`.
  const heap: [number, number][] = [[0, start]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === target) break;
    for (const nb of hexNeighbours(i % w, Math.floor(i / w))) {
      if (nb.x < 0 || nb.y < 0 || nb.x >= w || nb.y >= h) continue;
      const j = nb.y * w + nb.x;
      const nd = d + costAt(j);
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        push([nd, j]);
      }
    }
  }
  const path: Vec2[] = [];
  for (let i = target; i >= 0; i = prev[i]) {
    path.push({ x: i % w, y: Math.floor(i / w) });
    if (i === start) break;
  }
  return path.reverse();
}
