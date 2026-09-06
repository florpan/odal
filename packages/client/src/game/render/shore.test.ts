import { describe, expect, test } from 'bun:test';
import { hexNeighbours } from '@odal/engine';
import type { GameState } from '@odal/engine';
import { shoreOf, tileOf } from './shore';

// A 7×7 map with two terrains, so tests can paint water by hand. Only the fields the
// shore code reads are filled in.
const SHORE = ['c1.glb', 'c2.glb', 'c3.glb', 'c4.glb'];
function flatMap(): GameState {
  return {
    width: 7,
    height: 7,
    terrain: new Array<number>(49).fill(0),
    tree: {
      rules: { map: { island: { water: 'water' } } },
      terrain: [
        { id: 'grass', passable: true, visual: { color: '#000000', height: 0, model: 'g.glb', shore: SHORE } },
        { id: 'water', passable: false, visual: { color: '#000000', height: 0, model: 'w.glb' } },
      ],
    },
  } as unknown as GameState;
}
const WATER = 1;

describe('shore tiles', () => {
  test('a landlocked hex has no shore and shows the base tile', () => {
    const st = flatMap();
    expect(shoreOf(st, 3, 3)).toBeNull();
    expect(tileOf(st, 3, 3)).toEqual({ model: 'g.glb', rotation: 0 });
  });

  test('one water neighbour: run 1, facing it', () => {
    const st = flatMap();
    const ns = hexNeighbours(3, 3);
    st.terrain[ns[0].y * 7 + ns[0].x] = WATER; // the neighbour at +x
    const s = shoreOf(st, 3, 3)!;
    expect(s.run).toBe(1);
    expect(s.angle).toBeCloseTo(0);
    const tile = tileOf(st, 3, 3);
    expect(tile.model).toBe(SHORE[0]);
    // Authored water at +90°, wanted at 0°: turn by +90°.
    expect(tile.rotation).toBeCloseTo(Math.PI / 2);
  });

  test('a run wrapping around the ring is counted whole and centred', () => {
    const st = flatMap();
    const ns = hexNeighbours(3, 3);
    for (const k of [5, 0, 1]) st.terrain[ns[k].y * 7 + ns[k].x] = WATER; // 60°, 0°, -60°
    const s = shoreOf(st, 3, 3)!;
    expect(s.run).toBe(3);
    expect(s.angle).toBeCloseTo(0);
    expect(tileOf(st, 3, 3).model).toBe(SHORE[2]);
  });

  test('more water edges than shore tiles falls back to the last one; water itself has no shore', () => {
    const st = flatMap();
    for (const n of hexNeighbours(3, 3)) st.terrain[n.y * 7 + n.x] = WATER;
    expect(shoreOf(st, 3, 3)!.run).toBe(6);
    expect(tileOf(st, 3, 3).model).toBe(SHORE[3]);
    st.terrain[3 * 7 + 3] = WATER;
    expect(shoreOf(st, 3, 3)).toBeNull();
    expect(tileOf(st, 3, 3).model).toBe('w.glb');
  });
});
