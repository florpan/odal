import { canPlaceFootprint, footprintDistance } from './grid';
import { hexCentre } from './hex';
import type { Ability, Effect, EffectType, Requirement, TechTree } from './content';
import { idx } from './tree';
import type { Building, GameState, Player, ResourceNode, Resources, Unit, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Read-only questions about the game, used by the simulation, the server and
// the client UI alike. No side effects in here.
// ---------------------------------------------------------------------------

export function canAfford(res: Resources, cost: Resources): boolean {
  return Object.keys(cost).every((k) => (res[k] ?? 0) >= cost[k]);
}

export function pay(res: Resources, cost: Resources): void {
  for (const k of Object.keys(cost)) res[k] = (res[k] ?? 0) - cost[k];
}

export function refund(res: Resources, cost: Resources): void {
  for (const k of Object.keys(cost)) res[k] = (res[k] ?? 0) + cost[k];
}

export function hasTech(player: Player, tech: string): boolean {
  return player.techs.includes(tech);
}

export function hasAbility(tree: TechTree, u: Unit, ability: Ability): boolean {
  return idx(tree).units[u.type].abilities.includes(ability);
}

// ---------------------------------------------------------------------------
// Tech effects
// ---------------------------------------------------------------------------

/** Product of all matching effect multipliers from the player's researched techs. */
export function effectMultiplier(
  tree: TechTree,
  player: Player,
  type: EffectType,
  matches: (e: Effect) => boolean = () => true,
): number {
  const techs = idx(tree).techs;
  let m = 1;
  for (const id of player.techs) {
    const tech = techs[id];
    if (!tech) continue;
    for (const e of tech.effects) if (e.type === type && matches(e)) m *= e.multiplier;
  }
  return m;
}

/** True when an effect's optional filter (e.g. `unit`) is absent or equals `value`. */
function targets(e: Effect, key: 'resource' | 'building' | 'unit', value: string): boolean {
  const v = (e as Record<string, unknown>)[key];
  return v === undefined || v === value;
}

export const gatherRate = (tree: TechTree, player: Player, resource: string) =>
  effectMultiplier(tree, player, 'gatherRate', (e) => targets(e, 'resource', resource));

export const produceRate = (tree: TechTree, player: Player, building: string) =>
  effectMultiplier(tree, player, 'produceRate', (e) => targets(e, 'building', building));

export const buildSpeed = (tree: TechTree, player: Player) => effectMultiplier(tree, player, 'buildSpeed');

export const unitDamage = (tree: TechTree, player: Player, unit: string) =>
  idx(tree).units[unit].damage * effectMultiplier(tree, player, 'damage', (e) => targets(e, 'unit', unit));

export const unitMaxHp = (tree: TechTree, player: Player, unit: string) =>
  idx(tree).units[unit].hp * effectMultiplier(tree, player, 'maxHp', (e) => targets(e, 'unit', unit));

export const unitSpeed = (tree: TechTree, player: Player, unit: string) =>
  idx(tree).units[unit].speed * effectMultiplier(tree, player, 'speed', (e) => targets(e, 'unit', unit));

export const buildingMaxHp = (tree: TechTree, player: Player | undefined, building: string) =>
  idx(tree).buildings[building].hp *
  (player ? effectMultiplier(tree, player, 'buildingHp', (e) => targets(e, 'building', building)) : 1);

// ---------------------------------------------------------------------------
// Population and unlocks
// ---------------------------------------------------------------------------

export function popCap(state: GameState, playerId: number): number {
  const defs = idx(state.tree).buildings;
  let cap = 0;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === playerId && b.progress >= 1) cap += defs[b.type].pop;
  }
  return cap;
}

/** Population of living units. */
export function popAlive(state: GameState, playerId: number): number {
  const defs = idx(state.tree).units;
  let n = 0;
  for (const id in state.units) {
    const u = state.units[id];
    if (u.owner === playerId) n += defs[u.type].pop;
  }
  return n;
}

