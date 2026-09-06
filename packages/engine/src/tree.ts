import { z } from 'zod';
import type {
  BuildingDef,
  Cost,
  Effect,
  NodeDef,
  Requirement,
  ResourceDef,
  Rules,
  StartDef,
  TechDef,
  TechTree,
  TerrainDef,
  UnitDef,
} from './content';
import { buildGraph, findCycle, refKey, refName, unobtainable } from './techgraph';

// ---------------------------------------------------------------------------
// Tech tree schema and validation.
//
// The interfaces in content.ts are the source of truth; the schemas below
// are asserted (at compile time, bottom of this file) to produce exactly
// those types. Authors write the *Input types (defaults optional), see
// packages/content. Objects are strict: unknown keys are errors, which
// catches typos in field names.
// ---------------------------------------------------------------------------

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lowercase snake_case');
const CostSchema = z.record(Id, z.number().min(0));
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');
const Positive = z.number().positive();
const NonNeg = z.number().min(0);

export const RequirementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tech'), id: Id }).strict(),
  z.object({ type: z.literal('building'), id: Id }).strict(),
  z.object({ type: z.literal('population'), min: z.number().int().min(1) }).strict(),
]);

/** What a technology changes once researched. Filters are optional: omit to affect everything. */
export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gatherRate'), resource: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('produceRate'), building: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('damage'), unit: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('maxHp'), unit: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('speed'), unit: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('buildingHp'), building: Id.optional(), multiplier: Positive }).strict(),
  z.object({ type: z.literal('buildSpeed'), multiplier: Positive }).strict(),
]);

/** How a resource node is scattered over a generated map. */
const spawnCommon = {
  /** Clusters / deposits guaranteed within rules.homeRadius of every start slot. */
  perStart: z.number().int().min(0).default(0),
  /** Where the per-1000-tiles scatter may land. */
  zone: z.enum(['anywhere', 'centre']).default('anywhere'),
};
export const SpawnSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('forest'),
      clustersPer1000Tiles: NonNeg,
      radius: z.tuple([Positive, Positive]),
      ...spawnCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal('deposit'),
      depositsPer1000Tiles: NonNeg,
      size: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      ...spawnCommon,
    })
    .strict(),
]);

const entity = { id: Id, name: z.string().min(1), desc: z.string().default(''), notes: z.string().default('') };
const producible = {
  ...entity,
  cost: CostSchema.default({}),
  time: NonNeg,
  requires: z.array(RequirementSchema).default([]),
};

export const ResourceSchema = z.object({ ...entity, icon: z.string().default('') }).strict();

