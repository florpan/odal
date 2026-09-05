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

/**
 * A prerequisite: a researched tech, a completed building the player owns, or a
 * minimum living population. Tech and building requirements are edges in the
 * tech graph; population is a gate that is checked but not drawn.
 */
export type Requirement =
  { type: 'tech'; id: string } | { type: 'building'; id: string } | { type: 'population'; min: number };

export type Effect =
  | { type: 'gatherRate'; resource?: string; multiplier: number }
  | { type: 'produceRate'; building?: string; multiplier: number }
  | { type: 'damage'; unit?: string; multiplier: number }
  | { type: 'maxHp'; unit?: string; multiplier: number }
  | { type: 'speed'; unit?: string; multiplier: number }
  | { type: 'buildingHp'; building?: string; multiplier: number }
  | { type: 'buildSpeed'; multiplier: number };
export type EffectType = Effect['type'];

/** Where the per-1000-tiles scatter may land: anywhere, or only the middle of the map (contested). */
export type SpawnZone = 'anywhere' | 'centre';

export type Spawn =
  | { kind: 'forest'; clustersPer1000Tiles: number; radius: [number, number]; perStart: number; zone: SpawnZone }
  | { kind: 'deposit'; depositsPer1000Tiles: number; size: [number, number]; perStart: number; zone: SpawnZone };

export interface EntityDef {
  id: string;
  name: string;
  desc: string;
  /** Author notes (balance reasoning, todos). Never shown to players. */
  notes: string;
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
  /**
   * `models`: GLBs under /models/ at world scale (1 unit = 1 tile, base at y=0); one is picked per node
   * by id. `scale` multiplies all of them equally (default 1). Without `models` the primitive is drawn.
   */
  visual: { shape: 'cone' | 'rock'; color: string; models?: string[]; scale?: number };
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
  /** `model`: a GLB under the client's /models/ (see tools/models); the primitives are the fallback. */
  visual: { width: number; height: number; helmet: boolean; model?: string };
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
  /** Shoots enemies within `range` tiles once complete (towers). */
  attack?: { damage: number; range: number; attackTime: number };
  /** The owner's units walk through it; everyone else is blocked (gates). */
  passable: boolean;
  vision: number;
  hotkey?: string;
  /**
   * `model`: a GLB under /models/ authored with a 1×1 footprint and base at y=0, scaled to the
   * building's footprint. `{team}` in the name is replaced by the owner's nearest KayKit colour
   * (red, blue, green, yellow). Without it the shape/color primitive is drawn.
   */
  visual: { shape: 'box' | 'cone'; color: string; height: number; glow?: string; model?: string };
}

export interface TechDef extends ProducibleDef {
  effects: Effect[];
}

export interface Rules {
  tickRate: number;
  /** `starts`: start slots on a ring around the centre; players take the free one farthest from everyone. */
  map: { width: number; height: number; starts: number };
  /** Every start slot gets each node type's `spawn.perStart` clusters/deposits within this radius. */
  homeRadius: number;
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
