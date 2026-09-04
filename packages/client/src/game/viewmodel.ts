import {
  buildingUnlocked,
  canAfford,
  describeRequirement,
  formatCost,
  hasTech,
  idx,
  isTechQueued,
  missingRequirement,
  popCap,
  popUsed,
  unitMaxHp,
} from '@odal/engine';
import type { Building, Unit } from '@odal/engine';
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

export interface HudModel {
  player: { name: string; color: string } | null;
  resources: ResourceView[];
  pop: { used: number; cap: number };
  selection: SelectionView;
  actions: ActionView[];
  modeHint: string;
  messages: MessageView[];
}

export const EMPTY_HUD: HudModel = {
  player: null,
  resources: [],
  pop: { used: 0, cap: 0 },
  selection: { kind: 'none' },
  actions: [],
  modeHint: '',
  messages: [],
};

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
      maxHp: def.hp,
      progress: b.progress,
      desc: def.desc,
      rally:
        own && b.rally ? (b.rally.nodeId !== undefined ? 'Rally point set (auto-harvest)' : 'Rally point set') : null,
      queue: own
        ? b.queue.map((q, i) => {
            const name = q.kind === 'unit' ? defs.units[q.type].name : defs.techs[q.id].name;
            const total = q.kind === 'unit' ? defs.units[q.type].time : defs.techs[q.id].time;
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
      if (b.rally)
        actions.push({
          id: 'clearRally',
          label: 'Clear rally',
          sub: 'New units stay here',
          title: 'Clear rally point',
          disabled: false,
          active: false,
        });
      if (def.trains.length && !input?.buildMode && !input?.attackMoveMode)
        modeHint = 'Right-click the ground or a resource to set the rally point';
    }
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
        actions.push({
          id: `build:${bd.id}`,
          label: bd.hotkey ? `${bd.name} (${bd.hotkey.toUpperCase()})` : bd.name,
          sub: unlocked
            ? formatCost(tree, bd.cost)
            : missing
              ? `Requires ${describeRequirement(tree, missing)}`
              : 'Locked',
          title: `${bd.desc} Cost: ${formatCost(tree, bd.cost)}`,
          disabled: !unlocked || !canAfford(me.resources, bd.cost),
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
