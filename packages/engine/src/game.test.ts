import { describe, expect, test } from 'bun:test';
import { DEFAULT_TREE } from '@odal/content';
import { makeBuilding } from './entities';
import { addPlayer, createGame, emptyEvents, stepGame } from './game';
import { computeBlocked } from './grid';
import type { PlayerCommand } from './protocol';
import { buildingMaxHp, countUnits } from './queries';
import type { GameState, ResourceNode } from './types';
import { buildGraph, chainCost, findCycle, prerequisites } from './techgraph';
import { computeVision, isVisible } from './vision';

const DT = 1 / DEFAULT_TREE.rules.tickRate;

function run(state: GameState, ticks: number, cmds: PlayerCommand[] = []) {
  stepGame(state, cmds, DT);
  for (let i = 1; i < ticks; i++) stepGame(state, [], DT);
}

function nearestNode(state: GameState, type: string, x: number, y: number): ResourceNode {
  let best: ResourceNode | null = null;
  let bestD = Infinity;
  for (const n of Object.values(state.nodes)) {
    if (n.type !== type) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best!;
}

describe('engine with the default tech tree', () => {
  test('map generation is deterministic', () => {
    const a = createGame(DEFAULT_TREE, 42);
    const b = createGame(DEFAULT_TREE, 42);
    expect(Object.keys(a.nodes).length).toBeGreaterThan(200);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });

  test('joining gives the starting building and units', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const buildings = Object.values(state.buildings).filter((b) => b.owner === p.id);
    expect(buildings.map((b) => b.type)).toEqual([DEFAULT_TREE.start.building]);
    expect(countUnits(state, p.id)).toBe(DEFAULT_TREE.start.units.reduce((s, u) => s + u.count, 0));
    expect(p.resources).toEqual({ ...DEFAULT_TREE.rules.startResources });
  });

  test('worker harvests lumber and drops it at the campfire', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const worker = Object.values(state.units)[0];
    const tree = nearestNode(state, 'tree', worker.x, worker.y);
    const before = p.resources.lumber;
    run(state, 1200, [{ playerId: p.id, cmd: { type: 'harvest', unitIds: [worker.id], nodeId: tree.id } }]);
    expect(p.resources.lumber).toBeGreaterThan(before);
  });

  test('worker builds a farm which then produces wheat', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const worker = Object.values(state.units)[0];
    const camp = Object.values(state.buildings)[0];
    run(state, 1, [
      { playerId: p.id, cmd: { type: 'build', unitIds: [worker.id], building: 'farm', x: camp.x + 2, y: camp.y + 2 } },
    ]);
    const farm = Object.values(state.buildings).find((b) => b.type === 'farm');
    expect(farm).toBeDefined();
    expect(p.resources.lumber).toBe(DEFAULT_TREE.rules.startResources.lumber - 20);
    const wheatBefore = p.resources.wheat;
    run(state, 600);
    expect(farm!.progress).toBe(1);
    expect(p.resources.wheat).toBeGreaterThan(wheatBefore);
  });

  test('campfire trains a worker', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const camp = Object.values(state.buildings)[0];
    run(state, 120, [{ playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'worker' } }]);
    expect(countUnits(state, p.id)).toBe(2);
    expect(p.resources.wheat).toBe(DEFAULT_TREE.rules.startResources.wheat - 20);
  });

  test('rally point on a tree sends new workers to harvest it', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const camp = Object.values(state.buildings)[0];
    const tree = nearestNode(state, 'tree', camp.x, camp.y);
    run(state, 120, [
      {
        playerId: p.id,
        cmd: { type: 'setRally', buildingId: camp.id, target: { x: tree.x + 0.5, y: tree.y + 0.5, nodeId: tree.id } },
      },
      { playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'worker' } },
    ]);
    const workers = Object.values(state.units).filter((u) => u.owner === p.id);
    expect(workers.length).toBe(2);
    expect(workers.some((u) => u.task.kind === 'harvest')).toBe(true);
  });

  test('idle units on the same spot get pushed apart', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const a = Object.values(state.units)[0];
    const camp = Object.values(state.buildings)[0];
    run(state, 100, [{ playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'worker' } }]);
    const b = Object.values(state.units).find((u) => u.id !== a.id)!;
    b.x = a.x;
    b.y = a.y;
    run(state, 20);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
  });

  test('research applies its effect: sharpened axes speeds up lumber', () => {
    const fast = createGame(DEFAULT_TREE, 7);
    const slow = createGame(DEFAULT_TREE, 7);
    const pf = addPlayer(fast, 'A', emptyEvents());
    const ps = addPlayer(slow, 'A', emptyEvents());
    pf.techs.push('sharp_axes');
    for (const [state, p] of [
      [fast, pf],
      [slow, ps],
    ] as const) {
      const w = Object.values(state.units)[0];
      const t = nearestNode(state, 'tree', w.x, w.y);
      run(state, 900, [{ playerId: p.id, cmd: { type: 'harvest', unitIds: [w.id], nodeId: t.id } }]);
    }
    expect(pf.resources.lumber).toBeGreaterThan(ps.resources.lumber);
  });

  test('vision hides far away enemies', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const vision = computeVision(state, a.id);
    const ub = Object.values(state.units).find((u) => u.owner === b.id)!;
    const ua = Object.values(state.units).find((u) => u.owner === a.id)!;
    expect(isVisible(vision, state.width, ua.x, ua.y)).toBe(true);
    expect(isVisible(vision, state.width, ub.x, ub.y)).toBe(false);
  });

  test('a unit with an unmet requirement cannot be trained', () => {
    // A ruleset where the campfire can train soldiers; the soldier itself still requires Ironworking.
    const tree = structuredClone(DEFAULT_TREE);
    tree.buildings.find((b) => b.id === tree.start.building)!.trains.push('soldier');
    const state = createGame(tree, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const camp = Object.values(state.buildings)[0];
    p.resources.iron = 100;
    const ev = stepGame(state, [{ playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'soldier' } }], DT);
    expect(camp.queue.length).toBe(0);
    expect(ev.messages.some((m) => m.text.includes('requires Ironworking'))).toBe(true);
    p.techs.push('ironworking');
    stepGame(state, [{ playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'soldier' } }], DT);
    expect(camp.queue.length).toBe(1);
  });

  test('upkeep is paid every interval and bottoms out at zero', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const worker = Object.values(state.units)[0];
    worker.type = 'soldier'; // soldiers cost 1 wheat per interval in the default ruleset
    p.resources.wheat = 1;
    const ticksPerInterval = DEFAULT_TREE.rules.upkeepInterval * DEFAULT_TREE.rules.tickRate;
    run(state, ticksPerInterval + 1); // upkeep is charged on the tick after the interval boundary
    expect(p.resources.wheat).toBe(0);
    let starving = false;
    for (let i = 0; i < ticksPerInterval; i++) {
      const ev = stepGame(state, [], DT);
      if (ev.messages.some((m) => m.text.includes('feed'))) starving = true;
    }
    expect(p.resources.wheat).toBe(0);
    expect(starving).toBe(true);
  });

  test('tech graph: prerequisites of the soldier are the whole military branch', () => {
    const chain = prerequisites(DEFAULT_TREE, { kind: 'unit', id: 'soldier' }).map((r) => `${r.kind}:${r.id}`);
    expect(chain).toContain('building:library');
    expect(chain).toContain('tech:ironworking');
    expect(chain).toContain('building:barracks');
    expect(chain.indexOf('tech:ironworking')).toBeLessThan(chain.indexOf('building:barracks'));
    expect(findCycle(buildGraph(DEFAULT_TREE))).toBeNull();
  });

  test('units fight', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const ua = Object.values(state.units).find((u) => u.owner === a.id)!;
    const ub = Object.values(state.units).find((u) => u.owner === b.id)!;
    run(state, 3000, [
      { playerId: a.id, cmd: { type: 'attack', unitIds: [ua.id], targetId: ub.id, targetKind: 'unit' } },
    ]);
    expect(state.units[ub.id]).toBeUndefined();
  });

  test('a completed building with an attack block shoots enemies in range', () => {
    const towerDef = DEFAULT_TREE.buildings.find((b) => b.attack)!;
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const ua = Object.values(state.units).find((u) => u.owner === a.id)!;
    const ub = Object.values(state.units).find((u) => u.owner === b.id)!;
    const tower = makeBuilding(state, a.id, towerDef.id, Math.floor(ua.x) + 2, Math.floor(ua.y));
    tower.progress = 1;
    tower.hp = towerDef.hp;
    // Park Bob's worker just inside range and Alice's own worker out of the way.
    ub.x = tower.x + 0.5 + towerDef.attack!.range - 1;
    ub.y = tower.y + 0.5;
    ua.x = tower.x - 3;
    const before = ub.hp;
    run(state, Math.ceil(towerDef.attack!.attackTime * DEFAULT_TREE.rules.tickRate) + 2);
    expect(ub.hp).toBeLessThan(before);
    expect(ua.hp).toBe(before); // never shoots its own
  });

  test('a passable building blocks enemies but not its owner', () => {
    const gateDef = DEFAULT_TREE.buildings.find((b) => b.passable)!;
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const home = Object.values(state.buildings).find((x) => x.owner === a.id)!;
    const gate = makeBuilding(state, a.id, gateDef.id, home.x + 2, home.y);
    gate.progress = 1;
    const i = gate.y * state.width + gate.x;
    expect(computeBlocked(state)[i]).toBe(1);
    expect(computeBlocked(state, b.id)[i]).toBe(1);
    expect(computeBlocked(state, a.id)[i]).toBe(0);
  });

  test('a population requirement gates research until enough units live', () => {
    const tree = structuredClone(DEFAULT_TREE);
    const library = tree.buildings.find((b) => b.researches.length)!;
    const techId = library.researches[0];
    tree.techs.find((t) => t.id === techId)!.requires = [{ type: 'population', min: 2 }];
    const state = createGame(tree, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const camp = Object.values(state.buildings)[0];
    const lib = makeBuilding(state, p.id, library.id, camp.x + 3, camp.y + 3);
    lib.progress = 1;
    for (const r of tree.resources) p.resources[r.id] = 1000;
    const ev = stepGame(state, [{ playerId: p.id, cmd: { type: 'research', buildingId: lib.id, tech: techId } }], DT);
    expect(lib.queue.length).toBe(0);
    expect(ev.messages.some((m) => m.text.includes('2 population'))).toBe(true);
    run(state, 120, [{ playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: tree.start.units[0].type } }]);
    expect(countUnits(state, p.id)).toBe(2);
    stepGame(state, [{ playerId: p.id, cmd: { type: 'research', buildingId: lib.id, tech: techId } }], DT);
    expect(lib.queue.length).toBe(1);
  });

  test('buildingHp effect raises the max HP of buildings finished afterwards', () => {
    const tech = DEFAULT_TREE.techs.find((t) => t.effects.some((e) => e.type === 'buildingHp'))!;
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const worker = Object.values(state.units)[0];
    const camp = Object.values(state.buildings)[0];
    const house = DEFAULT_TREE.buildings.find((b) => b.buildable && !b.requires.length && b.pop > 0)!;
    p.techs.push(tech.id);
    p.resources = Object.fromEntries(DEFAULT_TREE.resources.map((r) => [r.id, 1000]));
    run(state, 800, [
      {
        playerId: p.id,
        cmd: { type: 'build', unitIds: [worker.id], building: house.id, x: camp.x + 2, y: camp.y + 2 },
      },
    ]);
    const built = Object.values(state.buildings).find((b) => b.type === house.id)!;
    expect(built.progress).toBe(1);
    expect(built.hp).toBeCloseTo(buildingMaxHp(DEFAULT_TREE, p, house.id));
    expect(built.hp).toBeGreaterThan(house.hp);
  });

  test('chainCost sums the whole prerequisite chain', () => {
    const soldier = { kind: 'unit', id: 'soldier' } as const;
    const { cost, time, steps } = chainCost(DEFAULT_TREE, soldier);
    expect(steps).toBe(prerequisites(DEFAULT_TREE, soldier).length + 1);
    expect(cost.gold).toBeGreaterThan(0); // the library and ironworking cost gold, the soldier does not
    expect(time).toBeGreaterThan(DEFAULT_TREE.units.find((u) => u.id === 'soldier')!.time);
  });
});
