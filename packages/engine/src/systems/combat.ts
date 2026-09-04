import { setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { rectDistance, tileOf } from '../grid';
import { unitDamage } from '../queries';
import type { Building, Unit } from '../types';
import { goTo, goToAdjacent } from './movement';
import type { GoResult } from './movement';

// ---------------------------------------------------------------------------
// Combat: chase a target, hit it when in range, resume the previous task when
// it dies. Units with an aggro radius pick fights on their own.
// ---------------------------------------------------------------------------

export interface Target {
  targetId: number;
  targetKind: 'unit' | 'building';
}

export function stepAttack(ctx: Ctx, u: Unit) {
  const { state, defs } = ctx;
  const task = u.task;
  if (task.kind !== 'attack') return;
  const def = defs.units[u.type];
  const resume = () => setTask(u, task.resume ?? { kind: 'idle' });

  let inRange = false;
  let target: Unit | Building | undefined;
  let r: GoResult = 'moving';

  if (task.targetKind === 'unit') {
    target = state.units[task.targetId];
    if (!target || target.hp <= 0) return resume();
    inRange = Math.hypot(target.x - u.x, target.y - u.y) <= def.range + 0.5;
    if (!inRange) {
      const t = tileOf(target);
      r = goTo(ctx, u, t.x, t.y);
    }
  } else {
    target = state.buildings[task.targetId];
    if (!target || target.hp <= 0) return resume();
    inRange = rectDistance(u, target.x, target.y, target.w, target.h) <= def.range + 0.3;
    if (!inRange) r = goToAdjacent(ctx, u, target.x, target.y, target.w, target.h);
  }

  if (!inRange) {
    if (r === 'unreachable') resume();
    return;
  }

  u.path = [];
  u.goal = null;
  if (u.cooldown > 0) return;
  target.hp -= unitDamage(ctx.tree, state.players[u.owner], u.type);
  u.cooldown = def.attackTime;
}

/** Nearest enemy unit or building within `radius`, preferring units. */
export function findEnemyInRange(ctx: Ctx, u: Unit, radius: number): Target | null {
  const { state } = ctx;
  let best: Target | null = null;
  let bestD = radius;
  for (const id in state.units) {
    const o = state.units[id];
    if (o.owner === u.owner || o.hp <= 0) continue;
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    if (d <= bestD) {
      bestD = d;
      best = { targetId: o.id, targetKind: 'unit' };
    }
  }
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === u.owner || b.hp <= 0) continue;
    const d = rectDistance(u, b.x, b.y, b.w, b.h) + 1; // prefer units over buildings
    if (d <= bestD) {
      bestD = d;
      best = { targetId: b.id, targetKind: 'building' };
    }
  }
  return best;
}

/** Idle or attack-moving units with an aggro radius engage enemies that come close. */
export function autoAcquire(ctx: Ctx, u: Unit): boolean {
  const def = ctx.defs.units[u.type];
  if (def.aggro <= 0 || !def.abilities.includes('attack')) return false;
  const enemy = findEnemyInRange(ctx, u, def.aggro);
  if (!enemy) return false;
  setTask(u, { kind: 'attack', ...enemy, resume: u.task });
  return true;
}
