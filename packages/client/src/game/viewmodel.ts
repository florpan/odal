import {
  buildingMaxHp,
  buildingUnlocked,
  canAfford,
  countBuildings,
  describeRequirement,
  formatCost,
  hasTech,
  idx,
  isTechQueued,
  missingRequirement,
  ownsBuilding,
  popCap,
  popUsed,
  requirementsMet,
  unitMaxHp,
} from '@odal/engine';
import type { Building, GameState, Player, TechTree, Unit } from '@odal/engine';
import type { Input } from './input';
import type { World } from './world';

// ---------------------------------------------------------------------------
// The HUD view model: plain data derived from the game for React to render.
// All rule knowledge (costs, unlocks, affordability) is resolved here, so UI
// components stay dumb: they show labels and call session.action(id).
// ---------------------------------------------------------------------------

export interface ResourceView {
  id: string;
  name: string;
  icon: string;
  amount: number;
}

export interface ActionView {
  id: string; // build:<id> | train:<id> | research:<id> | attackMove | stop | clearRally
  label: string;
  sub: string;
  title: string;
  disabled: boolean;
  active: boolean;
  done?: boolean;
}

export interface QueueView {
  index: number;
  name: string;
  pct: number;
}

export type SelectionView =
  | { kind: 'none' }
  | {
      kind: 'unit';
      name: string;
      owner: string;
      color: string;
      hp: number;
      maxHp: number;
      task: string;
      carry: string | null;
      desc: string;
    }
  | { kind: 'units'; count: number; summary: string }
  | {
      kind: 'node';
      name: string;
      resource: string;
      icon: string;
      amount: number;
      total: number;
      gather: string;
      desc: string;
    }
  | {
      kind: 'building';
      name: string;
      owner: string;
      color: string;
      own: boolean;
      remembered: boolean;
      hp: number;
      maxHp: number;
      progress: number;
      desc: string;
      rally: string | null;
      queue: QueueView[];
    };

export interface MessageView {
  id: number;
  text: string;
  at: number;
}

/** How far the player is from having a unit, building or tech. */
export type RefStatus = 'owned' | 'inProgress' | 'available' | 'locked';

/** What the tech tree screen needs: the rules plus the player's progress through them. */
export interface TreeView {
  tree: TechTree;
  status: Record<string, RefStatus>; // keyed by refKey: unit:<id> | building:<id> | tech:<id>
  /** refKey → the player can pay for it right now. */
  affordable: Record<string, boolean>;
  /** tech refKey → 0..1 for techs being researched (rounded to whole percent). */
  progress: Record<string, number>;
}

export interface HudModel {
  player: { name: string; color: string } | null;
  resources: ResourceView[];
  pop: { used: number; cap: number };
  selection: SelectionView;
  actions: ActionView[];
  modeHint: string;
  messages: MessageView[];
  tree: TreeView | null;
}

export const EMPTY_HUD: HudModel = {
  player: null,
  resources: [],
  pop: { used: 0, cap: 0 },
  selection: { kind: 'none' },
  actions: [],
  modeHint: '',
  messages: [],
  tree: null,
};

type TreeProgress = Pick<TreeView, 'status' | 'affordable' | 'progress'>;
let lastProgress: TreeProgress = { status: {}, affordable: {}, progress: {} };

