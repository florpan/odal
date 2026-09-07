import { setTask } from '../ctx';
import type { Ctx } from '../ctx';
import { tileOf } from '../grid';
import type { Unit } from '../types';
import { autoAcquire, stepAttack } from './combat';
import { stepBuild } from './construction';
import { stepHarvest } from './harvest';
import { goTo } from './movement';
import { stepBuilding } from './production';
import { stepResearch } from './research';
import { separateUnits } from './separation';
import { stepTower } from './towers';
import { stepUpkeep } from './upkeep';

// ---------------------------------------------------------------------------
// System order for one tick. game.ts calls these after commands are applied:
//   1. units      (task dispatch: movement, harvest, construction, combat)
//   2. separation (push idle/walking units apart)
//   3. buildings  (production and train/upgrade queues, then towers shoot)
//   4. research   (each player's community-wide research queue)
//   5. upkeep     (units eat, every rules.upkeepInterval seconds)
// Adding a system: write it in its own file, call it here, document it in
// docs/ARCHITECTURE.md.
// ---------------------------------------------------------------------------

export function stepUnits(ctx: Ctx) {
  for (const id in ctx.state.units) stepUnit(ctx, ctx.state.units[id]);
}

export function stepBuildings(ctx: Ctx) {
  for (const id in ctx.state.buildings) {
    const b = ctx.state.buildings[id];
    stepBuilding(ctx, b);
    stepTower(ctx, b);
  }
}

export { separateUnits, stepResearch, stepUpkeep };

function stepUnit(ctx: Ctx, u: Unit) {
  if (u.cooldown > 0) u.cooldown -= ctx.dt;

  switch (u.task.kind) {
    case 'idle':
      autoAcquire(ctx, u);
      break;
    case 'move': {
      const t = tileOf(u.task.target);
      if (goTo(ctx, u, t.x, t.y) !== 'moving') setTask(u, { kind: 'idle' });
      break;
    }
    case 'attackMove': {
      if (autoAcquire(ctx, u)) break;
      const t = tileOf(u.task.target);
      if (goTo(ctx, u, t.x, t.y) !== 'moving') setTask(u, { kind: 'idle' });
      break;
    }
    case 'harvest':
      stepHarvest(ctx, u);
      break;
    case 'build':
      stepBuild(ctx, u);
      break;
    case 'attack':
      stepAttack(ctx, u);
      break;
  }
}
