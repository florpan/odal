import type { Ctx } from '../ctx';
import { hexCentre } from '../hex';
import type { Building } from '../types';
import { findEnemyInRange } from './combat';
import { fire } from './projectiles';

// ---------------------------------------------------------------------------
// Towers: a completed building with an `attack` block shoots the nearest enemy
// within its range. It never moves and never picks a fight it can't reach, so
// this is combat.ts minus the chasing. Damage is the raw `attack.damage`;
// tech effects on unit damage do not apply to buildings. With a `projectile`
// the hit flies there (projectiles.ts); without one it lands at once.
// ---------------------------------------------------------------------------

export function stepTower(ctx: Ctx, b: Building) {
  const def = ctx.defs.buildings[b.type];
  if (!def.attack || b.progress < 1) return;
  if (b.cooldown > 0) {
    b.cooldown -= ctx.dt;
    return;
  }
  const centre = { id: b.id, owner: b.owner, ...hexCentre(b.x, b.y) };
  const enemy = findEnemyInRange(ctx, centre, def.attack.range);
  if (!enemy) return;
  const target = enemy.targetKind === 'unit' ? ctx.state.units[enemy.targetId] : ctx.state.buildings[enemy.targetId];
  if (!target) return;
  const { damage, projectile } = def.attack;
  if (projectile) fire(ctx, centre, { id: b.type, kind: 'building' }, projectile, target, enemy.targetKind, damage);
  else target.hp -= damage;
  b.cooldown = def.attack.attackTime;
}
