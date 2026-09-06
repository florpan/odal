import type { Ctx } from '../ctx';
import { hexCentre } from '../hex';
import type { Building } from '../types';
import { findEnemyInRange } from './combat';

// ---------------------------------------------------------------------------
// Towers: a completed building with an `attack` block shoots the nearest enemy
// within its range. It never moves and never picks a fight it can't reach, so
// this is combat.ts minus the chasing. Damage is the raw `attack.damage`;
// tech effects on unit damage do not apply to buildings.
// ---------------------------------------------------------------------------

export function stepTower(ctx: Ctx, b: Building) {
  const def = ctx.defs.buildings[b.type];
  if (!def.attack || b.progress < 1) return;
  if (b.cooldown > 0) {
    b.cooldown -= ctx.dt;
    return;
  }
  const centre = { owner: b.owner, ...hexCentre(b.x, b.y) };
  const enemy = findEnemyInRange(ctx, centre, def.attack.range);
  if (!enemy) return;
  const target = enemy.targetKind === 'unit' ? ctx.state.units[enemy.targetId] : ctx.state.buildings[enemy.targetId];
  if (!target) return;
  target.hp -= def.attack.damage;
  b.cooldown = def.attack.attackTime;
}
