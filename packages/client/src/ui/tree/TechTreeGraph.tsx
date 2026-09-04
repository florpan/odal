import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { buildGraph, idx, parseRef, refDef, refKey } from '@odal/engine';
import type { GraphEdge, Ref, TechGraph, TechTree } from '@odal/engine';
import { layoutGraph } from './layout';
import '@xyflow/react/dist/style.css';
import './tree.css';

// ---------------------------------------------------------------------------
// The tech tree as an interactive graph. Shared by the in-game tech tree
// screen (read-only, coloured by what the player has) and the content editor
// (editable: drag between nodes to add a dependency, select an edge and press
// Delete to remove one). Everything it shows is derived from a TechTree.
// ---------------------------------------------------------------------------

/** How far a player is from having something. */
export type RefStatus = 'owned' | 'inProgress' | 'available' | 'locked';

export interface TreeNodeData extends Record<string, unknown> {
  ref: Ref;
  name: string;
  cost: string;
  status?: RefStatus;
  selected: boolean;
  dimmed: boolean;
}

export interface TechTreeGraphProps {
  tree: TechTree;
  /** refKey → status; omit for a neutral (editor) view. */
  status?: Record<string, RefStatus>;
  /** refKey of the selected node. */
  selected?: string | null;
  onSelect?: (ref: Ref | null) => void;
  /** Editing: drag from a prerequisite to a dependent. */
  editable?: boolean;
  onConnect?: (from: Ref, to: Ref) => void;
  onDeleteEdges?: (edges: GraphEdge[]) => void;
}

const KIND_LABEL: Record<Ref['kind'], string> = { unit: 'Unit', building: 'Building', tech: 'Tech' };

function shortCost(tree: TechTree, cost: Record<string, number>): string {
  const i = idx(tree);
  const parts = i.resourceIds.filter((r) => (cost[r] ?? 0) > 0).map((r) => `${i.resources[r].icon || r} ${cost[r]}`);
  return parts.join('  ');
}

const TreeNode = memo(function TreeNode({ data }: NodeProps<Node<TreeNodeData>>) {
  const cls = ['tree-node', `kind-${data.ref.kind}`];
  if (data.status) cls.push(`status-${data.status}`);
  if (data.selected) cls.push('is-selected');
  if (data.dimmed) cls.push('is-dimmed');
  return (
    <div className={cls.join(' ')}>
      <Handle type="target" position={Position.Left} />
      <div className="tree-node-kind">{KIND_LABEL[data.ref.kind]}</div>
      <div className="tree-node-name">{data.name}</div>
      <div className="tree-node-cost">{data.cost || 'free'}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = { tree: TreeNode };

function edgeId(e: GraphEdge): string {
  return `${refKey(e.from)}>${refKey(e.to)}:${e.reason}`;
}

function toEdges(graph: TechGraph, selected: string | null | undefined): Edge[] {
  return graph.edges.map((e) => {
    const touching =
      selected !== null && selected !== undefined && (refKey(e.from) === selected || refKey(e.to) === selected);
    return {
      id: edgeId(e),
      source: refKey(e.from),
      target: refKey(e.to),
      label: e.reason,
      className: `tree-edge reason-${e.reason}${touching ? ' is-touching' : ''}`,
      animated: e.reason !== 'requires' && touching,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      data: { edge: e },
    };
  });
}

export function TechTreeGraph({
  tree,
  status,
  selected,
  onSelect,
  editable,
  onConnect,
  onDeleteEdges,
}: TechTreeGraphProps) {
  const graph = useMemo(() => buildGraph(tree), [tree]);
  // Positions only change when the shape of the graph changes; dragging a node around survives data edits.
  const structureKey = useMemo(
    () => graph.nodes.map(refKey).join('|') + '#' + graph.edges.map(edgeId).join('|'),
    [graph],
  );
  const positions = useMemo(() => layoutGraph(graph), [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!selected) return set;
    set.add(selected);
    for (const e of graph.edges) {
      if (refKey(e.from) === selected) set.add(refKey(e.to));
      if (refKey(e.to) === selected) set.add(refKey(e.from));
    }
    return set;
  }, [graph, selected]);

  const makeNodes = useCallback(
    (prev: Node<TreeNodeData>[]): Node<TreeNodeData>[] => {
      const keep = new Map(prev.map((n) => [n.id, n.position]));
      return graph.nodes.map((ref) => {
        const k = refKey(ref);
        const def = refDef(tree, ref);
        return {
          id: k,
          type: 'tree',
          position: keep.get(k) ?? positions[k],
          data: {
            ref,
            name: def?.name ?? ref.id,
            cost: def ? shortCost(tree, def.cost) : '',
            status: status?.[k],
            selected: selected === k,
            dimmed: !!selected && !neighbours.has(k),
          },
          draggable: true,
          connectable: !!editable,
        };
      });
    },
    [graph, tree, positions, status, selected, neighbours, editable],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TreeNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // New layout when the structure changes; otherwise refresh data and keep positions.
  useEffect(() => {
    setNodes(() => makeNodes([]));
  }, [structureKey, setNodes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNodes((prev) => makeNodes(prev));
  }, [makeNodes, setNodes]);
  useEffect(() => {
    setEdges(toEdges(graph, selected));
  }, [graph, selected, setEdges]);

  const handleConnect = useCallback(
    (c: Connection) => {
      const from = parseRef(c.source);
      const to = parseRef(c.target);
      if (from && to && onConnect) onConnect(from, to);
    },
    [onConnect],
  );

  return (
    <div className="tree-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => onSelect?.(n.data.ref)}
        onPaneClick={() => onSelect?.(null)}
        onConnect={handleConnect}
        onEdgesDelete={(deleted) => onDeleteEdges?.(deleted.map((e) => (e.data as { edge: GraphEdge }).edge))}
        onBeforeDelete={async ({ edges: es }) => ({ nodes: [], edges: editable ? es : [] })}
        nodesConnectable={!!editable}
        edgesReconnectable={false}
        elementsSelectable
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} color="#2a2218" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
