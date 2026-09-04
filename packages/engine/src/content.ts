// ---------------------------------------------------------------------------
// Content types: the shape of a tech tree after validation and defaults.
//
// This is the source of truth for what a ruleset can express. The zod schemas
// in tree.ts are checked at compile time to produce exactly these types, and
// packages/content authors rulesets against the *Input variants (fields with
// defaults optional) using `satisfies`.
//
// Hierarchy:
//   EntityDef                 anything with an id, name and description
//   ├─ ResourceDef            lumber, gold, ...
//   ├─ NodeDef                trees, rocks: harvestable map objects
//   └─ ProducibleDef          anything a player obtains by paying cost + time
//      ├─ UnitDef
//      ├─ BuildingDef
//      └─ TechDef
// ---------------------------------------------------------------------------

/** Resource amounts keyed by resource id. */
export type Cost = Record<string, number>;

export type Ability = 'harvest' | 'build' | 'attack';

/** A prerequisite: a researched tech, or a completed building the player owns. */
export type Requirement = { type: 'tech'; id: string } | { type: 'building'; id: string };

export type Effect =
  | { type: 'gatherRate'; resource?: string; multiplier: number }
  | { type: 'produceRate'; building?: string; multiplier: number }
  | { type: 'damage'; unit?: string; multiplier: number }
  | { type: 'maxHp'; unit?: string; multiplier: number }
  | { type: 'speed'; unit?: string; multiplier: number }
  | { type: 'buildSpeed'; multiplier: number };
export type EffectType = Effect['type'];

export type Spawn =
  | { kind: 'forest'; clustersPer1000Tiles: number; radius: [number, number] }
  | { kind: 'deposit'; depositsPer1000Tiles: number; size: [number, number] };

export interface EntityDef {
  id: string;
  name: string;
  desc: string;
}

export interface ResourceDef extends EntityDef {
  icon: string;
}

export interface NodeDef extends EntityDef {
  resource: string;
  amount: number;
  gatherTime: number;
  gatherAmount: number;
  spawn: Spawn;
  visual: { shape: 'cone' | 'rock'; color: string };
}

/** Something obtained by paying `cost` and waiting `time` seconds, once `requires` are met. */
export interface ProducibleDef extends EntityDef {
  cost: Cost;
  time: number;
  requires: Requirement[];
}

export interface UnitDef extends ProducibleDef {
  hp: number;
  speed: number;
  damage: number;
  range: number;
  attackTime: number;
  aggro: number;
  vision: number;
  pop: number;
  /** Resources consumed every `rules.upkeepInterval` seconds while the unit lives. */
  upkeep: Cost;
  abilities: Ability[];
  visual: { width: number; height: number; helmet: boolean };
}

export interface BuildingDef extends ProducibleDef {
  buildable: boolean;
  hp: number;
  size: { w: number; h: number };
  pop: number;
  trains: string[];
  researches: string[];
  dropOff: boolean;
  produces?: { resource: string; amount: number; interval: number };
  vision: number;
  hotkey?: string;
  visual: { shape: 'box' | 'cone'; color: string; height: number; glow?: string };
}

export interface TechDef extends ProducibleDef {
  effects: Effect[];
}

export interface Rules {
  tickRate: number;
  map: { width: number; height: number };
  startResources: Cost;
  maxQueue: number;
  separationDist: number;
  startClearRadius: number;
  upkeepInterval: number;
  playerColors: string[];
}

export interface StartDef {
  building: string;
  units: { type: string; count: number }[];
}

export interface TechTree {
  name: string;
  version: 1;
  rules: Rules;
  resources: ResourceDef[];
  nodes: NodeDef[];
  units: UnitDef[];
  buildings: BuildingDef[];
  techs: TechDef[];
  start: StartDef;
}

/** Reference to a producible thing, used by requirements and the tech graph. */
export interface Ref {
  kind: 'unit' | 'building' | 'tech';
  id: string;
}
