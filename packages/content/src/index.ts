import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULESET_FILES, mergeFiles, parseTree, validateTree } from '@odal/engine';
import type { RulesetFile, RulesetFiles, TechTree, TechTreeInput, TreeValidation } from '@odal/engine';
import buildings from '../default/buildings.json';
import nodes from '../default/nodes.json';
import resources from '../default/resources.json';
import rules from '../default/rules.json';
import techs from '../default/techs.json';
import units from '../default/units.json';

// ---------------------------------------------------------------------------
// Game content. A ruleset is six JSON files (rules, resources, nodes, units,
// buildings, techs) in one directory that together form one TechTree (see
// docs/CONTENT.md). The default ruleset is packages/content/default/; the
// content editor (client /editor.html) reads and writes it through the dev
// server. Any other directory loads the same way with TREE_DIR.
//
// JSON Schema files for editor support are generated from the zod schemas by
// `bun run schema:gen` into packages/content/schema/.
// ---------------------------------------------------------------------------

export { RULESET_FILES, mergeFiles };
export type { RulesetFile, RulesetFiles };

/** Absolute path of the default ruleset directory. */
export const DEFAULT_TREE_DIR = join(import.meta.dir, '../default');

/** The default ruleset as authored (defaults not yet applied). */
export const DEFAULT_TREE_DATA = mergeFiles({ rules, resources, nodes, units, buildings, techs }) as TechTreeInput;

/** The default ruleset, validated. Throws at import time if the content is broken. */
export const DEFAULT_TREE: TechTree = parseTree(DEFAULT_TREE_DATA);

/** Read the six JSON files of a ruleset directory. */
export function readTreeFiles(dir: string): RulesetFiles {
  const read = (file: RulesetFile) => JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8')) as unknown;
  const out = {} as RulesetFiles;
  for (const f of RULESET_FILES) out[f] = read(f);
  return out;
}

/** Merge the six JSON files of a ruleset directory into one tree object (unvalidated). */
export function readTreeDir(dir: string): unknown {
  return mergeFiles(readTreeFiles(dir));
}

export function validateTreeDir(dir: string): TreeValidation {
  return validateTree(readTreeDir(dir));
}

export function loadTreeDir(dir: string): TechTree {
  return parseTree(readTreeDir(dir));
}
