import { describe, expect, test } from 'bun:test';
import { buildGraph, mergeFiles, validateTree } from '@odal/engine';
import type { RulesetFiles } from '@odal/engine';
import { addEntity, connect, disconnect, list, locate, renameId, template, uniqueId } from './ops';

// A small ruleset in the authored (JSON) shape, as the editor sees it.
const files: RulesetFiles = {
  rules: {
    name: 'T',
    version: 1,
    rules: { map: { width: 32, height: 32 }, startResources: { wood: 10 }, playerColors: ['#ff0000'] },
    start: { building: 'camp', units: [{ type: 'peon', count: 1 }] },
  },
  resources: [{ id: 'wood', name: 'Wood' }],
  nodes: [
    {
      id: 'tree',
      name: 'Tree',
      resource: 'wood',
      amount: 10,
      gatherTime: 1,
      gatherAmount: 1,
      spawn: { kind: 'deposit', depositsPer1000Tiles: 1, size: [1, 2] },
      visual: { shape: 'cone', color: '#00ff00' },
    },
  ],
  units: [{ id: 'peon', name: 'Peon', time: 1, hp: 1, speed: 1, cost: { wood: 1 }, abilities: ['harvest', 'build'] }],
  buildings: [
    {
      id: 'camp',
      name: 'Camp',
      buildable: false,
      time: 0,
      hp: 1,
      size: { w: 1, h: 1 },
      dropOff: true,
      trains: ['peon'],
      visual: { color: '#ffffff' },
    },
    {
      id: 'hall',
      name: 'Hall',
      time: 1,
      hp: 1,
      size: { w: 1, h: 1 },
      cost: { wood: 5 },
      researches: ['fire'],
      visual: { color: '#ffffff' },
    },
  ],
  techs: [{ id: 'fire', name: 'Fire', time: 1, effects: [{ type: 'gatherRate', resource: 'wood', multiplier: 2 }] }],
};

const valid = (f: RulesetFiles) => validateTree(mergeFiles(f)).errors;

describe('editor ops', () => {
  test('the fixture is a valid ruleset', () => {
    expect(valid(files)).toEqual([]);
  });

  test('connect adds a requirement edge and disconnect removes it again', () => {
    const withReq = connect(files, { kind: 'tech', id: 'fire' }, { kind: 'building', id: 'hall' }, 'requires');
    const edges = buildGraph(validateTree(mergeFiles(withReq)).tree!).edges;
    expect(edges.some((e) => e.reason === 'requires' && e.from.id === 'fire' && e.to.id === 'hall')).toBe(true);
    const back = disconnect(withReq, {
      from: { kind: 'tech', id: 'fire' },
      to: { kind: 'building', id: 'hall' },
      reason: 'requires',
    });
    expect(list(back, 'buildings')[1].requires).toBeUndefined();
  });

  test('connect as trains puts the unit on the building', () => {
    const f = connect(files, { kind: 'building', id: 'hall' }, { kind: 'unit', id: 'peon' }, 'trains');
    expect(list(f, 'buildings')[1].trains).toEqual(['peon']);
    // Idempotent.
    expect(connect(f, { kind: 'building', id: 'hall' }, { kind: 'unit', id: 'peon' }, 'trains')).toBe(f);
  });

  test('renameId follows every reference', () => {
    const f = renameId(renameId(files, 'resources', 'wood', 'lumber'), 'units', 'peon', 'worker');
    expect(valid(f)).toEqual([]);
    const rules = f.rules as {
      rules: { startResources: Record<string, number> };
      start: { units: { type: string }[] };
    };
    expect(rules.rules.startResources).toEqual({ lumber: 10 });
    expect(rules.start.units[0].type).toBe('worker');
    expect(list(f, 'nodes')[0].resource).toBe('lumber');
    expect(list(f, 'units')[0].cost).toEqual({ lumber: 1 });
    expect(list(f, 'buildings')[0].trains).toEqual(['worker']);
    expect((list(f, 'techs')[0].effects as { resource: string }[])[0].resource).toBe('lumber');
  });

  test('templates produce valid entities and unique ids', () => {
    let f = files;
    for (const file of ['resources', 'nodes', 'units', 'buildings', 'techs'] as const) {
      f = addEntity(f, file, template(f, file)).files;
    }
    // New units/techs are unobtainable until connected; everything else must be fine.
    const errors = valid(f);
    expect(errors.every((e) => e.includes('unobtainable'))).toBe(true);
    expect(uniqueId(f, 'units', 'new_unit')).toBe('new_unit_2');
  });

  test('locate maps validator messages to the entity', () => {
    expect(locate(files, 'buildings.hall.cost: unknown resource "gold"')).toEqual({ file: 'buildings', index: 1 });
    expect(locate(files, 'units.0: unrecognized key')).toEqual({ file: 'units', index: 0 });
    expect(locate(files, 'tech:fire: unobtainable (…)')).toEqual({ file: 'techs', index: 0 });
    expect(locate(files, 'rules.startResources: unknown resource "x"')).toEqual({ file: 'rules', index: 0 });
    expect(locate(files, 'dependency cycle: A → B')).toBeNull();
  });
});
