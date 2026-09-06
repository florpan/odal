import { setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { footprintDistance, tileOf } from '../grid';
import { unitDamage } from '../queries';
import type { Building, Unit, UnitTask } from '../types';
import { goTo, goToAdjacent } from './movement';
import type { GoResult } from './movement';

// ---------------------------------------------------------------------------
// Combat: chase a target, hit it when in range, resume the previous task when
// it dies. Units with an aggro radius pick fights on their own, but an idle unit
// only defends against enemy *units* and walks back to its post afterwards;
// only attack-move (and explicit orders) go after buildings. A scout parked
// next to a village must not raze it.
// ---------------------------------------------------------------------------

/** An idle unit gives up a self-started chase this many aggro radii from its post. */
const LEASH = 1.5;

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

  // Self-started fights (resume = walk back to the post) are leashed to that post.
  if (task.resume?.kind === 'move') {
    const p = task.resume.target;
    if (Math.hypot(p.x - u.x, p.y - u.y) > def.aggro * LEASH) return resume();
  }

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
    inRange = footprintDistance(u, target.x, target.y, target.r) <= def.range + 0.3;
    if (!inRange) r = goToAdjacent(ctx, u, target.x, target.y, target.r);
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

/**
 * Nearest enemy within `radius` of a point owned by `owner`, preferring units.
 * Buildings are only considered when `buildings` is true.
 */
export function findEnemyInRange(
  ctx: Ctx,
  from: { owner: number; x: number; y: number },
  radius: number,
  buildings = true,
): Target | null {
  const { state } = ctx;
  let best: Target | null = null;
  let bestD = radius;
  for (const id in state.units) {
    const o = state.units[id];
    if (o.owner === from.owner || o.hp <= 0) continue;
    const d = Math.hypot(o.x - from.x, o.y - from.y);
    if (d <= bestD) {
      bestD = d;
      best = { targetId: o.id, targetKind: 'unit' };
    }
  }
  if (!buildings) return best;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === from.owner || b.hp <= 0) continue;
    const d = footprintDistance(from, b.x, b.y, b.r) + 1; // prefer units over buildings
    if (d <= bestD) {
      bestD = d;
      best = { targetId: b.id, targetKind: 'building' };
    }
  }
  return best;
}

/**
 * Units with an aggro radius pick fights on their own:
 * - idle: engage enemy units that come close, then walk back to where they stood
 *   (the `move` resume doubles as the leash anchor). Never buildings.
 * - attackMove: engage anything, buildings included, and carry on afterwards.
 */
export function autoAcquire(ctx: Ctx, u: Unit): boolean {
  const def = ctx.defs.units[u.type];
  if (def.aggro <= 0 || !def.abilities.includes('attack')) return false;
  const aggressive = u.task.kind === 'attackMove';
  const enemy = findEnemyInRange(ctx, u, def.aggro, aggressive);
  if (!enemy) return false;
  const resume: UnitTask = aggressive ? u.task : { kind: 'move', target: { x: u.x, y: u.y } };
  setTask(u, { kind: 'attack', ...enemy, resume });
  return true;
}
