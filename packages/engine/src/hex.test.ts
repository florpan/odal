import { describe, expect, test } from 'bun:test';
import {
  HEX_R,
  ROW_H,
  axialToOffset,
  hexArea,
  hexCentre,
  hexDistance,
  hexNeighbours,
  hexRing,
  offsetToAxial,
  worldToHex,
} from './hex';

describe('hex grid geometry', () => {
  test('offset <-> axial round-trips', () => {
    for (let row = -3; row < 6; row++) {
      for (let col = -3; col < 6; col++) {
        const { q, r } = offsetToAxial(col, row);
        expect(axialToOffset(q, r)).toEqual({ x: col, y: row });
      }
    }
  });

  test('a hex centre maps back to the same hex, and so does every point near it', () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const c = hexCentre(col, row);
        expect(worldToHex(c)).toEqual({ x: col, y: row });
        // Anywhere inside the inradius belongs to this hex.
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.1;
          const p = { x: c.x + Math.cos(a) * 0.45, y: c.y + Math.sin(a) * 0.45 };
          expect(worldToHex(p)).toEqual({ x: col, y: row });
        }
      }
    }
  });

  test('odd rows are shifted half a hex and rows are ROW_H apart', () => {
    expect(hexCentre(0, 0)).toEqual({ x: 0.5, y: 0.5 * ROW_H });
    expect(hexCentre(0, 1).x).toBeCloseTo(1);
    expect(hexCentre(0, 1).y - hexCentre(0, 0).y).toBeCloseTo(ROW_H);
    expect(ROW_H).toBeCloseTo(HEX_R * 1.5);
  });

  test('neighbours are exactly the hexes at distance 1, and their centres are 1 apart', () => {
    for (const [col, row] of [
      [3, 3],
      [3, 4],
      [0, 0],
    ]) {
      const ns = hexNeighbours(col, row);
      expect(ns.length).toBe(6);
      const c = hexCentre(col, row);
      for (const n of ns) {
        expect(hexDistance({ x: col, y: row }, n)).toBe(1);
        const d = hexCentre(n.x, n.y);
        expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeCloseTo(1);
      }
      expect(new Set(ns.map((n) => `${n.x},${n.y}`)).size).toBe(6);
    }
  });

  test('rings have 6r hexes at distance r; areas have 3r(r+1)+1', () => {
    for (const radius of [1, 2, 3]) {
      const ring = hexRing(5, 5, radius);
      expect(ring.length).toBe(6 * radius);
      for (const h of ring) expect(hexDistance({ x: 5, y: 5 }, h)).toBe(radius);
      expect(new Set(ring.map((n) => `${n.x},${n.y}`)).size).toBe(ring.length);
      const area = hexArea(5, 5, radius);
      expect(area.length).toBe(3 * radius * (radius + 1) + 1);
      expect(area[0]).toEqual({ x: 5, y: 5 });
    }
    expect(hexRing(2, 2, 0)).toEqual([{ x: 2, y: 2 }]);
  });

  test('distance is symmetric and matches the axial walk', () => {
    expect(hexDistance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(hexDistance({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(4);
    expect(hexDistance({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
    expect(hexDistance({ x: 0, y: 0 }, { x: 2, y: 4 })).toBe(4);
    expect(hexDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(hexDistance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5);
  });
});
