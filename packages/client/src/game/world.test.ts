import { describe, expect, test } from 'bun:test';
import type { GameState, Snapshot } from '@odal/engine';
import { World } from './world';

// The World keeps three grids: vision (now), explored (ever seen: terrain and nodes known) and
// charted (terrain known: explored, or everything once a `reveal: terrain` tech is researched).
// A 20×20 map with one unit in a corner, and only the tree fields the fog code reads.

const W = 20;
function tinyState(techs: string[]): GameState {
  return {
    width: W,
    height: W,
    terrain: new Array<number>(W * W).fill(0),
    elevation: new Array<number>(W * W).fill(0),
    tree: {
      units: [{ id: 'scout', vision: 3 }],
      buildings: [],
      techs: [
        { id: 'cartography', effects: [{ type: 'reveal', what: 'terrain' }] },
        { id: 'geography', effects: [{ type: 'reveal', what: 'nodes' }] },
      ],
      resources: [],
      terrain: [{ id: 'grass' }],
      nodes: [],
    },
    units: { 1: { id: 1, owner: 1, type: 'scout', x: 2, y: 2, hp: 30 } },
    buildings: {},
    shots: {},
    nodes: {},
    players: { 1: { id: 1, name: 'Alice', techs, research: [], researchProgress: 0, resources: {} } },
    starts: [],
    seed: 1,
    tick: 0,
    nextId: 2,
  } as unknown as GameState;
}

function join(techs: string[] = []): { state: GameState; world: World } {
  const state = tinyState(techs);
  const world = new World();
  // Copies, as the network would deliver them: the test mutates `state` between snapshots.
  world.handle({ type: 'welcome', version: 0, playerId: 1, state: structuredClone(state) });
  return { state, world };
}

function snapshotOf(state: GameState): Snapshot {
  return {
    type: 'snapshot',
    tick: state.tick + 1,
    units: Object.values(structuredClone(state.units)),
    buildings: Object.values(structuredClone(state.buildings)),
    shots: [],
    players: Object.values(state.players),
    nodesChanged: [],
    nodesRemoved: [],
    messages: [],
  };
}

const count = (g: Uint8Array) => g.reduce((n, v) => n + v, 0);

describe('client world fog grids', () => {
  test('without research, charted is exactly what has been explored', () => {
    const { world } = join();
    const seen = count(world.explored!);
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(W * W);
    expect(Array.from(world.charted!)).toEqual(Array.from(world.explored!));
    expect(world.nodesRevealed).toBe(false);
  });

  test('a reveal:terrain tech charts the whole map but leaves explored (and so the nodes) alone', () => {
    const { state, world } = join();
    const before = count(world.explored!);
    state.players[1].techs.push('cartography');
    world.handle(snapshotOf(state));
    expect(count(world.charted!)).toBe(W * W);
    expect(count(world.explored!)).toBe(before);
    expect(world.nodesRevealed).toBe(false);
  });

  test('a reveal:nodes tech flags the nodes as known without charting the terrain', () => {
    const { world } = join(['geography']);
    expect(world.nodesRevealed).toBe(true);
    expect(count(world.charted!)).toBeLessThan(W * W);
  });
});

describe('client world alerts', () => {
  const enemy = (id: number, x: number, y: number, hp = 30) => ({ id, owner: 2, type: 'scout', x, y, hp });

  function withClock() {
    const { state, world } = join();
    let clock = 1000;
    world.now = () => clock;
    const tick = (ms: number) => (clock += ms);
    const snap = () => world.handle(snapshotOf(state));
    return { state, world, tick, snap };
  }

  test('own unit losing HP raises an attack alert once, refreshed rather than repeated nearby', () => {
    const { state, world, snap } = withClock();
    state.units[1].hp = 25;
    snap();
    expect(world.alerts.map((a) => a.kind)).toEqual(['attack']);
    expect(world.messages.some((m) => m.text === 'Under attack!')).toBe(true);
    state.units[1].hp = 20;
    snap();
    expect(world.alerts.length).toBe(1);
  });

  test('an own unit that vanishes counts as an attack at its last position', () => {
    const { state, world, snap } = withClock();
    delete state.units[1];
    snap();
    expect(world.alerts[0]).toMatchObject({ kind: 'attack', x: 2, y: 2 });
  });

  test('an enemy coming into view is spotted once, and again only after it has been out of view a while', () => {
    const { state, world, tick, snap } = withClock();
    state.units[7] = enemy(7, 10, 10) as never;
    snap();
    expect(world.alerts.map((a) => a.kind)).toEqual(['spotted']);
    snap();
    expect(world.alerts.length).toBe(1);
    // Out of view for a moment: still remembered, no new alert when it reappears.
    delete state.units[7];
    snap();
    tick(5000);
    state.units[7] = enemy(7, 10, 10) as never;
    snap();
    expect(world.alerts.length).toBe(1);
    // Alerts expire; an enemy gone for long enough is news again.
    tick(30000);
    world.pruneAlerts(world.now());
    expect(world.alerts.length).toBe(0);
    delete state.units[7];
    snap();
    state.units[7] = enemy(7, 10, 10) as never;
    snap();
    expect(world.alerts.map((a) => a.kind)).toEqual(['spotted']);
  });

  test('the latest alert is the most recently raised or refreshed one', () => {
    const { state, world, tick, snap } = withClock();
    state.units[1].hp = 25;
    snap();
    tick(100);
    state.units[9] = enemy(9, 15, 15) as never;
    snap();
    expect(world.latestAlert()?.kind).toBe('spotted');
    tick(100);
    state.units[1].hp = 20;
    snap();
    expect(world.latestAlert()?.kind).toBe('attack');
  });
});
