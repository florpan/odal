import type { Ref, TechTree } from './content';

// ---------------------------------------------------------------------------
// The tech graph: what leads to what.
//
// Nodes are units, buildings and techs. An edge A → B means "A must exist
// before B can be obtained": a building trains a unit or researches a tech,
// or something is listed in B's `requires`. This is the data a Civilization-
// style tree view renders, and what the validator uses to reject cycles and
// unobtainable content.
// ---------------------------------------------------------------------------

export type EdgeReason = 'trains' | 'researches' | 'requires';

export interface GraphEdge {
  from: Ref; // prerequisite
  to: Ref; // dependent
  reason: EdgeReason;
}

export interface TechGraph {
  nodes: Ref[];
  edges: GraphEdge[];
}

export const refKey = (r: Ref): string => `${r.kind}:${r.id}`;

export function parseRef(s: string): Ref | null {
  const [kind, id] = s.split(':');
  if ((kind === 'unit' || kind === 'building' || kind === 'tech') && id) return { kind, id };
  return null;
}

export function refName(tree: TechTree, ref: Ref): string {
  const list = ref.kind === 'unit' ? tree.units : ref.kind === 'building' ? tree.buildings : tree.techs;
  return list.find((x) => x.id === ref.id)?.name ?? ref.id;
}

export function buildGraph(tree: TechTree): TechGraph {
  const nodes: Ref[] = [
    ...tree.units.map((u): Ref => ({ kind: 'unit', id: u.id })),
    ...tree.buildings.map((b): Ref => ({ kind: 'building', id: b.id })),
    ...tree.techs.map((t): Ref => ({ kind: 'tech', id: t.id })),
  ];
  const edges: GraphEdge[] = [];
  const req = (to: Ref, requires: { type: 'tech' | 'building'; id: string }[]) => {
    for (const r of requires) edges.push({ from: { kind: r.type, id: r.id }, to, reason: 'requires' });
  };
  for (const b of tree.buildings) {
    const me: Ref = { kind: 'building', id: b.id };
    for (const u of b.trains) edges.push({ from: me, to: { kind: 'unit', id: u }, reason: 'trains' });
    for (const t of b.researches) edges.push({ from: me, to: { kind: 'tech', id: t }, reason: 'researches' });
    req(me, b.requires);
  }
  for (const u of tree.units) req({ kind: 'unit', id: u.id }, u.requires);
  for (const t of tree.techs) req({ kind: 'tech', id: t.id }, t.requires);
  return { nodes, edges };
}

/** Everything that must exist before `target`, in an order you could obtain them in. */
export function prerequisites(tree: TechTree, target: Ref): Ref[] {
  const graph = buildGraph(tree);
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const k = refKey(e.to);
    if (!incoming.has(k)) incoming.set(k, []);
    incoming.get(k)!.push(e);
  }
  // Collect ancestors.
  const seen = new Map<string, Ref>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of incoming.get(refKey(cur)) ?? []) {
      const k = refKey(e.from);
      if (!seen.has(k)) {
        seen.set(k, e.from);
        stack.push(e.from);
      }
    }
  }
  // Topological order within the ancestor set (Kahn).
  const inDeg = new Map<string, number>();
  for (const k of seen.keys()) inDeg.set(k, 0);
  for (const e of graph.edges) {
    if (seen.has(refKey(e.from)) && seen.has(refKey(e.to))) inDeg.set(refKey(e.to), (inDeg.get(refKey(e.to)) ?? 0) + 1);
  }
  const queue = [...seen.keys()].filter((k) => inDeg.get(k) === 0).sort();
  const order: Ref[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    order.push(seen.get(k)!);
    for (const e of graph.edges) {
      if (refKey(e.from) !== k || !seen.has(refKey(e.to))) continue;
      const tk = refKey(e.to);
      inDeg.set(tk, inDeg.get(tk)! - 1);
      if (inDeg.get(tk) === 0) queue.push(tk);
    }
  }
  return order;
}

/** A cycle in the graph as a list of refs, or null when the graph is a DAG. */
export function findCycle(graph: TechGraph): Ref[] | null {
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const k = refKey(e.from);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(e);
  }
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const path: Ref[] = [];
  const visit = (n: Ref): Ref[] | null => {
    const k = refKey(n);
    if (state.get(k) === 2) return null;
    if (state.get(k) === 1) {
      const i = path.findIndex((p) => refKey(p) === k);
      return [...path.slice(i), n];
    }
    state.set(k, 1);
    path.push(n);
    for (const e of out.get(k) ?? []) {
      const c = visit(e.to);
      if (c) return c;
    }
    path.pop();
    state.set(k, 2);
    return null;
  };
  for (const n of graph.nodes) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

/**
 * Refs that can never be obtained from the starting position: a unit nobody
 * trains, a tech nobody researches, or anything whose requirements are
 * themselves unobtainable. A node is obtainable when every prerequisite is.
 */
export function unobtainable(tree: TechTree, graph: TechGraph): Ref[] {
  const have = new Set<string>([`building:${tree.start.building}`, ...tree.start.units.map((u) => `unit:${u.type}`)]);
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const k = refKey(e.to);
    if (!incoming.has(k)) incoming.set(k, []);
    incoming.get(k)!.push(e);
  }
  const needsProducer = (r: Ref) => r.kind !== 'building'; // units need a trainer, techs a researcher
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of graph.nodes) {
      const k = refKey(n);
      if (have.has(k)) continue;
      const inc = incoming.get(k) ?? [];
      const producer = inc.some((e) => e.reason !== 'requires');
      if (needsProducer(n) && !producer) continue;
      if (inc.every((e) => have.has(refKey(e.from)))) {
        have.add(k);
        changed = true;
      }
    }
  }
  return graph.nodes.filter((n) => !have.has(refKey(n)));
}

/** Mermaid flowchart source for the whole graph, or highlighted around a target. */
export function toMermaid(tree: TechTree, graph: TechGraph, highlight?: Ref): string {
  const lines = ['flowchart LR'];
  const shape = (r: Ref, label: string) =>
    r.kind === 'unit' ? `([${label}])` : r.kind === 'tech' ? `{{${label}}}` : `[${label}]`;
  const id = (r: Ref) => `${r.kind}_${r.id}`;
  const keep = new Set<string>();
  if (highlight) {
    keep.add(refKey(highlight));
    for (const p of prerequisites(tree, highlight)) keep.add(refKey(p));
  }
  for (const n of graph.nodes) {
    if (highlight && !keep.has(refKey(n))) continue;
    lines.push(`  ${id(n)}${shape(n, refName(tree, n))}`);
  }
  for (const e of graph.edges) {
    if (highlight && !(keep.has(refKey(e.from)) && keep.has(refKey(e.to)))) continue;
    const arrow = e.reason === 'requires' ? '-.->' : '-->';
    lines.push(`  ${id(e.from)} ${arrow}|${e.reason}| ${id(e.to)}`);
  }
  if (highlight) lines.push(`  style ${id(highlight)} stroke:#f90,stroke-width:3px`);
  return lines.join('\n');
}