/** The player's progress per tree item. Returns the previous object when nothing changed so React can skip. */
function treeProgress(st: GameState, me: Player): TreeProgress {
  const defs = idx(st.tree);
  const alive = new Set<string>();
  const queuedUnits = new Set<string>();
  const trainers = new Set<string>();
  const researchers = new Set<string>();
  const building = new Set<string>();
  const progress: Record<string, number> = {};
  for (const id in st.units) if (st.units[id].owner === me.id) alive.add(st.units[id].type);
  for (const id in st.buildings) {
    const b = st.buildings[id];
    if (b.owner !== me.id) continue;
    if (b.progress < 1) {
      building.add(b.type);
      continue;
    }
    for (const q of b.queue) if (q.kind === 'unit') queuedUnits.add(q.type);
    const head = b.queue[0];
    if (head?.kind === 'tech')
      progress[`tech:${head.id}`] = Math.round((100 * b.queueProgress) / defs.techs[head.id].time) / 100;
    for (const t of defs.buildings[b.type].trains) trainers.add(t);
    for (const t of defs.buildings[b.type].researches) researchers.add(t);
  }
  const status: Record<string, RefStatus> = {};
  const affordable: Record<string, boolean> = {};
  for (const x of [...st.tree.units, ...st.tree.buildings, ...st.tree.techs]) {
    const kind = st.tree.units.includes(x as never)
      ? 'unit'
      : st.tree.buildings.includes(x as never)
        ? 'building'
        : 'tech';
    affordable[`${kind}:${x.id}`] = canAfford(me.resources, x.cost);
  }
  for (const u of st.tree.units) {
    status[`unit:${u.id}`] = alive.has(u.id)
      ? 'owned'
      : queuedUnits.has(u.id)
        ? 'inProgress'
        : trainers.has(u.id) && requirementsMet(st, me, u.requires)
          ? 'available'
          : 'locked';
  }
  for (const b of st.tree.buildings) {
    status[`building:${b.id}`] = ownsBuilding(st, me.id, b.id)
      ? 'owned'
      : building.has(b.id)
        ? 'inProgress'
        : b.buildable && requirementsMet(st, me, b.requires)
          ? 'available'
          : 'locked';
  }
  for (const t of st.tree.techs) {
    status[`tech:${t.id}`] = hasTech(me, t.id)
      ? 'owned'
      : isTechQueued(st, me.id, t.id)
        ? 'inProgress'
        : researchers.has(t.id) && requirementsMet(st, me, t.requires)
          ? 'available'
          : 'locked';
  }
  const keys = Object.keys(status);
  const same =
    keys.length === Object.keys(lastProgress.status).length &&
    keys.every(
      (k) =>
        lastProgress.status[k] === status[k] &&
        lastProgress.affordable[k] === affordable[k] &&
        lastProgress.progress[k] === progress[k],
    );
  if (!same) lastProgress = { status, affordable, progress };
  return lastProgress;
}