export const TerrainSchema = z
  .object({
    ...entity,
    passable: z.boolean().default(true),
    visual: z
      .object({
        color: Color,
        /** Top of the tile relative to the ground plane; water below 0 makes a shore step. */
        height: z.number().default(0),
        /** GLB hex tile under /models/, one hex wide, top at y=0. */
        model: z.string().min(1).optional(),
        /** Coast tiles by consecutive water edges (1..n), water side authored towards +z. */
        shore: z.array(z.string().min(1)).min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const NodeSchema = z
  .object({
    ...entity,
    resource: Id,
    amount: Positive,
    gatherTime: Positive,
    gatherAmount: Positive,
    spawn: SpawnSchema,
    visual: z
      .object({
        shape: z.enum(['cone', 'rock']),
        color: Color,
        /** GLB file names under /models/ at world scale, picked per node by id. */
        models: z.array(z.string().min(1)).min(1).optional(),
        /** Size multiplier applied to all the models equally (default 1). */
        scale: Positive.optional(),
      })
      .strict(),
  })
  .strict();

export const UnitSchema = z
  .object({
    ...producible,
    hp: Positive,
    speed: Positive,
    damage: NonNeg.default(0),
    range: Positive.default(1),
    attackTime: Positive.default(1),
    aggro: NonNeg.default(0),
    vision: Positive.default(6),
    pop: NonNeg.default(1),
    upkeep: CostSchema.default({}),
    abilities: z.array(z.enum(['harvest', 'build', 'attack'])).default([]),
    visual: z
      .object({
        width: Positive.default(0.4),
        height: Positive.default(1),
        helmet: z.boolean().default(false),
        /** File name under /models/, e.g. "worker.glb". Authored at height 1, feet at y=0, facing +z. */
        model: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const BuildingSchema = z
  .object({
    ...producible,
    buildable: z.boolean().default(true),
    hp: Positive,
    /** Footprint radius in hexes: 0 = one hex, 1 = seven. */
    size: z
      .object({ radius: z.number().int().min(0).default(0) })
      .strict()
      .default({ radius: 0 }),
    pop: NonNeg.default(0),
    trains: z.array(Id).default([]),
    researches: z.array(Id).default([]),
    dropOff: z.boolean().default(false),
    produces: z.object({ resource: Id, amount: Positive, interval: Positive }).strict().optional(),
    attack: z.object({ damage: Positive, range: Positive, attackTime: Positive }).strict().optional(),
    passable: z.boolean().default(false),
    vision: Positive.default(6),
    hotkey: z.string().length(1).optional(),
    visual: z
      .object({
        shape: z.enum(['box', 'cone']).default('box'),
        color: Color,
        height: Positive.default(1),
        glow: Color.optional(),
        /** GLB under /models/ filling one hex; "{team}" → owner's nearest KayKit colour. */
        model: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const TechSchema = z.object({ ...producible, effects: z.array(EffectSchema).default([]) }).strict();

export const RulesSchema = z
  .object({
    tickRate: z.number().int().min(1).max(60).default(10),
    map: z
      .object({
        width: z.number().int().min(16).max(256),
        height: z.number().int().min(16).max(256),
        starts: z.number().int().min(2).max(8).default(4),
        ground: Id,
        island: z
          .object({
            water: Id,
            shore: z.number().min(0).max(0.4).default(0.12),
            roughness: z.number().min(0).max(0.3).default(0.06),
          })
          .strict()
          .optional(),
        relief: z
          .object({ levels: z.number().int().min(1).max(4), scale: Positive.default(9) })
          .strict()
          .optional(),
      })
      .strict(),
    homeRadius: Positive.default(12),
    startResources: CostSchema,
    maxQueue: z.number().int().min(1).default(5),
    separationDist: NonNeg.default(0.6),
    startClearRadius: NonNeg.default(4),
    upkeepInterval: Positive.default(60),
    playerColors: z.array(Color).min(1),
  })
  .strict();

export const StartSchema = z
  .object({ building: Id, units: z.array(z.object({ type: Id, count: z.number().int().min(1) }).strict()) })
  .strict();

export const TechTreeSchema = z
  .object({
    name: z.string().min(1),
    version: z.literal(1),
    rules: RulesSchema,
    resources: z.array(ResourceSchema).min(1),
    terrain: z.array(TerrainSchema).min(1),
    nodes: z.array(NodeSchema),
    units: z.array(UnitSchema).min(1),
    buildings: z.array(BuildingSchema).min(1),
    techs: z.array(TechSchema),
    start: StartSchema,
  })
  .strict();

/** What ruleset authors write: fields with defaults are optional. */
export type ResourceDefInput = z.input<typeof ResourceSchema>;
export type TerrainDefInput = z.input<typeof TerrainSchema>;
export type NodeDefInput = z.input<typeof NodeSchema>;
export type UnitDefInput = z.input<typeof UnitSchema>;
export type BuildingDefInput = z.input<typeof BuildingSchema>;
export type TechDefInput = z.input<typeof TechSchema>;
export type RulesInput = z.input<typeof RulesSchema>;
export type StartInput = z.input<typeof StartSchema>;
export type TechTreeInput = z.input<typeof TechTreeSchema>;

// Compile-time proof that the schemas produce the content.ts interfaces (mutual assignability).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _Checks = [
  Assert<Same<z.infer<typeof ResourceSchema>, ResourceDef>>,
  Assert<Same<z.infer<typeof TerrainSchema>, TerrainDef>>,
  Assert<Same<z.infer<typeof NodeSchema>, NodeDef>>,
  Assert<Same<z.infer<typeof UnitSchema>, UnitDef>>,
  Assert<Same<z.infer<typeof BuildingSchema>, BuildingDef>>,
  Assert<Same<z.infer<typeof TechSchema>, TechDef>>,
  Assert<Same<z.infer<typeof RulesSchema>, Rules>>,
  Assert<Same<z.infer<typeof StartSchema>, StartDef>>,
  Assert<Same<z.infer<typeof TechTreeSchema>, TechTree>>,
];

// ---------------------------------------------------------------------------
// Lookups. The tree itself stays plain data (it is sent over the wire); the
// id → def maps are built on demand and cached per tree object.
// ---------------------------------------------------------------------------

export interface TreeIndex {
  resources: Record<string, ResourceDef>;
  terrain: Record<string, TerrainDef>;
  nodes: Record<string, NodeDef>;
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  techs: Record<string, TechDef>;
  resourceIds: string[];
}

const indexCache = new WeakMap<TechTree, TreeIndex>();

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
}

export function idx(tree: TechTree): TreeIndex {
  let i = indexCache.get(tree);
  if (!i) {
    i = {
      resources: byId(tree.resources),
      terrain: byId(tree.terrain),
      nodes: byId(tree.nodes),
      units: byId(tree.units),
      buildings: byId(tree.buildings),
      techs: byId(tree.techs),
      resourceIds: tree.resources.map((r) => r.id),
    };
    indexCache.set(tree, i);
  }
  return i;
}

// ---------------------------------------------------------------------------
// Validation: schema first, then every cross-reference, then the graph.
// ---------------------------------------------------------------------------

export interface TreeValidation {
  tree?: TechTree;
  errors: string[];
}

export function validateTree(data: unknown): TreeValidation {
  const parsed = TechTreeSchema.safeParse(data);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const t = parsed.data;
  const errors: string[] = [];
  const ids = {
    resources: new Set(t.resources.map((x) => x.id)),
    terrain: new Set(t.terrain.map((x) => x.id)),
    units: new Set(t.units.map((x) => x.id)),
    buildings: new Set(t.buildings.map((x) => x.id)),
    techs: new Set(t.techs.map((x) => x.id)),
  };

  for (const [kind, list] of Object.entries({
    resources: t.resources,
    terrain: t.terrain,
    nodes: t.nodes,
    units: t.units,
    buildings: t.buildings,
    techs: t.techs,
  })) {
    const seen = new Set<string>();
    for (const item of list as { id: string }[]) {
      if (seen.has(item.id)) errors.push(`${kind}: duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }

  const checkCost = (where: string, cost: Cost) => {
    for (const k of Object.keys(cost)) if (!ids.resources.has(k)) errors.push(`${where}: unknown resource "${k}"`);
  };
  const checkRef = (where: string, set: Set<string>, id: string | undefined, kind: string) => {
    if (id !== undefined && !set.has(id)) errors.push(`${where}: unknown ${kind} "${id}"`);
  };
  const checkRequires = (where: string, requires: Requirement[]) => {
    for (const r of requires) {
      if (r.type === 'population') continue;
      checkRef(where, r.type === 'tech' ? ids.techs : ids.buildings, r.id, r.type);
    }
  };

  checkCost('rules.startResources', t.rules.startResources);
  checkRef('rules.map.ground', ids.terrain, t.rules.map.ground, 'terrain');
  const ground = t.terrain.find((x) => x.id === t.rules.map.ground);
  if (ground && !ground.passable) errors.push('rules.map.ground: the ground terrain must be passable');
  if (t.rules.map.island) {
    checkRef('rules.map.island.water', ids.terrain, t.rules.map.island.water, 'terrain');
    if (t.rules.map.island.water === t.rules.map.ground)
      errors.push('rules.map.island.water: must differ from rules.map.ground');
  }
  for (const n of t.nodes) checkRef(`nodes.${n.id}.resource`, ids.resources, n.resource, 'resource');

  for (const u of t.units) {
    checkCost(`units.${u.id}.cost`, u.cost);
    checkCost(`units.${u.id}.upkeep`, u.upkeep);
    checkRequires(`units.${u.id}.requires`, u.requires);
  }

  const hotkeys = new Map<string, string>();
  for (const b of t.buildings) {
    checkCost(`buildings.${b.id}.cost`, b.cost);
    checkRequires(`buildings.${b.id}.requires`, b.requires);
    for (const u of b.trains) checkRef(`buildings.${b.id}.trains`, ids.units, u, 'unit');
    for (const r of b.researches) checkRef(`buildings.${b.id}.researches`, ids.techs, r, 'tech');
    if (b.produces) checkRef(`buildings.${b.id}.produces.resource`, ids.resources, b.produces.resource, 'resource');
    if (b.hotkey) {
      const key = b.hotkey.toUpperCase();
      if (hotkeys.has(key)) errors.push(`buildings.${b.id}.hotkey: "${key}" already used by "${hotkeys.get(key)}"`);
      hotkeys.set(key, b.id);
    }
  }

  for (const tech of t.techs) {
    checkCost(`techs.${tech.id}.cost`, tech.cost);
    checkRequires(`techs.${tech.id}.requires`, tech.requires);
    tech.effects.forEach((e, i) => {
      const where = `techs.${tech.id}.effects[${i}]`;
      if ('resource' in e) checkRef(where, ids.resources, e.resource, 'resource');
      if ('building' in e) checkRef(where, ids.buildings, e.building, 'building');
      if ('unit' in e) checkRef(where, ids.units, e.unit, 'unit');
    });
  }

  checkRef('start.building', ids.buildings, t.start.building, 'building');
  for (const s of t.start.units) checkRef('start.units', ids.units, s.type, 'unit');
  const startDef = t.buildings.find((b) => b.id === t.start.building);
  if (startDef && !startDef.dropOff) errors.push('start.building: the starting building must be a dropOff');

  // Graph checks only make sense once every reference resolves.
  if (!errors.length) {
    const graph = buildGraph(t);
    const cycle = findCycle(graph);
    if (cycle) errors.push(`dependency cycle: ${cycle.map((r) => refName(t, r)).join(' → ')}`);
    for (const r of unobtainable(t, graph)) {
      const why =
        r.kind === 'unit'
          ? 'no obtainable building trains it'
          : r.kind === 'tech'
            ? 'no obtainable building researches it'
            : 'its requirements can never be met';
      errors.push(`${refKey(r)}: unobtainable (${why})`);
    }
  }

  return { tree: t, errors };
}

/** Parse and validate, throwing a readable error on any problem. */
export function parseTree(data: unknown): TechTree {
  const { tree, errors } = validateTree(data);
  if (errors.length || !tree) throw new Error(`Invalid tech tree:\n  ${errors.join('\n  ')}`);
  return tree;
}

export function formatCost(tree: TechTree, cost: Cost): string {
  const parts = idx(tree)
    .resourceIds.filter((r) => (cost[r] ?? 0) > 0)
    .map((r) => `${cost[r]} ${idx(tree).resources[r].name.toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'free';
}

export function describeRequirement(tree: TechTree, r: Requirement): string {
  if (r.type === 'population') return `${r.min} population`;
  return refName(tree, { kind: r.type, id: r.id });
}

/** One line of plain English for a tech effect, e.g. "Soldier damage ×1.5". */
export function describeEffect(tree: TechTree, e: Effect): string {
  const i = idx(tree);
  const pct = `×${e.multiplier}`;
  const name = (list: Record<string, { name: string }>, id: string | undefined, all: string) =>
    id ? (list[id]?.name ?? id) : all;
  switch (e.type) {
    case 'gatherRate':
      return `${name(i.resources, e.resource, 'All')} gathering ${pct}`;
    case 'produceRate':
      return `${name(i.buildings, e.building, 'All buildings')} production ${pct}`;
    case 'damage':
      return `${name(i.units, e.unit, 'All units')} damage ${pct}`;
    case 'maxHp':
      return `${name(i.units, e.unit, 'All units')} max HP ${pct}`;
    case 'speed':
      return `${name(i.units, e.unit, 'All units')} speed ${pct}`;
    case 'buildingHp':
      return `${name(i.buildings, e.building, 'All buildings')} HP ${pct}`;
    case 'buildSpeed':
      return `Construction speed ${pct}`;
  }
}

/** A ruleset on disk is seven JSON files with these names. */
export const RULESET_FILES = ['rules', 'resources', 'terrain', 'nodes', 'units', 'buildings', 'techs'] as const;
export type RulesetFile = (typeof RULESET_FILES)[number];
/** The files as raw JSON values, as authored (defaults not applied). */
export type RulesetFiles = Record<RulesetFile, unknown>;

/** Drop editor-only keys (`$schema`) so strict validation accepts the file. */
function stripMeta(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { $schema: _schema, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

/** Merge the files of a ruleset into one tree object (unvalidated; feed it to validateTree). */
export function mergeFiles(files: RulesetFiles): unknown {
  const base = stripMeta(files.rules) as Record<string, unknown>;
  return {
    ...base,
    resources: stripMeta(files.resources),
    terrain: stripMeta(files.terrain),
    nodes: stripMeta(files.nodes),
    units: stripMeta(files.units),
    buildings: stripMeta(files.buildings),
    techs: stripMeta(files.techs),
  };
}

/**
 * The per-file schemas keyed by ruleset file name, for tools that walk the
 * schema (the content editor builds its forms from this).
 */
export const FILE_SCHEMAS = {
  rules: z.object({ name: z.string().min(1), version: z.literal(1), rules: RulesSchema, start: StartSchema }).strict(),
  resources: ResourceSchema,
  terrain: TerrainSchema,
  nodes: NodeSchema,
  units: UnitSchema,
  buildings: BuildingSchema,
  techs: TechSchema,
} as const;