/** Population of living units plus units waiting in production queues. */
export function popUsed(state: GameState, playerId: number): number {
  const defs = idx(state.tree).units;
  let n = popAlive(state, playerId);
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner !== playerId) continue;
    for (const q of b.queue) if (q.kind === 'unit') n += defs[q.type].pop;
  }
  return n;
}

export function countUnits(state: GameState, playerId: number): number {
  let n = 0;
  for (const id in state.units) if (state.units[id].owner === playerId) n++;
  return n;
}

export function isTechQueued(state: GameState, playerId: number, tech: string): boolean {
  return state.players[playerId]?.research.includes(tech) ?? false;
}

/** True when the player owns a completed building of this type. */
export function ownsBuilding(state: GameState, playerId: number, building: string): boolean {
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === playerId && b.type === building && b.progress >= 1) return true;
  }
  return false;
}

export function requirementMet(state: GameState, player: Player, r: Requirement): boolean {
  switch (r.type) {
    case 'tech':
      return hasTech(player, r.id);
    case 'building':
      return ownsBuilding(state, player.id, r.id);
    case 'population':
      return popAlive(state, player.id) >= r.min;
  }
}

export function requirementsMet(state: GameState, player: Player, requires: Requirement[]): boolean {
  return requires.every((r) => requirementMet(state, player, r));
}

/** The first missing requirement, for UI hints and rejection messages. */
export function missingRequirement(state: GameState, player: Player, requires: Requirement[]): Requirement | undefined {
  return requires.find((r) => !requirementMet(state, player, r));
}

export function buildingUnlocked(state: GameState, player: Player, building: string): boolean {
  const def = idx(state.tree).buildings[building];
  return !!def && def.buildable && requirementsMet(state, player, def.requires);
}

/** Own buildings of a type, finished or not (what a building `limit` counts). */
export function countBuildings(state: GameState, playerId: number, building: string): number {
  let n = 0;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    if (b.owner === playerId && b.type === building) n++;
  }
  return n;
}

/** Whether an own building can start turning into `target`: listed in its upgrades, requirements met, not already queued. */
export function upgradeUnlocked(state: GameState, player: Player, b: Building, target: string): boolean {
  const defs = idx(state.tree).buildings;
  const def = defs[target];
  if (!def || !defs[b.type].upgrades.includes(target) || b.progress < 1) return false;
  if (b.queue.some((q) => q.kind === 'upgrade')) return false;
  return requirementsMet(state, player, def.requires);
}

export function unitUnlocked(state: GameState, player: Player, unit: string): boolean {
  const def = idx(state.tree).units[unit];
  return !!def && requirementsMet(state, player, def.requires);
}

export function techUnlocked(state: GameState, player: Player, tech: string): boolean {
  const def = idx(state.tree).techs[tech];
  return !!def && requirementsMet(state, player, def.requires);
}

// ---------------------------------------------------------------------------
// Spatial
// ---------------------------------------------------------------------------

/** True when the building's footprint, centred on hex (x, y), is free. */
export function canPlaceBuilding(
  state: GameState,
  blocked: Uint8Array,
  building: string,
  x: number,
  y: number,
): boolean {
  const def = idx(state.tree).buildings[building];
  return !!def && canPlaceFootprint(blocked, state.width, state.height, x, y, def.size.radius);
}

export function findNearbyNode(state: GameState, from: Vec2, type: string, radius: number): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestD = radius * radius;
  for (const id in state.nodes) {
    const n = state.nodes[id];
    if (n.type !== type) continue;
    const c = hexCentre(n.x, n.y);
    const d = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** The closest finished own drop-off that takes `resource` (any drop-off when no resource is given). */
export function nearestDropOff(state: GameState, u: Unit, resource?: string): Building | null {
  const defs = idx(state.tree).buildings;
  let best: Building | null = null;
  let bestD = Infinity;
  for (const id in state.buildings) {
    const b = state.buildings[id];
    const def = defs[b.type];
    if (b.owner !== u.owner || b.progress < 1 || !def.dropOff) continue;
    if (resource && def.accepts.length && !def.accepts.includes(resource)) continue;
    const d = footprintDistance(u, b.x, b.y, b.r);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
