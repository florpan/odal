import { PROTOCOL_VERSION, computeVision, isBuildingVisible, isVisible } from '@odal/engine';
import type {
  Building,
  GameState,
  Player,
  ResourceNode,
  ServerMessage,
  Snapshot,
  TickEvents,
  Unit,
} from '@odal/engine';

// ---------------------------------------------------------------------------
// Fog-of-war filtering: what one player is allowed to see. Applied to every
// welcome and snapshot so the server never leaks hidden information.
// ---------------------------------------------------------------------------

function maskPlayers(state: GameState, playerId: number): Player[] {
  const empty: Record<string, number> = {};
  for (const r of state.tree.resources) empty[r.id] = 0;
  return Object.values(state.players).map((p) =>
    p.id === playerId ? p : { ...p, resources: { ...empty }, techs: [] },
  );
}

function visibleUnits(state: GameState, vision: Uint8Array, playerId: number): Unit[] {
  const out: Unit[] = [];
  for (const id in state.units) {
    const u = state.units[id];
    if (u.owner === playerId || isVisible(vision, state.width, u.x, u.y)) out.push(u);
  }
  return out;
}

function visibleBuildings(state: GameState, vision: Uint8Array, playerId: number): Building[] {
  const out: Building[] = [];
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === playerId || isBuildingVisible(vision, state.width, b.x, b.y, b.w, b.h)) out.push(b);
  }
  return out;
}

function toRecord<T extends { id: number }>(list: T[]): Record<number, T> {
  const out: Record<number, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
}

export function welcomeFor(state: GameState, playerId: number): ServerMessage {
  const vision = computeVision(state, playerId);
  return {
    type: 'welcome',
    version: PROTOCOL_VERSION,
    playerId,
    state: {
      ...state,
      units: toRecord(visibleUnits(state, vision, playerId)),
      buildings: toRecord(visibleBuildings(state, vision, playerId)),
      players: toRecord(maskPlayers(state, playerId)),
    },
  };
}

export function snapshotFor(
  state: GameState,
  playerId: number,
  ev: TickEvents,
  nodesChanged: ResourceNode[],
): Snapshot {
  const vision = computeVision(state, playerId);
  return {
    type: 'snapshot',
    tick: state.tick,
    units: visibleUnits(state, vision, playerId).map((u) => ({ ...u, path: [] })),
    buildings: visibleBuildings(state, vision, playerId),
    players: maskPlayers(state, playerId),
    nodesChanged,
    nodesRemoved: ev.nodesRemoved,
    messages: ev.messages.filter((m) => m.playerId === 0 || m.playerId === playerId),
  };
}
