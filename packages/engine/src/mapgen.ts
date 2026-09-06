import { hexArea, hexCentre, hexLine, hexNeighbours, worldSize, worldToHex } from './hex';
import { mulberry32 } from './rng';
import type { NodeDef, Spawn, TechTree } from './content';
import type { ResourceNode, Vec2 } from './types';

export interface GeneratedMap {
  nodes: Record<number, ResourceNode>;
  nextId: number;
  starts: Vec2[];
}

/**
 * Seeded map generation, in three passes so no start is left without its basics:
 *
 * 1. `rules.map.starts` start slots on a ring around the centre, evenly spaced
 *    at a random rotation. Players at the edges, the middle in between.
 * 2. Home zones: every slot gets each node type's `spawn.perStart` clusters or
 *    deposits somewhere between the start clearing and `rules.homeRadius`.
 * 3. The per-1000-tiles scatter from each `spawn` rule, anywhere on the map or,
 *    with `zone: 'centre'`, only in the middle fifth (contested resources).
 *
 * Positions are hexes (offset coordinates); radii are in hexes. Deterministic
 * for a given tree, seed and size.
 */
export function generateMap(tree: TechTree, seed: number, w: number, h: number): GeneratedMap {
  const rng = mulberry32(seed);
  const { rules } = tree;
  const nodes: Record<number, ResourceNode> = {};
  const occupied = new Set<number>();
  let nextId = 1;
  const per1000 = (w * h) / 1000;
  const TAU = Math.PI * 2;
  const size = worldSize(w, h);

  const place = (type: string, amount: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const key = y * w + x;
    if (occupied.has(key)) return;
    occupied.add(key);
    nodes[nextId] = { id: nextId, type, x, y, amount };
    nextId++;
  };

  /** Blob that is dense in the middle and thins out towards the edge. */
  const forest = (def: NodeDef, sp: Spawn & { kind: 'forest' }, cx: number, cy: number) => {
    const r = sp.radius[0] + rng() * (sp.radius[1] - sp.radius[0]);
    const centre = hexCentre(cx, cy);
    for (const t of hexArea(cx, cy, Math.ceil(r))) {
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

  // 1. Start slots. The ring leaves room for a whole home zone inside the map edge.
  const starts: Vec2[] = [];
  const margin = rules.homeRadius + 2;
  const rx = Math.max(4, size.x / 2 - margin);
  const ry = Math.max(4, size.y / 2 - margin);
  const rot = rng() * TAU;
  for (let i = 0; i < rules.map.starts; i++) {
    const a = rot + (i / rules.map.starts) * TAU;
    starts.push(hexAt(size.x / 2 + Math.cos(a) * rx, size.y / 2 + Math.sin(a) * ry));
  }
  // The start hexes themselves stay free: the starting building goes there.
  for (const s of starts) occupied.add(s.y * w + s.x);

  // 2. Home zones, placed first so they win the tiles. A cluster whose seed hex is
  //    already taken (a deposit landing in a forest) is re-rolled a few times.
  const inner = rules.startClearRadius + 1;
  const outer = Math.max(inner + 1, rules.homeRadius);
  for (const s of starts) {
    const c = hexCentre(s.x, s.y);
    for (const def of tree.nodes) {
      for (let k = 0; k < def.spawn.perStart; k++) {
        for (let tries = 0; tries < 8; tries++) {
          const a = rng() * TAU;
          const d = inner + rng() * (outer - inner);
          const t = hexAt(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d);
          if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= h || occupied.has(t.y * w + t.x)) continue;
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
      spawnAt(def, p.x, p.y);
    }
  }

  // 4. Connectivity. On a hex grid a ring of trees is a real wall (no diagonal
  //    gaps), so every start must be able to reach the map centre: any that
  //    cannot gets a one-hex corridor carved straight towards it.
  const centre = hexAt(size.x / 2, size.y / 2);
  const byTile = new Map<number, number>();
  for (const id in nodes) byTile.set(nodes[id].y * w + nodes[id].x, Number(id));
  for (const s of starts) {
    if (reaches(byTile, w, h, s, centre)) continue;
    for (const t of hexLine(s, centre)) {
      const id = byTile.get(t.y * w + t.x);
      if (id === undefined) continue;
      delete nodes[id];
      byTile.delete(t.y * w + t.x);
    }
  }

  return { nodes, nextId, starts };
}

/** Flood fill over free hexes: can `from` walk to `to`? */
function reaches(occupied: Map<number, number>, w: number, h: number, from: Vec2, to: Vec2): boolean {
  const target = to.y * w + to.x;
  if (occupied.has(target)) return false;
  const seen = new Uint8Array(w * h);
  const stack: Vec2[] = [from];
  seen[from.y * w + from.x] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    if (p.y * w + p.x === target) return true;
    for (const n of hexNeighbours(p.x, p.y)) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
      const i = n.y * w + n.x;
      if (seen[i] || occupied.has(i)) continue;
      seen[i] = 1;
      stack.push(n);
    }
  }
  return false;
}
