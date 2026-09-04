#!/usr/bin/env bun
// Generate JSON Schema files from the engine's zod schemas so editors give
// autocomplete and red squiggles on the JSON rulesets (.vscode/settings.json
// maps each file name to its schema).
//   bun run schema:gen            write packages/content/schema/*.schema.json
//   bun run schema:gen --check    exit 1 if the committed files are stale (CI)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_SCHEMAS } from '@odal/engine';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { RULESET_FILES } from './index';

export const SCHEMA_DIR = join(import.meta.dir, '../schema');

/** JSON Schema text for one ruleset file. Lists wrap their item schema in an array. */
export function jsonSchemaFor(file: (typeof RULESET_FILES)[number]): string {
  const item = FILE_SCHEMAS[file];
  const schema = file === 'rules' ? item : z.array(item);
  const json = zodToJsonSchema(schema, { name: file, $refStrategy: 'none' }) as Record<string, unknown>;
  // Allow the $schema key editors add, without loosening the strict engine schema.
  const target = (file === 'rules' ? json.definitions : undefined) as
    Record<string, Record<string, unknown>> | undefined;
  if (target?.[file] && typeof target[file].properties === 'object') {
    (target[file].properties as Record<string, unknown>).$schema = { type: 'string' };
  }
  return JSON.stringify(json, null, 2) + '\n';
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  if (!existsSync(SCHEMA_DIR)) mkdirSync(SCHEMA_DIR, { recursive: true });
  let stale = 0;
  for (const file of RULESET_FILES) {
    const path = join(SCHEMA_DIR, `${file}.schema.json`);
    const next = jsonSchemaFor(file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current === next) continue;
    if (check) {
      console.error(`stale: ${path} (run \`bun run schema:gen\`)`);
      stale++;
    } else {
      writeFileSync(path, next);
      console.log(`wrote ${path}`);
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log('JSON schemas are up to date.');
  }
}
