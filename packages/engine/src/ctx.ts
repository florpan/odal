import type { TechTree } from './content';
import { computeBlocked } from './grid';
import type { TreeIndex } from './tree';
import type { GameState, TickEvents, Unit, UnitTask, Vec2 } from './types';

/** Everything a system needs during one tick. Built once per step by game.ts. */
export interface Ctx {
  state: GameState;
  tree: TechTree;
  defs: TreeIndex;
  dt: number;
  events: TickEvents;
  blocked: Uint8Array; // 1 = tile blocked (node or building), for everyone
  blockedByOwner: Record<number, Uint8Array>; // lazily built per player, see blockedFor()
}

/**
 * The blocking grid as one player's units experience it: their own `passable`
 * buildings (gates) are open. Falls back to the shared grid when the player has
 * none, which is the common case.
 */
export function blockedFor(ctx: Ctx, owner: number): Uint8Array {
  let g = ctx.blockedByOwner[owner];
  if (g) return g;
  const { state, defs } = ctx;
  let hasGate = false;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === owner && defs.buildings[b.type].passable) {
      hasGate = true;
      break;
    }
  }
  g = hasGate ? computeBlocked(state, owner) : ctx.blocked;
  ctx.blockedByOwner[owner] = g;
  return g;
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
