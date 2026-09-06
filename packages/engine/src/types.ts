import type { TechTree } from './content';

// ---------------------------------------------------------------------------
// Game state. Plain JSON-serialisable data only: records keyed by id, no
// classes, no Maps. Ids of units/buildings/techs/resources are tech-tree ids.
// ---------------------------------------------------------------------------

export type Resources = Record<string, number>;

export interface Vec2 {
  x: number;
  y: number;
}

/** A harvestable thing on the map (tree, rock, ...). Occupies one hex. */
export interface ResourceNode {
  id: number;
  type: string; // NodeDef id
  x: number; // hex (column, row) in offset coordinates, see hex.ts
  y: number;
  amount: number;
}

export type Carry = { type: string; amount: number } | null; // resource id

export type UnitTask =
  | { kind: 'idle' }
  | { kind: 'move'; target: Vec2 }
  | { kind: 'attackMove'; target: Vec2 }
  | {
      kind: 'harvest';
      nodeId: number; // -1 = no node, just go drop off what we carry
      nodeType: string;
      phase: 'toNode' | 'gathering' | 'toDrop';
      progress: number;
    }
  | { kind: 'build'; buildingId: number }
  | { kind: 'attack'; targetId: number; targetKind: 'unit' | 'building'; resume?: UnitTask };

export interface Unit {
  id: number;
  owner: number;
  type: string; // UnitDef id
  x: number; // continuous world position (a hex is about 1 unit wide)
  y: number;
  hp: number;
  task: UnitTask;
  path: Vec2[]; // remaining waypoints (hex centres)
  goal: Vec2 | null; // hex the current path leads to
  carry: Carry;
  cooldown: number; // seconds until next attack
}

export type QueueItem = { kind: 'unit'; type: string } | { kind: 'tech'; id: string };

/** Where freshly trained units go. With nodeId set, new harvesters start harvesting it. */
export interface RallyPoint {
  x: number;
  y: number;
  nodeId?: number;
}

export interface Building {
  id: number;
  owner: number;
  type: string; // BuildingDef id
  x: number; // centre hex (offset coordinates)
  y: number;
  r: number; // footprint radius in hexes: 0 = one hex, 1 = seven
  hp: number;
  progress: number; // construction 0..1
  queue: QueueItem[];
  queueProgress: number; // seconds spent on queue[0]
  produceTimer: number;
  cooldown: number; // seconds until a building with `attack` fires again
  rally: RallyPoint | null;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  resources: Resources;
  techs: string[]; // TechDef ids
}

export interface GameState {
  tree: TechTree;
  seed: number;
  tick: number;
  width: number; // hex columns
  height: number; // hex rows (see hex.ts for the world size)
  nodes: Record<number, ResourceNode>;
  /** Start slots from map generation; addPlayer hands them out. */
  starts: Vec2[];
  units: Record<number, Unit>;
  buildings: Record<number, Building>;
  players: Record<number, Player>;
  nextId: number;
}

export interface GameMessage {
  playerId: number; // 0 = everyone
  text: string;
}

/** Things that happened during a tick that a client can't infer from a snapshot. */
export interface TickEvents {
  nodesChanged: number[];
  nodesRemoved: number[];
  messages: GameMessage[];
}
