import type { Ctx } from '../ctx';
import type { ProjectileDef } from '../content';
import { hexCentre } from '../hex';
import type { Building, Shot, Unit, Vec2 } from '../types';

// ---------------------------------------------------------------------------
// Projectiles: the flight between a ranged attacker and its target. The hit is
// decided by whoever fires (combat.ts, towers.ts): a shot never misses and the
// target cannot dodge it, so every client agrees on what happened the moment
// it is fired. What the flight adds is time: the damage lands `distance /
// speed` seconds later, when the arrow visibly arrives, and a shot whose
// target is already gone by then simply vanishes. The client draws the arc.
// ---------------------------------------------------------------------------

/** Where a shot aims: a unit's position, or a building's centre hex. */
function targetPoint(target: Unit | Building, kind: 'unit' | 'building'): Vec2 {
  return kind === 'unit' ? { x: target.x, y: target.y } : hexCentre(target.x, target.y);
}

/** Fire a projectile from `from` at the target; the damage is fixed now and dealt when it lands. */
export function fire(
  ctx: Ctx,
  from: { owner: number; x: number; y: number },
  source: { id: string; kind: 'unit' | 'building' },
  projectile: ProjectileDef,
  target: Unit | Building,
  targetKind: 'unit' | 'building',
  damage: number,
): Shot {
  const to = targetPoint(target, targetKind);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const shot: Shot = {
    id: ctx.state.nextId++,
    owner: from.owner,
    source: source.id,
    sourceKind: source.kind,
    from: { x: from.x, y: from.y },
    targetId: target.id,
    targetKind,
    damage,
    t: 0,
    duration: Math.max(ctx.dt, dist / projectile.speed),
  };
  ctx.state.shots[shot.id] = shot;
  return shot;
}

/** Advance every shot; the ones that arrive deal their damage and disappear. */
export function stepShots(ctx: Ctx) {
  const { state, dt } = ctx;
  for (const id in state.shots) {
    const s = state.shots[id];
    s.t += dt;
    if (s.t < s.duration) continue;
    const target = s.targetKind === 'unit' ? state.units[s.targetId] : state.buildings[s.targetId];
    if (target && target.hp > 0) target.hp -= s.damage;
    delete state.shots[id];
  }
}
