import type { Building, GameMessage, GameState, Player, RallyPoint, ResourceNode, Unit, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Network protocol between client and server. Bump PROTOCOL_VERSION whenever
// a message shape changes; the client refuses to play on a mismatch.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 5;

/** What a player can ask the simulation to do. Validated by the engine, never trusted. */
export type Command =
  | { type: 'move'; unitIds: number[]; target: Vec2 }
  | { type: 'attackMove'; unitIds: number[]; target: Vec2 }
  | { type: 'stop'; unitIds: number[] }
  | { type: 'harvest'; unitIds: number[]; nodeId: number }
  | { type: 'build'; unitIds: number[]; building: string; x: number; y: number }
  | { type: 'assist'; unitIds: number[]; buildingId: number }
  | { type: 'attack'; unitIds: number[]; targetId: number; targetKind: 'unit' | 'building' }
  | { type: 'train'; buildingId: number; unit: string }
  | { type: 'research'; buildingId: number; tech: string }
  | { type: 'cancelQueue'; buildingId: number; index: number }
  | { type: 'setRally'; buildingId: number; target: RallyPoint | null };

export interface PlayerCommand {
  playerId: number;
  cmd: Command;
}

export type ClientMessage =
  | { type: 'join'; name: string; room: string; version: number }
  | { type: 'ready'; ready: boolean }
  | { type: 'cmd'; cmd: Command }
  | { type: 'restart' };

export interface LobbyPlayer {
  name: string;
  ready: boolean;
}

export interface LobbyInfo {
  type: 'lobby';
  room: string;
  phase: 'lobby' | 'playing';
  players: LobbyPlayer[];
}

export interface Snapshot {
  type: 'snapshot';
  tick: number;
  units: Unit[];
  buildings: Building[];
  players: Player[];
  nodesChanged: ResourceNode[];
  nodesRemoved: number[];
  messages: GameMessage[];
}

export type ServerMessage =
  | { type: 'welcome'; version: number; playerId: number; state: GameState }
  | Snapshot
  | LobbyInfo
  | { type: 'error'; text: string };
