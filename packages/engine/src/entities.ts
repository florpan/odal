import { unitMaxHp } from './queries';
import { idx } from './tree';
import type { Building, GameState, Unit } from './types';

/** Creates a building at construction progress 0 (callers set progress = 1 for pre-built ones). */
export function makeBuilding(state: GameState, owner: number, type: string, x: number, y: number): Building {
  const def = idx(state.tree).buildings[type];
  const b: Building = {
    id: state.nextId++,
    owner,
    type,
    x,
    y,
    w: def.size.w,
    h: def.size.h,
    hp: 1,
    progress: 0,
    queue: [],
    queueProgress: 0,
    produceTimer: 0,
    rally: null,
  };
  state.buildings[b.id] = b;
  return b;
}

export function makeUnit(state: GameState, owner: number, type: string, x: number, y: number): Unit {
  const u: Unit = {
    id: state.nextId++,
    owner,
    type,
    x,
    y,
    hp: unitMaxHp(state.tree, state.players[owner], type),
    task: { kind: 'idle' },
    path: [],
    goal: null,
    carry: null,
    cooldown: 0,
  };
  state.units[u.id] = u;
  return u;
}
