import { hexArea, hexCentre, hexDistance, hexLine, hexNeighbours, worldSize, worldToHex } from './hex';
import { terrainNoise } from './noise';
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
 *    becomes an island with a wandering coastline and `island.water` outside.
 * 1. `rules.map.starts` start slots on a ring around the centre, evenly spaced
 *    at a random rotation, on land. Players at the edges, the middle in between.
 * 2. Home zones: every slot gets each node type's `spawn.perStart` clusters or
 *    deposits somewhere between the start clearing and `rules.homeRadius`.
 * 3. The per-1000-land-hexes scatter from each `spawn` rule, anywhere on land
 *    or, with `zone: 'centre'`, only in the middle fifth (contested resources).
 * 4. Connectivity: a corridor is carved for any start that cannot reach the centre.
 * 5. Relief: quantised noise gives every land hex an elevation step; the shore
 *    stays flat and no hex is more than one step above a neighbour.
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

  // 0. Terrain.
  const groundIdx = tree.terrain.findIndex((t) => t.id === rules.map.ground);
  const terrain: number[] = new Array<number>(w * h).fill(groundIdx);
  const island = rules.map.island;
  /** How far inland (in world units, along each axis) the coast is guaranteed to be. */
  let landX = cx;
  let landY = cy;
  if (island) {
    const waterIdx = tree.terrain.findIndex((t) => t.id === island.water);
    // Coastline: a radius of 1 - shore in normalised ellipse space, plus a few harmonics.
    const waves = [2, 3, 5, 7].map((k) => ({ k, amp: (0.4 + rng() * 0.6) / k, phase: rng() * TAU }));
    const coast = (a: number) => {
      let n = 0;
      for (const wv of waves) n += wv.amp * Math.sin(wv.k * a + wv.phase);
      return 1 - island.shore + island.roughness * n;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = hexCentre(x, y);
        const nx = (c.x - cx) / cx;
        const ny = (c.y - cy) / cy;
        const d = Math.hypot(nx, ny);
        if (d >= coast(Math.atan2(ny, nx))) {
          terrain[y * w + x] = waterIdx;
          occupied.add(y * w + x);
        }
      }
    }
    const inland = 1 - island.shore - island.roughness * 1.2;
    landX = cx * inland;
    landY = cy * inland;
  }

  const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === groundIdx;
  const landCount = terrain.filter((t) => t === groundIdx).length;
  const per1000 = landCount / 1000;

  const place = (type: string, amount: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
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
  const centre = hexAt(cx, cy);

  // 1. Start slots. The ring leaves room for a whole home zone inside the coast (or map edge).
  const starts: Vec2[] = [];
  const margin = rules.homeRadius + 2;
  const rx = Math.max(4, landX - margin);
  const ry = Math.max(4, landY - margin);
  const rot = rng() * TAU;
  for (let i = 0; i < rules.map.starts; i++) {
    const a = rot + (i / rules.map.starts) * TAU;
    let s = hexAt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    // Should the coast have wandered this far in, step inland until on land.
    if (!isLand(s.x, s.y)) s = hexLine(s, centre).find((t) => isLand(t.x, t.y)) ?? centre;
    starts.push(s);
  }
  // The start hexes themselves stay free: the starting building goes there.
  for (const s of starts) occupied.add(s.y * w + s.x);

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
          if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h || occupied.has(t.y * w + t.x)) continue;
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
  //    gaps), so every start must be able to reach the map centre: any that
  //    cannot gets a one-hex corridor carved straight towards it (through
  //    water too, as a causeway).
  const byTile = new Map<number, number>();
  for (const id in nodes) byTile.set(nodes[id].y * w + nodes[id].x, Number(id));
  const blockedAt = (i: number) => byTile.has(i) || terrain[i] !== groundIdx;
  for (const s of starts) {
    if (reaches(blockedAt, w, h, s, centre)) continue;
    for (const t of hexLine(s, centre)) {
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
    const land = Array.from(values.filter((_, i) => terrain[i] === groundIdx)).sort((a, b) => a - b);
    const weights = Array.from({ length: relief.levels }, (_, k) => relief.levels - k);
    const total = weights.reduce((a, b) => a + b, 0);
    const thresholds: number[] = [];
    let cum = 0.45;
    for (const wgt of weights) {
      thresholds.push(land[Math.min(land.length - 1, Math.floor(cum * land.length))] ?? Infinity);
      cum += (0.55 * wgt) / total;
    }
    for (let i = 0; i < w * h; i++) {
      if (terrain[i] !== groundIdx) continue;
      let level = 0;
      for (const t of thresholds) if (values[i] >= t) level++;
      elevation[i] = level;
    }
    // The beach is flat, and every slope is a single step.
    for (let i = 0; i < w * h; i++) {
      if (terrain[i] !== groundIdx) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (
        hexNeighbours(x, y).some(
          (n) => n.x >= 0 && n.y >= 0 && n.x < w && n.y < h && terrain[n.y * w + n.x] !== groundIdx,
        )
      )
        elevation[i] = 0;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < w * h; i++) {
        if (elevation[i] === 0) continue;
        const x = i % w;
        const y = Math.floor(i / w);
        let lowest = elevation[i];
        for (const n of hexNeighbours(x, y)) {
          if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
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
