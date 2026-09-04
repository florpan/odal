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

/** A harvestable thing on the map (tree, rock, ...). Occupies one tile. */
export interface ResourceNode {
  id: number;
  type: string; // NodeDef id
  x: number; // tile coordinate
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
  x: number; // continuous world position (tile units)
  y: number;
  hp: number;
  task: UnitTask;
  path: Vec2[]; // remaining waypoints (tile centres)
  goal: Vec2 | null; // tile the current path leads to
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
  x: number; // top-left tile
  y: number;
  w: number;
  h: number;
  hp: number;
  progress: number; // construction 0..1
  queue: QueueItem[];
  queueProgress: number; // seconds spent on queue[0]
  produceTimer: number;
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
  width: number;
  height: number;
  nodes: Record<number, ResourceNode>;
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
