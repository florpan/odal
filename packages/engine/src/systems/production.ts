import { say, setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { makeUnit } from '../entities';
import { findFreeTileNear } from '../grid';
import { hexCentre } from '../hex';
import { buildingMaxHp, hasAbility, popAlive, popCap, produceRate } from '../queries';
import type { Building } from '../types';

// ---------------------------------------------------------------------------
// Production: buildings that grow resources over time and work through their
// train/upgrade queue. New units honour the building's rally point. Research
// is the community's, not a building's: see research.ts.
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
  const time = item.kind === 'unit' ? defs.units[item.type].time : defs.buildings[item.type].time;
  b.queueProgress = Math.min(time, b.queueProgress + dt);
  if (b.queueProgress < time) return;

  if (item.kind === 'unit') {
    const udef = defs.units[item.type];
    if (popAlive(state, b.owner) + udef.pop > popCap(state, b.owner)) return; // wait for housing
    const tile = findFreeTileNear(ctx.blocked, state.width, state.height, b.x, b.y, b.r);
    if (!tile) return;
    const c = hexCentre(tile.x, tile.y);
    const unit = makeUnit(state, b.owner, item.type, c.x, c.y);
    if (b.rally) {
      const node = b.rally.nodeId !== undefined ? state.nodes[b.rally.nodeId] : undefined;
      if (node && hasAbility(ctx.tree, unit, 'harvest')) {
        setTask(unit, { kind: 'harvest', nodeId: node.id, nodeType: node.type, phase: 'toNode', progress: 0 });
      } else {
        setTask(unit, { kind: 'move', target: { x: b.rally.x, y: b.rally.y } });
      }
    }
  } else {
    // The building becomes the target in place: same id, hex and facing; full hit points of the new kind.
    b.type = item.type;
    b.hp = buildingMaxHp(ctx.tree, player, item.type);
    say(ctx, b.owner, `${defs.buildings[item.type].name} complete.`);
  }
  b.queue.shift();
  b.queueProgress = 0;
}
