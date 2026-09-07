import { describe, expect, test } from 'bun:test';
import { DEFAULT_TREE } from '@odal/content';
import { makeBuilding, makeUnit } from './entities';
import { addPlayer, createGame, emptyEvents, stepGame } from './game';
import { computeBlocked } from './grid';
import { hexCentre, hexDistance, hexNeighbours, worldToHex } from './hex';
import { findPath } from './pathfinding';
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

/** Nearest node of a type to a world position. */
function nearestNode(state: GameState, type: string, x: number, y: number): ResourceNode {
  let best: ResourceNode | null = null;
  let bestD = Infinity;
  for (const n of Object.values(state.nodes)) {
    if (n.type !== type) continue;
    const c = hexCentre(n.x, n.y);
    const d = Math.hypot(c.x - x, c.y - y);
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
    expect(a.starts).toEqual(b.starts);
  });

  test('every start slot has its home resources within homeRadius', () => {
    const { rules } = DEFAULT_TREE;
    for (const seed of [1, 2, 3, 42]) {
      const st = createGame(DEFAULT_TREE, seed);
      expect(st.starts.length).toBe(rules.map.starts);
      for (const s of st.starts) {
        for (const nd of DEFAULT_TREE.nodes) {
          if (nd.spawn.perStart === 0) continue;
          const near = Object.values(st.nodes).filter(
            (n) => n.type === nd.id && hexDistance(n, s) <= rules.homeRadius + 1,
          );
          expect(near.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('every start slot can reach the centre and every other start (forests never seal a player in)', () => {
    for (const seed of [1, 2, 3, 7, 42, 99]) {
      const st = createGame(DEFAULT_TREE, seed);
      const blocked = computeBlocked(st);
      const nav = { blocked, width: st.width, height: st.height };
      const [first, ...rest] = st.starts;
      for (const s of rest) expect(findPath(nav, first, s)).not.toBeNull();
    }
  });

  test('an island map has water around a land mass; starts, nodes and building spots are on land', () => {
    const { rules } = DEFAULT_TREE;
    expect(rules.map.island).toBeDefined();
    const waterIdx = DEFAULT_TREE.terrain.findIndex((t) => t.id === rules.map.island!.water);
    const groundIdx = DEFAULT_TREE.terrain.findIndex((t) => t.id === rules.map.ground);
    for (const seed of [1, 7, 42]) {
      const st = createGame(DEFAULT_TREE, seed);
      const water = st.terrain.filter((t) => t === waterIdx).length;
      expect(water).toBeGreaterThan(st.terrain.length * 0.15);
      expect(water).toBeLessThan(st.terrain.length * 0.6);
      // The corners are sea, the centre is land.
      expect(st.terrain[0]).toBe(waterIdx);
      expect(st.terrain[st.width - 1]).toBe(waterIdx);
      expect(st.terrain[(st.height - 1) * st.width]).toBe(waterIdx);
      expect(st.terrain[Math.floor(st.height / 2) * st.width + Math.floor(st.width / 2)]).toBe(groundIdx);
      for (const s of st.starts) expect(st.terrain[s.y * st.width + s.x]).toBe(groundIdx);
      for (const n of Object.values(st.nodes)) expect(st.terrain[n.y * st.width + n.x]).toBe(groundIdx);
      const blocked = computeBlocked(st);
      for (let i = 0; i < st.terrain.length; i++) if (st.terrain[i] === waterIdx) expect(blocked[i]).toBe(1);
    }
  });

  test('relief: elevation is quantised noise, flat on water and shore, one step between neighbours', () => {
    const { rules } = DEFAULT_TREE;
    expect(rules.map.relief).toBeDefined();
    const waterIdx = DEFAULT_TREE.terrain.findIndex((t) => t.id === rules.map.island!.water);
    for (const seed of [1, 7, 42]) {
      const st = createGame(DEFAULT_TREE, seed);
      expect(st.elevation.length).toBe(st.width * st.height);
      expect(JSON.stringify(createGame(DEFAULT_TREE, seed).elevation)).toBe(JSON.stringify(st.elevation));
      const counts = new Array<number>(rules.map.relief!.levels + 1).fill(0);
      for (let i = 0; i < st.elevation.length; i++) {
        const e = st.elevation[i];
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(rules.map.relief!.levels);
        counts[e]++;
        const x = i % st.width;
        const y = Math.floor(i / st.width);
        const water = st.terrain[i] === waterIdx;
        let shore = false;
        for (const n of hexNeighbours(x, y)) {
          if (n.x < 0 || n.y < 0 || n.x >= st.width || n.y >= st.height) continue;
          const j = n.y * st.width + n.x;
          if (st.terrain[j] === waterIdx) shore = true;
          expect(Math.abs(st.elevation[j] - e)).toBeLessThanOrEqual(1);
        }
        if (water || shore) expect(e).toBe(0);
      }
      for (const c of counts) expect(c).toBeGreaterThan(0); // every level occurs
    }
  });

  test('terrain features are scattered on land, carry no nodes, and impassable ones block', () => {
    const { rules } = DEFAULT_TREE;
    expect(rules.map.features.length).toBeGreaterThan(0);
    const st = createGame(DEFAULT_TREE, 7);
    const blocked = computeBlocked(st);
    for (const f of rules.map.features) {
      const idx = DEFAULT_TREE.terrain.findIndex((t) => t.id === f.terrain);
      const hexes = st.terrain.map((t, i) => (t === idx ? i : -1)).filter((i) => i >= 0);
      expect(hexes.length).toBeGreaterThan(0);
      for (const i of hexes) {
        expect(Object.values(st.nodes).some((n) => n.y * st.width + n.x === i)).toBe(false);
        expect(blocked[i]).toBe(DEFAULT_TREE.terrain[idx].passable ? 0 : 1);
        for (const s of st.starts)
          expect(hexDistance(s, { x: i % st.width, y: Math.floor(i / st.width) })).toBeGreaterThan(
            rules.startClearRadius,
          );
      }
    }
  });

  test('centre-zone deposits stay in the middle of the map', () => {
    const centred = DEFAULT_TREE.nodes.filter((n) => n.spawn.zone === 'centre' && n.spawn.perStart === 0);
    if (!centred.length) return;
    const st = createGame(DEFAULT_TREE, 42);
    for (const nd of centred) {
      const walk = nd.spawn.kind === 'deposit' ? nd.spawn.size[1] : nd.spawn.radius[1];
      for (const n of Object.values(st.nodes)) {
        if (n.type !== nd.id) continue;
        expect(Math.abs(n.x - st.width / 2)).toBeLessThanOrEqual(st.width * 0.2 + walk + 1);
        expect(Math.abs(n.y - st.height / 2)).toBeLessThanOrEqual(st.height * 0.2 + walk + 1);
      }
    }
  });

  test('players take start slots, the second one farthest from the first', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const homeA = Object.values(state.buildings).find((x) => x.owner === a.id)!;
    const homeB = Object.values(state.buildings).find((x) => x.owner === b.id)!;
    const onSlot = (h: { x: number; y: number }) => state.starts.some((s) => s.x === h.x && s.y === h.y);
    expect(onSlot(homeA)).toBe(true);
    expect(onSlot(homeB)).toBe(true);
    const d = hexDistance(homeA, homeB);
    for (const s of state.starts) expect(d).toBeGreaterThanOrEqual(hexDistance(homeA, s));
  });

  test('joining gives the starting building and units', () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const buildings = Object.values(state.buildings).filter((b) => b.owner === p.id);
    expect(buildings.map((b) => b.type)).toEqual([DEFAULT_TREE.start.building]);
    expect(countUnits(state, p.id)).toBe(DEFAULT_TREE.start.units.reduce((s, u) => s + u.count, 0));
    expect(p.resources).toEqual({ ...DEFAULT_TREE.rules.startResources });
  });

  test('worker harvests lumber and drops it at the town hall', () => {
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

  test('the town hall trains a worker', () => {
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
    const campCentre = hexCentre(camp.x, camp.y);
    const tree = nearestNode(state, 'tree', campCentre.x, campCentre.y);
    run(state, 120, [
      {
        playerId: p.id,
        cmd: { type: 'setRally', buildingId: camp.id, target: { ...hexCentre(tree.x, tree.y), nodeId: tree.id } },
      },
      { playerId: p.id, cmd: { type: 'train', buildingId: camp.id, unit: 'worker' } },
    ]);
    const workers = Object.values(state.units).filter((u) => u.owner === p.id);
    expect(workers.length).toBe(2);
    expect(workers.some((u) => u.task.kind === 'harvest')).toBe(true);
  });

  test("rotate turns an own building in sixths, never someone else's", () => {
    const state = createGame(DEFAULT_TREE, 7);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const q = addPlayer(state, 'Bob', emptyEvents());
    const own = Object.values(state.buildings).find((b) => b.owner === p.id)!;
    const theirs = Object.values(state.buildings).find((b) => b.owner === q.id)!;
    run(state, 1, [
      { playerId: p.id, cmd: { type: 'rotate', buildingId: own.id, rot: 7 } },
      { playerId: p.id, cmd: { type: 'rotate', buildingId: theirs.id, rot: 2 } },
    ]);
    expect(own.rot).toBe(1);
    expect(theirs.rot).toBe(0);
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
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(DEFAULT_TREE.rules.separationDist * 0.9);
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
    // A ruleset where the town hall can train soldiers; the soldier itself still requires Ironworking.
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

  test('an idle fighter ignores enemy buildings, kills units that come close and returns to its post', () => {
    const soldierDef = DEFAULT_TREE.units.find((u) => u.aggro > 0 && u.abilities.includes('attack'))!;
    const victimDef = DEFAULT_TREE.units.find((u) => u.id !== soldierDef.id)!;
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const homeB = Object.values(state.buildings).find((x) => x.owner === b.id)!;
    for (const u of Object.values(state.units)) if (u.owner === b.id) delete state.units[u.id];
    // Open ground around Bob's town hall so pathing is not part of the test.
    for (const n of Object.values(state.nodes)) if (hexDistance(n, homeB) < 14) delete state.nodes[n.id];
    const hc = hexCentre(homeB.x, homeB.y);
    const s = makeUnit(state, a.id, soldierDef.id, hc.x + 2, hc.y);
    const post = { x: s.x, y: s.y };
    const homeHp = homeB.hp;

    run(state, 30);
    expect(s.task.kind).toBe('idle');
    expect(homeB.hp).toBe(homeHp);

    const v = makeUnit(state, b.id, victimDef.id, post.x + soldierDef.aggro - 1, post.y);
    run(state, 5);
    expect(s.task.kind).toBe('attack');
    run(state, 600);
    expect(state.units[v.id]).toBeUndefined();
    expect(homeB.hp).toBe(homeHp);
    expect(s.task.kind).toBe('idle');
    expect(Math.hypot(s.x - post.x, s.y - post.y)).toBeLessThan(1.5);
  });

  test('an attack-moving fighter razes buildings on its own', () => {
    const soldierDef = DEFAULT_TREE.units.find((u) => u.aggro > 0 && u.abilities.includes('attack'))!;
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const homeB = Object.values(state.buildings).find((x) => x.owner === b.id)!;
    for (const u of Object.values(state.units)) if (u.owner === b.id) delete state.units[u.id];
    const hc = hexCentre(homeB.x, homeB.y);
    const s = makeUnit(state, a.id, soldierDef.id, hc.x + 2, hc.y);
    const homeHp = homeB.hp;
    run(state, 60, [{ playerId: a.id, cmd: { type: 'attackMove', unitIds: [s.id], target: { x: s.x, y: s.y } } }]);
    expect(homeB.hp).toBeLessThan(homeHp);
  });

  test('a completed building with an attack block shoots enemies in range', () => {
    const towerDef = DEFAULT_TREE.buildings.find((b) => b.attack)!;
    const state = createGame(DEFAULT_TREE, 7);
    const a = addPlayer(state, 'Alice', emptyEvents());
    const b = addPlayer(state, 'Bob', emptyEvents());
    const ua = Object.values(state.units).find((u) => u.owner === a.id)!;
    const ub = Object.values(state.units).find((u) => u.owner === b.id)!;
    const at = worldToHex(ua);
    const tower = makeBuilding(state, a.id, towerDef.id, at.x + 2, at.y);
    tower.progress = 1;
    tower.hp = towerDef.hp;
    // Park Bob's worker just inside range and Alice's own worker out of the way.
    const tc = hexCentre(tower.x, tower.y);
    ub.x = tc.x + towerDef.attack!.range - 1;
    ub.y = tc.y;
    ua.x = tc.x - 3;
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
