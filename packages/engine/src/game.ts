import { applyCommand } from './commands';
import type { Ctx } from './ctx';
import { makeBuilding, makeUnit } from './entities';
import { computeBlocked, findFreeTileNear } from './grid';
import { generateMap } from './mapgen';
import type { PlayerCommand } from './protocol';
import { mulberry32 } from './rng';
import type { TechTree } from './content';
import { separateUnits, stepBuildings, stepUnits, stepUpkeep } from './systems';
import { idx } from './tree';
import type { GameState, Player, TickEvents, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Game lifecycle: create a world from a tech tree, add players, advance time.
// This is the only entry point the server (and tests) need.
// ---------------------------------------------------------------------------

export function createGame(tree: TechTree, seed: number): GameState {
  const { width, height } = tree.rules.map;
  const { nodes, nextId, starts } = generateMap(tree, seed, width, height);
  return { tree, seed, tick: 0, width, height, nodes, starts, units: {}, buildings: {}, players: {}, nextId };
}

export function emptyEvents(): TickEvents {
  return { nodesChanged: [], nodesRemoved: [], messages: [] };
}

/**
 * Adds a player: takes the free start slot farthest from everyone else (or, when
 * the slots are all taken, a random spot far from other players), clears the
 * surroundings, and places the starting building and units from the tree.
 */
export function addPlayer(state: GameState, name: string, events: TickEvents): Player {
  const { tree } = state;
  const defs = idx(tree);
  const ids = Object.keys(state.players).map(Number);
  const id = ids.length ? Math.max(...ids) + 1 : 1;
  const rng = mulberry32(state.seed + id * 7919 + state.tick);
  const others = Object.values(state.buildings).filter((b) => b.type === tree.start.building);
  const startDef = defs.buildings[tree.start.building];

  const distToOthers = (p: Vec2) => others.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.y - p.y)), 1000);
  const free = state.starts.filter((s) => distToOthers(s) >= tree.rules.homeRadius);
  let best: Vec2 = { x: Math.floor(state.width / 2), y: Math.floor(state.height / 2) };
  if (free.length) {
    best = others.length
      ? free.reduce((a, b) => (distToOthers(b) > distToOthers(a) ? b : a))
      : free[Math.floor(rng() * free.length)];
  } else {
    let bestScore = -1;
    for (let i = 0; i < 80; i++) {
      const p = { x: 6 + Math.floor(rng() * (state.width - 12)), y: 6 + Math.floor(rng() * (state.height - 12)) };
      const score = distToOthers(p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  // Clear a circle around the start so there is room to build.
  for (const key in state.nodes) {
    const n = state.nodes[key];
    if (Math.hypot(n.x - best.x, n.y - best.y) <= tree.rules.startClearRadius) {
      delete state.nodes[key];
      events.nodesRemoved.push(n.id);
    }
  }

  const resources: Record<string, number> = {};
  for (const r of tree.resources) resources[r.id] = tree.rules.startResources[r.id] ?? 0;
  const player: Player = {
    id,
    name,
    color: tree.rules.playerColors[(id - 1) % tree.rules.playerColors.length],
    resources,
    techs: [],
  };
  state.players[id] = player;

  const home = makeBuilding(state, id, tree.start.building, best.x, best.y);
  home.progress = 1;
  home.hp = startDef.hp;

  const blocked = computeBlocked(state);
  for (const s of tree.start.units) {
    for (let i = 0; i < s.count; i++) {
      const spawn = findFreeTileNear(blocked, state.width, state.height, home.x, home.y, home.w, home.h) ?? {
        x: best.x + 1,
        y: best.y,
      };
      const u = makeUnit(state, id, s.type, spawn.x + 0.5, spawn.y + 0.5);
      // Spread several starting units out a little so separation doesn't have to.
      u.x += (i % 3) * 0.3;
    }
  }

  events.messages.push({ playerId: 0, text: `${name} has joined the game.` });
  return player;
}

/** Advance the simulation by `dt` seconds after applying this tick's commands. */
export function stepGame(state: GameState, commands: PlayerCommand[], dt: number): TickEvents {
  const events = emptyEvents();
  const ctx: Ctx = {
    state,
    tree: state.tree,
    defs: idx(state.tree),
    dt,
    events,
    blocked: computeBlocked(state),
    blockedByOwner: {},
  };

  for (const pc of commands) applyCommand(ctx, pc);
  ctx.blocked = computeBlocked(state);
  ctx.blockedByOwner = {};

  stepUnits(ctx);
  separateUnits(ctx);
  stepBuildings(ctx);
  stepUpkeep(ctx);

  // Remove the dead.
  for (const id in state.units) if (state.units[id].hp <= 0) delete state.units[id];
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.hp <= 0) {
      delete state.buildings[id];
      const owner = state.players[b.owner];
      if (owner)
        events.messages.push({
          playerId: 0,
          text: `${owner.name}'s ${ctx.defs.buildings[b.type].name} was destroyed!`,
        });
    }
  }

  state.tick++;
  return events;
}
