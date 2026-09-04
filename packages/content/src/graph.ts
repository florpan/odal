#!/usr/bin/env bun
// Print the tech graph of a ruleset.
//   bun run tree:graph                      whole default tree as Mermaid
//   bun run tree:graph unit:soldier         what leads to the soldier (list + Mermaid)
//   bun run tree:graph building:barracks --dir path/to/ruleset
import { resolve } from 'node:path';
import { buildGraph, parseRef, prerequisites, refKey, refName, toMermaid } from '@odal/engine';
import { DEFAULT_TREE, loadTreeDir } from './index';

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const tree = dirIdx >= 0 ? loadTreeDir(resolve(args[dirIdx + 1])) : DEFAULT_TREE;
const targetArg = args.find((a, i) => !a.startsWith('--') && (dirIdx < 0 || i !== dirIdx + 1));
const graph = buildGraph(tree);

if (targetArg) {
  const target = parseRef(targetArg);
  if (!target) {
    console.error(`Bad target "${targetArg}". Use unit:<id>, building:<id> or tech:<id>.`);
    process.exit(1);
  }
  const chain = prerequisites(tree, target);
  console.log(`To obtain ${refName(tree, target)} (${refKey(target)}) you need, in order:`);
  for (const r of chain) console.log(`  ${refKey(r).padEnd(24)} ${refName(tree, r)}`);
  if (!chain.length) console.log('  (nothing, it is available from the start)');
  console.log('\nMermaid:\n');
  console.log(toMermaid(tree, graph, target));
} else {
  console.log(toMermaid(tree, graph));
}
