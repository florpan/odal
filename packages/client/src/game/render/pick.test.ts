import { describe, expect, test } from 'bun:test';
import { marchGround } from './pick';

// A flat world at 0 with one raised block: x in [4, 5) stands 1 high.
const stepTerrain = (x: number) => (x >= 4 && x < 5 ? 1 : 0);
const ground = (x: number, _z: number) => stepTerrain(x);

/** A ray from `from` through `to`. */
function ray(from: [number, number, number], to: [number, number, number]) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const n = Math.hypot(...d);
  return { ox: from[0], oy: from[1], oz: from[2], dx: d[0] / n, dy: d[1] / n, dz: d[2] / n };
}

describe('marchGround', () => {
  test('on flat ground it is the plane intersection', () => {
    const hit = marchGround(ray([0, 5, 0], [2, 0, 0]), ground, 1, 0)!;
    expect(hit.x).toBeCloseTo(2, 3);
    expect(hit.y).toBeCloseTo(0, 6);
  });

  test('a grazing ray aimed at the top of the raised block lands on the block, not far behind it', () => {
    // Aimed at (4.5, 1, 0), the block's top. The flat plane would put this hit at x = 9.5.
    const r = ray([0, 1.9, 0], [4.5, 1, 0]);
    const hit = marchGround(r, ground, 1, 0)!;
    expect(hit.x).toBeCloseTo(4.5, 2);
    expect(hit.y).toBeCloseTo(1, 6);
  });

  test('a ray hitting the block’s wall stops at the wall instead of passing through', () => {
    // Descends steeply just before the block: it meets the block's front face around x = 4 at y ≈ 0.5.
    const r = ray([3, 1.5, 0], [5, -0.5, 0]);
    const hit = marchGround(r, ground, 1, 0)!;
    expect(hit.x).toBeGreaterThanOrEqual(4);
    expect(hit.x).toBeLessThan(4.15);
    expect(hit.y).toBeLessThanOrEqual(1);
  });

  test('a ray that never descends picks nothing', () => {
    expect(marchGround(ray([0, 1, 0], [1, 2, 0]), ground, 1, 0)).toBeNull();
  });

  test('past every tile it falls back to the bottom plane', () => {
    const hit = marchGround(ray([0, 5, 0], [20, 0, 0]), ground, 1, 0)!;
    expect(hit.x).toBeCloseTo(20, 3);
  });
});
