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
    units: { 1: { id: 1, owner: 1, type: 'scout', x: 2, y: 2 } },
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
  world.handle({ type: 'welcome', version: 0, playerId: 1, state });
  return { state, world };
}

function snapshotOf(state: GameState): Snapshot {
  return {
    type: 'snapshot',
    tick: state.tick + 1,
    units: Object.values(state.units),
    buildings: Object.values(state.buildings),
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