export function buildHud(world: World, input: Input | null): HudModel {
  const st = world.state;
  const me = world.me();
  if (!st || !me) return { ...EMPTY_HUD, messages: world.messages };
  const tree = st.tree;
  const defs = idx(tree);

  const resources = tree.resources.map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    amount: Math.floor(me.resources[r.id] ?? 0),
  }));
  const pop = { used: popUsed(st, me.id), cap: popCap(st, me.id) };

  let selection: SelectionView = { kind: 'none' };
  const actions: ActionView[] = [];
  let modeHint = '';

  const bId = world.selectedBuilding;
  const b = bId !== null ? world.building(bId) : undefined;
  const units = world.selectedUnits.map((id) => st.units[id]).filter(Boolean);
  const node = world.selectedNode !== null ? st.nodes[world.selectedNode] : undefined;

  if (b) {
    const def = defs.buildings[b.type];
    const owner = st.players[b.owner];
    const remembered = !st.buildings[b.id];
    const own = b.owner === me.id && !remembered;
    selection = {
      kind: 'building',
      name: def.name,
      owner: owner?.name ?? '?',
      color: owner?.color ?? '#fff',
      own,
      remembered,
      hp: Math.ceil(b.hp),
      maxHp: Math.round(buildingMaxHp(tree, owner, b.type)),
      progress: b.progress,
      desc: def.desc,
      rally:
        own && b.rally ? (b.rally.nodeId !== undefined ? 'Rally point set (auto-harvest)' : 'Rally point set') : null,
      queue: own
        ? b.queue.map((q, i) => {
            const name =
              q.kind === 'unit'
                ? defs.units[q.type].name
                : q.kind === 'upgrade'
                  ? `Upgrade: ${defs.buildings[q.type].name}`
                  : defs.techs[q.id].name;
            const total =
              q.kind === 'unit'
                ? defs.units[q.type].time
                : q.kind === 'upgrade'
                  ? defs.buildings[q.type].time
                  : defs.techs[q.id].time;
            return { index: i, name, pct: i === 0 ? Math.floor((100 * b.queueProgress) / total) : 0 };
          })
        : [],
    };
    if (own && b.progress >= 1) {
      for (const type of def.trains) {
        const u = defs.units[type];
        const missing = missingRequirement(st, me, u.requires);
        const upkeep = Object.keys(u.upkeep).length
          ? ` Upkeep: ${formatCost(tree, u.upkeep)} per ${tree.rules.upkeepInterval}s.`
          : '';
        actions.push({
          id: `train:${type}`,
          label: `Train ${u.name}`,
          sub: missing ? `Requires ${describeRequirement(tree, missing)}` : formatCost(tree, u.cost),
          title: `${u.desc} ${u.time}s.${upkeep}`,
          disabled: !!missing || !canAfford(me.resources, u.cost),
          active: false,
        });
      }
      for (const tech of def.researches) {
        const t = defs.techs[tech];
        const done = hasTech(me, tech);
        const queued = isTechQueued(st, me.id, tech);
        const missing = missingRequirement(st, me, t.requires);
        const sub = done
          ? 'Researched'
          : queued
            ? 'In progress'
            : missing
              ? `Requires ${describeRequirement(tree, missing)}`
              : formatCost(tree, t.cost);
        actions.push({
          id: `research:${tech}`,
          label: t.name,
          sub,
          title: `${t.desc} ${t.time}s`,
          disabled: done || queued || !!missing || !canAfford(me.resources, t.cost),
          active: false,
          done,
        });
      }
      for (const target of def.upgrades) {
        const t = defs.buildings[target];
        const queued = b.queue.some((q) => q.kind === 'upgrade');
        const missing = missingRequirement(st, me, t.requires);
        actions.push({
          id: `upgrade:${target}`,
          label: `Upgrade to ${t.name}`,
          sub: queued
            ? 'In progress'
            : missing
              ? `Requires ${describeRequirement(tree, missing)}`
              : formatCost(tree, t.cost),
          title: `${t.desc} ${t.time}s. The building keeps working meanwhile.`,
          disabled: queued || !!missing || !canAfford(me.resources, t.cost),
          active: false,
        });
      }
      if (b.rally)
        actions.push({
          id: 'clearRally',
          label: 'Clear rally',
          sub: 'New units stay here',
          title: 'Clear rally point',
          disabled: false,
          active: false,
        });
      actions.push({
        id: 'rotate',
        label: 'Rotate (Q)',
        sub: 'A sixth of a turn',
        title: 'Turn the building to face another side. Shift+Q turns it back.',
        disabled: false,
        active: false,
      });
      if (def.researches.length)
        actions.push({
          id: 'tree',
          label: 'Tech tree (Tab)',
          sub: 'Plan research',
          title: 'Open the tech tree. Research can be queued from there too.',
          disabled: false,
          active: false,
        });
      if (def.trains.length && !input?.buildMode && !input?.attackMoveMode)
        modeHint = 'Right-click the ground or a resource to set the rally point';
    }
  } else if (node) {
    const nd = defs.nodes[node.type];
    const res = defs.resources[nd.resource];
    selection = {
      kind: 'node',
      name: nd.name,
      resource: res?.name ?? nd.resource,
      icon: res?.icon ?? '',
      amount: node.amount,
      total: nd.amount,
      gather: `${nd.gatherAmount} ${res?.name.toLowerCase() ?? nd.resource} per ${nd.gatherTime}s trip`,
      desc: nd.desc,
    };
  } else if (units.length === 1) {
    const u = units[0];
    const def = defs.units[u.type];
    const owner = st.players[u.owner];
    selection = {
      kind: 'unit',
      name: def.name,
      owner: owner?.name ?? '?',
      color: owner?.color ?? '#fff',
      hp: Math.ceil(u.hp),
      maxHp: Math.round(owner ? unitMaxHp(tree, owner, u.type) : def.hp),
      task: describeTask(u, world),
      carry: u.carry
        ? `Carrying ${u.carry.amount} ${defs.resources[u.carry.type]?.name.toLowerCase() ?? u.carry.type}`
        : null,
      desc: def.desc,
    };
  } else if (units.length > 1) {
    const counts = new Map<string, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    const summary = [...counts.entries()]
      .map(([t, n]) => `${n} ${defs.units[t].name.toLowerCase()}${n > 1 ? 's' : ''}`)
      .join(', ');
    selection = { kind: 'units', count: units.length, summary };
  }

  const own = units.filter((u) => u.owner === me.id);
  if (own.length) {
    if (own.some((u) => defs.units[u.type].abilities.includes('build'))) {
      for (const bd of tree.buildings) {
        if (!bd.buildable) continue;
        const unlocked = buildingUnlocked(st, me, bd.id);
        const missing = missingRequirement(st, me, bd.requires);
        const atLimit = bd.limit !== undefined && countBuildings(st, me.id, bd.id) >= bd.limit;
        actions.push({
          id: `build:${bd.id}`,
          label: bd.hotkey ? `${bd.name} (${bd.hotkey.toUpperCase()})` : bd.name,
          sub: atLimit
            ? bd.limit === 1
              ? 'Already built'
              : `Limit ${bd.limit}`
            : unlocked
              ? formatCost(tree, bd.cost)
              : missing
                ? `Requires ${describeRequirement(tree, missing)}`
                : 'Locked',
          title: `${bd.desc} Cost: ${formatCost(tree, bd.cost)}`,
          disabled: atLimit || !unlocked || !canAfford(me.resources, bd.cost),
          active: input?.buildMode === bd.id,
        });
      }
    }
    if (own.some((u) => defs.units[u.type].abilities.includes('attack'))) {
      actions.push({
        id: 'attackMove',
        label: 'Attack-move (A)',
        sub: 'Fight anything on the way',
        title: 'Attack-move',
        disabled: false,
        active: !!input?.attackMoveMode,
      });
    }
    actions.push({
      id: 'stop',
      label: 'Stop (S)',
      sub: 'Halt current task',
      title: 'Stop',
      disabled: false,
      active: false,
    });
  }

  if (input?.buildMode) {
    modeHint = `Placing ${defs.buildings[input.buildMode].name}: click to place, Shift-click for several, Esc to cancel`;
  } else if (input?.attackMoveMode) {
    modeHint = 'Attack-move: click where to go. Esc to cancel';
  }

  return {
    player: { name: me.name, color: me.color },
    resources,
    pop,
    selection,
    actions,
    modeHint,
    messages: world.messages,
    tree: { tree, ...treeProgress(st, me) },
  };
}

function describeTask(u: Unit, world: World): string {
  const t = u.task;
  const nodeName = (type: string) => idx(world.state!.tree).nodes[type]?.name.toLowerCase() ?? type;
  switch (t.kind) {
    case 'idle':
      return 'Idle';
    case 'move':
      return 'Moving';
    case 'attackMove':
      return 'Attack-moving';
    case 'harvest':
      return t.phase === 'gathering'
        ? `Gathering ${nodeName(t.nodeType)}`
        : t.phase === 'toDrop'
          ? 'Returning resources'
          : `Going to ${nodeName(t.nodeType)}`;
    case 'build':
      return 'Building';
    case 'attack':
      return 'Attacking';
  }
}

export type { Building };
