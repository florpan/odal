import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTree, validateTree } from '@odal/engine';
import type { TechTree, TechTreeInput, TreeValidation } from '@odal/engine';
import { buildings } from '../default/buildings';
import { nodes } from '../default/nodes';
import { resources } from '../default/resources';
import { name, rules, start, version } from '../default/rules';
import { techs } from '../default/techs';
import { units } from '../default/units';

// ---------------------------------------------------------------------------
// Game content. A ruleset is six files (rules, resources, nodes, units,
// buildings, techs) that together form one TechTree (see docs/CONTENT.md).
//
// The default ruleset is written in TypeScript, typed as UnitDefInput[] etc.,
// so authors get type checking and autocomplete; it is still validated at
// runtime like any other. External rulesets are plain JSON directories loaded
// with TREE_DIR.
// ---------------------------------------------------------------------------

export const RULESET_FILES = ['rules', 'resources', 'nodes', 'units', 'buildings', 'techs'] as const;

/** The default ruleset as authored (defaults not yet applied). */
export const DEFAULT_TREE_DATA: TechTreeInput = {
  name,
  version,
  rules,
  start,
  resources,
  nodes,
  units,
  buildings,
  techs,
};

/** The default ruleset, validated. Throws at import time if the content is broken. */
export const DEFAULT_TREE: TechTree = parseTree(DEFAULT_TREE_DATA);

/** Merge the six JSON files of a ruleset directory into one tree object (unvalidated). */
export function readTreeDir(dir: string): unknown {
  const read = (file: string) => JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8'));
  const base = read('rules') as Record<string, unknown>;
  return {
    ...base,
    resources: read('resources'),
    nodes: read('nodes'),
    units: read('units'),
    buildings: read('buildings'),
    techs: read('techs'),
  };
}

export function validateTreeDir(dir: string): TreeValidation {
  return validateTree(readTreeDir(dir));
}

export function loadTreeDir(dir: string): TechTree {
  return parseTree(readTreeDir(dir));
}
