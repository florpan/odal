import { say, setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { makeUnit } from '../entities';
import { findFreeTileNear } from '../grid';
import { hasAbility, popAlive, popCap, produceRate } from '../queries';
import type { Building } from '../types';

// ---------------------------------------------------------------------------
// Production: buildings that grow resources over time and work through their
// train/research queue. New units honour the building's rally point.
// ---------------------------------------------------------------------------

export function stepBuilding(ctx: Ctx, b: Building) {
  const { state, dt, defs } = ctx;
  if (b.progress < 1) return;
  const player = state.players[b.owner];
  if (!player) return;
  const def = defs.buildings[b.type];

  if (def.produces) {
    b.produceTimer += dt * produceRate(ctx.tree, player, b.type);
    if (b.produceTimer >= def.produces.interval) {
      b.produceTimer -= def.produces.interval;
      player.resources[def.produces.resource] = (player.resources[def.produces.resource] ?? 0) + def.produces.amount;
    }
  }

  if (!b.queue.length) return;
  const item = b.queue[0];
  const time = item.kind === 'unit' ? defs.units[item.type].time : defs.techs[item.id].time;
  b.queueProgress = Math.min(time, b.queueProgress + dt);
  if (b.queueProgress < time) return;

  if (item.kind === 'unit') {
    const udef = defs.units[item.type];
    if (popAlive(state, b.owner) + udef.pop > popCap(state, b.owner)) return; // wait for housing
    const tile = findFreeTileNear(ctx.blocked, state.width, state.height, b.x, b.y, b.w, b.h);
    if (!tile) return;
    const unit = makeUnit(state, b.owner, item.type, tile.x + 0.5, tile.y + 0.5);
    if (b.rally) {
      const node = b.rally.nodeId !== undefined ? state.nodes[b.rally.nodeId] : undefined;
      if (node && hasAbility(ctx.tree, unit, 'harvest')) {
        setTask(unit, { kind: 'harvest', nodeId: node.id, nodeType: node.type, phase: 'toNode', progress: 0 });
      } else {
        setTask(unit, { kind: 'move', target: { x: b.rally.x, y: b.rally.y } });
      }
    }
  } else {
    if (!player.techs.includes(item.id)) player.techs.push(item.id);
    say(ctx, b.owner, `Research complete: ${defs.techs[item.id].name}.`);
  }
  b.queue.shift();
  b.queueProgress = 0;
}
