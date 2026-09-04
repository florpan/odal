#!/usr/bin/env bun
// Validate a ruleset.
//   bun run validate:content            the default (TypeScript) ruleset
//   bun run validate:content <dir>      a JSON ruleset directory
import { resolve } from 'node:path';
import { validateTree } from '@odal/engine';
import { DEFAULT_TREE_DATA, validateTreeDir } from './index';

const dirArg = process.argv[2];
const label = dirArg ? resolve(dirArg) : 'packages/content/default (TypeScript)';
const { tree, errors } = dirArg ? validateTreeDir(resolve(dirArg)) : validateTree(DEFAULT_TREE_DATA);

if (errors.length) {
  console.error(`Tech tree in ${label} has ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `Tech tree "${tree!.name}" in ${label} is valid: ${tree!.resources.length} resources, ${tree!.nodes.length} node types, ` +
    `${tree!.units.length} units, ${tree!.buildings.length} buildings, ${tree!.techs.length} techs.`,
);
