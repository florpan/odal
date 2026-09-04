import type { TechTree } from './content';
import type { TreeIndex } from './tree';
import type { GameState, TickEvents, Unit, UnitTask, Vec2 } from './types';

/** Everything a system needs during one tick. Built once per step by game.ts. */
export interface Ctx {
  state: GameState;
  tree: TechTree;
  defs: TreeIndex;
  dt: number;
  events: TickEvents;
  blocked: Uint8Array; // 1 = tile blocked (node or building)
}

export function say(ctx: Ctx, playerId: number, text: string) {
  ctx.events.messages.push({ playerId, text });
}

/** Replace a unit's task and forget any path it was following. */
export function setTask(u: Unit, task: UnitTask) {
  u.task = task;
  u.path = [];
  u.goal = null;
}

export function clampToMap(state: GameState, p: Vec2): Vec2 {
  return {
    x: Math.max(0.5, Math.min(state.width - 0.5, p.x)),
    y: Math.max(0.5, Math.min(state.height - 0.5, p.y)),
  };
}
