import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULESET_FILES, loadTreeDir, mergeFiles, readTreeFiles } from '@odal/content';
import type { RulesetFiles } from '@odal/content';
import { validateTree } from '@odal/engine';
import type { TechTree } from '@odal/engine';
import prettier from 'prettier';

// ---------------------------------------------------------------------------
// Development-only routes for the content editor (client /editor.html).
//   GET /dev/tree   → { dir, files: { rules, resources, nodes, units, buildings, techs } }
//   PUT /dev/tree   ← { files }  validates, formats with Prettier, writes the six JSON files
// Only mounted when ODAL_DEV=1 (the `dev` script sets it). Never in production:
// it writes to the repository. Saving restarts the watching dev server, which
// (when its cwd is the repo root) and swaps the ruleset for new rooms.
// ---------------------------------------------------------------------------

export function devHandler(
  dir: string,
  onSaved: (tree: TechTree) => void,
): (req: Request, url: URL) => Promise<Response | null> {
  return async (req, url) => {
    if (url.pathname !== '/dev/tree') return null;
    if (req.method === 'GET') return Response.json({ dir, files: readTreeFiles(dir) });
    if (req.method !== 'PUT') return new Response('Method not allowed', { status: 405 });

    const body = (await req.json()) as { files?: Partial<RulesetFiles> };
    const files = body.files ?? {};
    const missing = RULESET_FILES.filter((f) => files[f] === undefined);
    if (missing.length)
      return Response.json({ ok: false, errors: [`missing files: ${missing.join(', ')}`] }, { status: 400 });

    const { errors } = validateTree(mergeFiles(files as RulesetFiles));
    if (errors.length) return Response.json({ ok: false, errors }, { status: 400 });

    const config = (await prettier.resolveConfig(dir)) ?? {};
    for (const f of RULESET_FILES) {
      const text = await prettier.format(JSON.stringify(files[f]), { ...config, parser: 'json' });
      writeFileSync(join(dir, `${f}.json`), text);
    }
    onSaved(loadTreeDir(dir));
    return Response.json({ ok: true });
  };
}
