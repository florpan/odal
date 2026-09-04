import { mulberry32 } from './rng';
import type { TechTree } from './content';
import type { ResourceNode } from './types';

export interface GeneratedMap {
  nodes: Record<number, ResourceNode>;
  nextId: number;
}

/**
 * Scatters every node type of the tech tree over the map according to its
 * `spawn` rule. Deterministic for a given tree, seed and size.
 */
export function generateMap(tree: TechTree, seed: number, w: number, h: number): GeneratedMap {
  const rng = mulberry32(seed);
  const nodes: Record<number, ResourceNode> = {};
  const occupied = new Set<number>();
  let nextId = 1;
  const per1000 = (w * h) / 1000;

  const place = (type: string, amount: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const key = y * w + x;
    if (occupied.has(key)) return;
    occupied.add(key);
    nodes[nextId] = { id: nextId, type, x, y, amount };
    nextId++;
  };

  for (const def of tree.nodes) {
    const sp = def.spawn;
    if (sp.kind === 'forest') {
      // Blobs that are dense in the middle and thin out towards the edge.
      const count = Math.round(sp.clustersPer1000Tiles * per1000);
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(rng() * w);
        const cy = Math.floor(rng() * h);
        const r = sp.radius[0] + rng() * (sp.radius[1] - sp.radius[0]);
        const ri = Math.ceil(r);
        for (let dy = -ri; dy <= ri; dy++) {
          for (let dx = -ri; dx <= ri; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy) / r;
            if (d > 1) continue;
            if (rng() < 1 - d * d * 0.85) place(def.id, def.amount, cx + dx, cy + dy);
          }
        }
      }
    } else {
      // A seed rock plus a short random walk of neighbours.
      const count = Math.round(sp.depositsPer1000Tiles * per1000);
      for (let i = 0; i < count; i++) {
        let x = 2 + Math.floor(rng() * (w - 4));
        let y = 2 + Math.floor(rng() * (h - 4));
        const size = sp.size[0] + Math.floor(rng() * (sp.size[1] - sp.size[0] + 1));
        for (let n = 0; n < size; n++) {
          place(def.id, def.amount, x, y);
          x += Math.floor(rng() * 3) - 1;
          y += Math.floor(rng() * 3) - 1;
        }
      }
    }
  }

  return { nodes, nextId };
}
