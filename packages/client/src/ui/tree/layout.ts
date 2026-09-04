import dagre from '@dagrejs/dagre';
import type { TechGraph } from '@odal/engine';
import { refKey } from '@odal/engine';

// Layered left-to-right layout of the tech graph. Pure function: the same
// graph always gets the same positions, so the view is stable between renders.

export const NODE_W = 172;
export const NODE_H = 58;

export interface Placed {
  x: number;
  y: number;
}

export function layoutGraph(graph: TechGraph): Record<string, Placed> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 64, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(refKey(n), { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) g.setEdge(refKey(e.from), refKey(e.to));
  dagre.layout(g);
  const out: Record<string, Placed> = {};
  for (const n of graph.nodes) {
    const k = refKey(n);
    const p = g.node(k);
    out[k] = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }
  return out;
}
