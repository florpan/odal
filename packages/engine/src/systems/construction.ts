import { say, setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { buildSpeed, buildingMaxHp } from '../queries';
import type { Unit } from '../types';
import { goToAdjacent } from './movement';

// ---------------------------------------------------------------------------
// Construction: a builder standing next to an unfinished building adds
// progress. Several builders stack. HP grows with progress.
// ---------------------------------------------------------------------------

export function stepBuild(ctx: Ctx, u: Unit) {
  const { state, dt, defs } = ctx;
  const task = u.task;
  if (task.kind !== 'build') return;
  const b = state.buildings[task.buildingId];
  if (!b || b.progress >= 1) {
    setTask(u, { kind: 'idle' });
    return;
  }
  const r = goToAdjacent(ctx, u, b.x, b.y, b.w, b.h);
  if (r === 'unreachable') {
    setTask(u, { kind: 'idle' });
    return;
  }
  if (r !== 'arrived') return;

  const def = defs.buildings[b.type];
  const owner = state.players[u.owner];
  const maxHp = buildingMaxHp(ctx.tree, owner, b.type);
  const step = def.time > 0 ? (dt * buildSpeed(ctx.tree, owner)) / def.time : 1;
  b.progress = Math.min(1, b.progress + step);
  b.hp = Math.min(maxHp, b.hp + maxHp * step);
  if (b.progress >= 1) {
    b.hp = maxHp;
    say(ctx, u.owner, `${def.name} complete.`);
  }
}
