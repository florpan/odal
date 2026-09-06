import { say, setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { isAdjacentTo } from '../grid';
import { findNearbyNode, gatherRate, nearestDropOff } from '../queries';
import type { Unit } from '../types';
import { goToAdjacent } from './movement';

const NODE_SEARCH_RADIUS = 12;

// ---------------------------------------------------------------------------
// Harvest: walk to a node, gather a load, carry it to the nearest drop-off,
// repeat. When the node is exhausted, look for another of the same kind.
// ---------------------------------------------------------------------------

export function stepHarvest(ctx: Ctx, u: Unit) {
  const { state, events, dt, defs } = ctx;
  const task = u.task;
  if (task.kind !== 'harvest') return;
  const player = state.players[u.owner];

  if (task.phase === 'toDrop') {
    if (!u.carry) {
      task.phase = 'toNode';
      return;
    }
    const drop = nearestDropOff(state, u);
    if (!drop) {
      say(ctx, u.owner, 'No drop-off building to return resources to.');
      setTask(u, { kind: 'idle' });
      return;
    }
    const r = goToAdjacent(ctx, u, drop.x, drop.y, drop.r);
    if (r === 'unreachable') setTask(u, { kind: 'idle' });
    if (r !== 'arrived') return;
    player.resources[u.carry.type] = (player.resources[u.carry.type] ?? 0) + u.carry.amount;
    u.carry = null;
    if (!state.nodes[task.nodeId]) {
      const alt = findNearbyNode(state, u, task.nodeType, NODE_SEARCH_RADIUS);
      if (!alt) {
        setTask(u, { kind: 'idle' });
        return;
      }
      task.nodeId = alt.id;
    }
    task.phase = 'toNode';
    task.progress = 0;
    u.path = [];
    u.goal = null;
    return;
  }

  let node = state.nodes[task.nodeId];
  if (!node) {
    const alt = findNearbyNode(state, u, task.nodeType, NODE_SEARCH_RADIUS);
    if (!alt) {
      setTask(u, u.carry ? { ...task, phase: 'toDrop', nodeId: -1 } : { kind: 'idle' });
      return;
    }
    node = alt;
    task.nodeId = alt.id;
    task.phase = 'toNode';
  }

  if (task.phase === 'toNode') {
    const r = goToAdjacent(ctx, u, node.x, node.y, 0);
    if (r === 'unreachable') {
      setTask(u, { kind: 'idle' });
      return;
    }
    if (r === 'arrived') {
      task.phase = 'gathering';
      task.progress = 0;
    }
    return;
  }

  // gathering
  if (!isAdjacentTo(u, node.x, node.y, 0)) {
    task.phase = 'toNode';
    return;
  }
  const def = defs.nodes[node.type];
  task.progress += dt * gatherRate(ctx.tree, player, def.resource);
  if (task.progress < def.gatherTime) return;

  const amount = Math.min(def.gatherAmount, node.amount);
  node.amount -= amount;
  u.carry = { type: def.resource, amount };
  events.nodesChanged.push(node.id);
  if (node.amount <= 0) {
    delete state.nodes[node.id];
    events.nodesRemoved.push(node.id);
    ctx.blocked[node.y * state.width + node.x] = 0;
  }
  task.phase = 'toDrop';
  task.progress = 0;
  u.path = [];
  u.goal = null;
}
