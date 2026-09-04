import { describe, expect, test } from 'bun:test';
import { validateTree } from '@odal/engine';
import { DEFAULT_TREE, DEFAULT_TREE_DATA } from './index';

describe('default ruleset', () => {
  test('validates', () => {
    const { errors } = validateTree(DEFAULT_TREE_DATA);
    expect(errors).toEqual([]);
  });

  test('has a starting building that is a drop-off and trains something', () => {
    const start = DEFAULT_TREE.buildings.find((b) => b.id === DEFAULT_TREE.start.building)!;
    expect(start.dropOff).toBe(true);
    expect(start.trains.length).toBeGreaterThan(0);
  });

  test('every resource can be obtained somehow', () => {
    const obtainable = new Set<string>();
    for (const n of DEFAULT_TREE.nodes) obtainable.add(n.resource);
    for (const b of DEFAULT_TREE.buildings) if (b.produces) obtainable.add(b.produces.resource);
    for (const r of DEFAULT_TREE.resources) expect(obtainable.has(r.id)).toBe(true);
  });
});

describe('validator', () => {
  test('reports dangling references with a path', () => {
    const broken = structuredClone(DEFAULT_TREE_DATA) as { buildings: { id: string; trains: string[] }[] };
    broken.buildings.find((b) => b.id === 'campfire')!.trains.push('dragon');
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('buildings.campfire.trains') && e.includes('dragon'))).toBe(true);
  });

  test('rejects techs nobody can research', () => {
    const broken = structuredClone(DEFAULT_TREE_DATA);
    broken.techs.push({ id: 'orphan', name: 'Orphan', time: 1 });
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('tech:orphan') && e.includes('unobtainable'))).toBe(true);
  });

  test('rejects requirement cycles', () => {
    const broken = structuredClone(DEFAULT_TREE_DATA);
    broken.techs.find((t) => t.id === 'ironworking')!.requires = [{ type: 'tech', id: 'steel_weapons' }];
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('cycle') && e.includes('Ironworking'))).toBe(true);
  });

  test('rejects unknown fields (typos)', () => {
    const broken = structuredClone(DEFAULT_TREE_DATA) as unknown as { units: Record<string, unknown>[] };
    broken.units[0].trainTime = 8;
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('units.0') && e.toLowerCase().includes('unrecognized'))).toBe(true);
  });

  test('rejects a unit requiring a building that does not exist', () => {
    const broken = structuredClone(DEFAULT_TREE_DATA);
    broken.units[0].requires = [{ type: 'building', id: 'castle' }];
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('units.worker.requires') && e.includes('castle'))).toBe(true);
  });
});
