import { describe, expect, test } from 'bun:test';
import { DEFAULT_TREE } from '@odal/content';
import { makeBuilding } from './entities';
import { addPlayer, createGame, emptyEvents } from './game';
import {
  adjacentTiles,
  canPlaceFootprint,
  computeBlocked,
  findFreeTileNear,
  footprintDistance,
  isAdjacentTo,
  stampFootprint,
} from './grid';
import { hexCentre, hexDistance, hexNeighbours } from './hex';
import { findPath } from './pathfinding';

const W = 20;
const H = 20;

describe('hex grid: footprints', () => {
  test('a radius-1 footprint blocks seven hexes and its ring has twelve free neighbours', () => {
    const g = new Uint8Array(W * H);
    stampFootprint(g, W, H, 10, 10, 1, 1);
    expect(g.reduce((s, v) => s + v, 0)).toBe(7);
    const ring = adjacentTiles(10, 10, 1);
    expect(ring.length).toBe(12);
    for (const t of ring) expect(g[t.y * W + t.x]).toBe(0);
    expect(canPlaceFootprint(g, W, H, 10, 10, 0)).toBe(false);
    expect(canPlaceFootprint(g, W, H, 13, 10, 1)).toBe(true);
    expect(canPlaceFootprint(g, W, H, 12, 10, 1)).toBe(false); // overlaps the ring
  });

  test('adjacency: a unit on the ring is adjacent, two rings out is not', () => {
    const ring = adjacentTiles(5, 5, 0);
    for (const t of ring) expect(isAdjacentTo(hexCentre(t.x, t.y), 5, 5, 0)).toBe(true);
    for (const t of adjacentTiles(5, 5, 1)) expect(isAdjacentTo(hexCentre(t.x, t.y), 5, 5, 0)).toBe(false);
    expect(footprintDistance(hexCentre(5, 5), 5, 5, 0)).toBe(0);
    expect(footprintDistance(hexCentre(7, 5), 5, 5, 0)).toBeCloseTo(1.5);
  });

  test('findFreeTileNear skips the footprint and blocked rings', () => {
    const g = new Uint8Array(W * H);
    stampFootprint(g, W, H, 10, 10, 1, 1);
    for (const t of adjacentTiles(10, 10, 1)) g[t.y * W + t.x] = 1;
    const free = findFreeTileNear(g, W, H, 10, 10, 1)!;
    expect(free).not.toBeNull();
    expect(hexDistance(free, { x: 10, y: 10 })).toBe(3);
  });

  test('buildings block their footprint in the game state', () => {
    const state = createGame(DEFAULT_TREE, 3);
    const p = addPlayer(state, 'Alice', emptyEvents());
    const home = Object.values(state.buildings)[0];
    const def = DEFAULT_TREE.buildings.find((b) => b.buildable)!;
    const b = makeBuilding(state, p.id, def.id, home.x + 3, home.y);
    const blocked = computeBlocked(state);
    expect(blocked[b.y * state.width + b.x]).toBe(1);
    expect(blocked[home.y * state.width + home.x]).toBe(1);
  });
});

describe('hex pathfinding', () => {
  test('a path walks neighbour to neighbour and ends on the goal', () => {
    const nav = { blocked: new Uint8Array(W * H), width: W, height: H };
    const path = findPath(nav, { x: 2, y: 3 }, { x: 15, y: 12 })!;
    expect(path).not.toBeNull();
    expect(path.length).toBe(hexDistance({ x: 2, y: 3 }, { x: 15, y: 12 }));
    let prev = { x: 2, y: 3 };
    for (const wp of path) {
      const c = hexCentre(prev.x, prev.y);
      expect(Math.hypot(wp.x - c.x, wp.y - c.y)).toBeCloseTo(1);
      prev = hexNeighbours(prev.x, prev.y).find((n) => {
        const nc = hexCentre(n.x, n.y);
        return Math.abs(nc.x - wp.x) < 1e-6 && Math.abs(nc.y - wp.y) < 1e-6;
      })!;
      expect(prev).toBeDefined();
    }
    expect(prev).toEqual({ x: 15, y: 12 });
  });

  test('a wall with one gap is walked around, a closed wall is unreachable', () => {
    const blocked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) if (y !== 9) blocked[y * W + 10] = 1;
    const nav = { blocked, width: W, height: H };
    const path = findPath(nav, { x: 2, y: 2 }, { x: 17, y: 2 })!;
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(hexDistance({ x: 2, y: 2 }, { x: 17, y: 2 }));
    blocked[9 * W + 10] = 1;
    expect(findPath(nav, { x: 2, y: 2 }, { x: 17, y: 2 })).toBeNull();
  });

  test('a blocked goal is unreachable, a blocked start is allowed', () => {
    const blocked = new Uint8Array(W * H);
    blocked[5 * W + 5] = 1;
    const nav = { blocked, width: W, height: H };
    expect(findPath(nav, { x: 1, y: 1 }, { x: 5, y: 5 })).toBeNull();
    expect(findPath(nav, { x: 5, y: 5 }, { x: 1, y: 1 })).not.toBeNull();
  });
});
