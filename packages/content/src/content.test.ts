import { describe, expect, test } from 'bun:test';
import { chainCost, validateTree } from '@odal/engine';
import type { TechTreeInput } from '@odal/engine';
import { DEFAULT_TREE, DEFAULT_TREE_DATA, DEFAULT_TREE_DIR, readTreeDir } from './index';
import { jsonSchemaFor } from './schema';

const clone = () => structuredClone(DEFAULT_TREE_DATA) as Required<TechTreeInput>;

describe('default ruleset', () => {
  test('validates', () => {
    const { errors } = validateTree(DEFAULT_TREE_DATA);
    expect(errors).toEqual([]);
  });

  test('loads identically from the directory on disk', () => {
    expect(readTreeDir(DEFAULT_TREE_DIR)).toEqual(DEFAULT_TREE_DATA);
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

  test('every resource is spent on something', () => {
    const spent = new Set<string>();
    for (const list of [DEFAULT_TREE.units, DEFAULT_TREE.buildings, DEFAULT_TREE.techs])
      for (const p of list) for (const k of Object.keys(p.cost)) spent.add(k);
    for (const r of DEFAULT_TREE.resources) expect(spent.has(r.id)).toBe(true);
  });

  test('chain cost of a gated building includes its tech', () => {
    const tower = DEFAULT_TREE.buildings.find((b) => b.attack)!;
    const { cost, steps } = chainCost(DEFAULT_TREE, { kind: 'building', id: tower.id });
    expect(steps).toBeGreaterThan(1);
    for (const k of Object.keys(tower.cost)) expect(cost[k]).toBeGreaterThanOrEqual(tower.cost[k]);
  });
});

describe('validator', () => {
  test('reports dangling references with a path', () => {
    const broken = clone();
    broken.buildings.find((b) => b.id === 'townhall')!.trains!.push('dragon');
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('buildings.townhall.trains') && e.includes('dragon'))).toBe(true);
  });

  test('accepts techs nobody researches (research is community-wide) but rejects buildings nobody can place', () => {
    const orphan = structuredClone(DEFAULT_TREE) as unknown as { techs: Record<string, unknown>[]; buildings: Record<string, unknown>[] };
    orphan.techs.push({ id: 'orphan', name: 'Orphan', time: 1 });
    expect(validateTree(orphan).errors).toEqual([]);
    orphan.buildings.push({ id: 'ghost', name: 'Ghost', buildable: false, time: 1, hp: 1, visual: { color: '#ffffff' } });
    const { errors } = validateTree(orphan);
    expect(errors.some((e) => e.includes('building:ghost') && e.includes('unobtainable'))).toBe(true);
  });

  test('rejects requirement cycles', () => {
    const broken = clone();
    broken.techs.find((t) => t.id === 'ironworking')!.requires = [{ type: 'tech', id: 'steel_weapons' }];
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('cycle') && e.includes('Ironworking'))).toBe(true);
  });

  test('rejects unknown fields (typos)', () => {
    const broken = clone() as unknown as { units: Record<string, unknown>[] };
    broken.units[0].trainTime = 8;
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('units.0') && e.toLowerCase().includes('unrecognized'))).toBe(true);
  });

  test('rejects a unit requiring a building that does not exist', () => {
    const broken = clone();
    broken.units[0].requires = [{ type: 'building', id: 'dragon_lair' }];
    const { errors } = validateTree(broken);
    expect(errors.some((e) => e.includes('units.worker.requires') && e.includes('dragon_lair'))).toBe(true);
  });

  test('accepts population requirements and author notes', () => {
    const ok = clone();
    ok.techs[0].requires = [{ type: 'population', min: 10 }];
    ok.techs[0].notes = 'late game gate';
    expect(validateTree(ok).errors).toEqual([]);
  });
});

describe('json schema generation', () => {
  test('produces a schema per ruleset file that mentions its fields', () => {
    expect(jsonSchemaFor('units')).toContain('"abilities"');
    expect(jsonSchemaFor('buildings')).toContain('"passable"');
    expect(jsonSchemaFor('rules')).toContain('"startResources"');
  });
});
