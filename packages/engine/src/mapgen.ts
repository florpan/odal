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
 * Deterministic for a given tree, seed and size.
 */
export function generateMap(tree: TechTree, seed: number, w: number, h: number): GeneratedMap {
  const rng = mulberry32(seed);
  const { rules } = tree;
  const nodes: Record<number, ResourceNode> = {};
  const occupied = new Set<number>();
  let nextId = 1;
  const per1000 = (w * h) / 1000;
  const TAU = Math.PI * 2;

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
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1) continue;
        if (rng() < 1 - d * d * 0.85) place(def.id, def.amount, cx + dx, cy + dy);
      }
    }
  };

  /** A seed rock plus a short random walk of neighbours. */
  const deposit = (def: NodeDef, sp: Spawn & { kind: 'deposit' }, x: number, y: number) => {
    const size = sp.size[0] + Math.floor(rng() * (sp.size[1] - sp.size[0] + 1));
    for (let n = 0; n < size; n++) {
      place(def.id, def.amount, x, y);
      x += Math.floor(rng() * 3) - 1;
      y += Math.floor(rng() * 3) - 1;
    }
  };

  const spawnAt = (def: NodeDef, x: number, y: number) =>
    def.spawn.kind === 'forest' ? forest(def, def.spawn, x, y) : deposit(def, def.spawn, x, y);

  // 1. Start slots. The ring leaves room for a whole home zone inside the map edge.
  const starts: Vec2[] = [];
  const margin = rules.homeRadius + 2;
  const rx = Math.max(4, w / 2 - margin);
  const ry = Math.max(4, h / 2 - margin);
  const rot = rng() * TAU;
  for (let i = 0; i < rules.map.starts; i++) {
    const a = rot + (i / rules.map.starts) * TAU;
    starts.push({ x: Math.round(w / 2 + Math.cos(a) * rx), y: Math.round(h / 2 + Math.sin(a) * ry) });
  }

  // 2. Home zones, placed first so they win the tiles.
  const inner = rules.startClearRadius + 1;
  const outer = Math.max(inner + 1, rules.homeRadius);
  for (const s of starts) {
    for (const def of tree.nodes) {
      for (let k = 0; k < def.spawn.perStart; k++) {
        const a = rng() * TAU;
        const d = inner + rng() * (outer - inner);
        spawnAt(def, Math.round(s.x + Math.cos(a) * d), Math.round(s.y + Math.sin(a) * d));
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

  return { nodes, nextId, starts };
}
