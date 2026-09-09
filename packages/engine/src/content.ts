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
  | { type: 'buildSpeed'; multiplier: number }
  /** The player knows the whole map's `terrain`, or every resource node (`nodes`), without scouting it. */
  | { type: 'reveal'; what: RevealWhat };
export type EffectType = Effect['type'];
export type RevealWhat = 'terrain' | 'nodes';

/** Where the per-1000-tiles scatter may land: anywhere, or on the land farthest from every start (contested). */
export type SpawnZone = 'anywhere' | 'contested';

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

/** A kind of ground. Every hex of the map has exactly one. */
export interface TerrainDef extends EntityDef {
  /** Units walk on it. Impassable terrain (water) blocks like a node does and nothing spawns or builds on it. */
  passable: boolean;
  /**
   * `height`: where the tile's top sits relative to the ground plane (water below 0 makes a shore step).
   * `model`: a GLB hex tile under /models/ (one hex wide, top at y=0); without it a flat coloured hex is drawn.
   * `shore`: tiles for a hex of this terrain that borders impassable terrain, by number of consecutive
   * water edges (index 0 = one edge); authored with the water side centred on +z, the renderer turns them.
   */
  visual: { color: string; height: number; model?: string; shore?: string[] };
}

export interface NodeDef extends EntityDef {
  resource: string;
  amount: number;
  gatherTime: number;
  gatherAmount: number;
  spawn: Spawn;
  /**
   * `models`: GLBs under /models/ at world scale (a hex is about 1 unit wide, base at y=0); one is picked per node
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

/**
 * A ranged attack's visible flight. The hit is decided when the shot is fired (the engine never
 * misses and the target cannot dodge); the shot flies `distance / speed` seconds, homing, and only
 * deals its damage when it lands. Melee attacks have no projectile and hit at once.
 * `arc`: peak height of the flight above the straight line, as a fraction of the distance (0 = flat).
 * `visual.size`: length of a bolt or diameter of a ball in world units; a `model` (GLB under /models/,
 * any orientation, centred on its origin) is scaled so its long axis is `size` long.
 */
export interface ProjectileDef {
  speed: number;
  arc: number;
  visual: { shape: 'bolt' | 'ball'; color: string; size: number; model?: string };
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
  /** Present: attacks are shots that fly to the target (archers). Absent: melee, damage lands at once. */
  projectile?: ProjectileDef;
  /** `model`: a GLB under the client's /models/ (see tools/models); the primitives are the fallback. */
  visual: { width: number; height: number; helmet: boolean; model?: string };
}

export interface BuildingDef extends ProducibleDef {
  buildable: boolean;
  hp: number;
  /** Footprint: the centre hex plus every hex within `radius` steps (0 = one hex, 1 = seven). */
  size: { radius: number };
  pop: number;
  trains: string[];
  /**
   * Research is directed from here (the town hall, the castle): the building's card gets the
   * "Select research" button. Techs themselves belong to the whole community and are gated only by
   * their `requires`; a tech that needs a blacksmith says so with a building requirement.
   */
  research: boolean;
  /**
   * Buildings this one can turn into in place (town hall → castle, tower → better tower). The target's
   * own cost, time and requires are what the upgrade costs and needs; it is usually not `buildable`.
   */
  upgrades: string[];
  dropOff: boolean;
  /** Resources a drop-off takes; empty = every resource. A lumber mill takes lumber, a quarry stone. */
  accepts: string[];
  /** At most this many per player, counting ones under construction (a single shrine). */
  limit?: number;
  produces?: { resource: string; amount: number; interval: number };
  /** Shoots enemies within `range` tiles once complete (towers); with a `projectile` the shot flies there. */
  attack?: { damage: number; range: number; attackTime: number; projectile?: ProjectileDef };
  /** The owner's units walk through it; everyone else is blocked (gates). */
  passable: boolean;
  vision: number;
  hotkey?: string;
  /**
   * `model`: a GLB under /models/ authored to fill one hex (about 1 unit wide) with its base at y=0,
   * scaled up for larger footprints. `{team}` in the name is replaced by the owner's nearest KayKit colour
   * (red, blue, green, yellow). Without it the shape/color primitive is drawn.
   */
  visual: { shape: 'box' | 'cone'; color: string; height: number; glow?: string; model?: string };
}

export interface TechDef extends ProducibleDef {
  effects: Effect[];
}

export interface Rules {
  tickRate: number;
  /**
   * `starts`: start slots anywhere on land with room for a home zone, at least `startSpacing` hexes
   * apart when the land allows; players take the free one farthest from everyone.
   */
  map: {
    width: number; // hex columns
    height: number; // hex rows
    starts: number;
    startSpacing: number;
    /** Terrain id every hex starts as. */
    ground: string;
    /**
     * Present: the map is an island cut from 2D noise. `water` is the terrain outside the coast, `shore`
     * how much of the map's half-size is always sea at the edge (0.12 = a thin band), `scale` how big
     * the bays and peninsulas are (hexes), `land` the fraction of the whole map that is land. Only the
     * largest landmass is kept.
     */
    island?: { water: string; shore: number; scale: number; land: number };
    /**
     * Present: hexes get an elevation of 0..`levels` steps from seeded noise with features about
     * `scale` hexes across, independent of the coast. Water stays at 0; land hexes differ by at most
     * one step from each other, but may stand any number of steps above the sea (cliffs).
     * Purely a look for now; movement ignores it.
     */
    relief?: { levels: number; scale: number };
    /**
     * Clumps of other terrain scattered over the ground (hills, mountains): `per1000` clumps per 1000
     * land hexes, each a random walk of `size` hexes. Nothing spawns on them; whether units cross
     * them is the terrain's `passable`.
     */
    features: { terrain: string; per1000: number; size: [number, number] }[];
  };
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
  terrain: TerrainDef[];
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
