import { DEFAULT_TREE } from '../../packages/content/src/index';
import { createGame } from '../../packages/engine/src/index';
import type { TechTree } from '../../packages/engine/src/index';

// ---------------------------------------------------------------------------
// ASCII preview of generated maps, for tuning rules.map without starting the
// game:  bun tools/map/preview.ts [seed ...] [--scale N] [--land F] [--shore F]
//        [--levels N] [--relief-scale N] [--size N] [--shape]
// Overrides apply to the default ruleset in memory only. One character per
// hex column, every other row: '~' water, digits elevation, 'S' start, '^' a
// feature terrain, '*' a resource node.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const seeds: number[] = [];
const opt: Record<string, number> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--shape') opt.shape = 1;
  else if (a.startsWith('--')) opt[a.slice(2)] = Number(args[++i]);
  else seeds.push(Number(a));
}
if (!seeds.length) seeds.push(1, 7, 42);

const tree = structuredClone(DEFAULT_TREE) as TechTree;
const island = tree.rules.map.island!;
if (opt.size !== undefined) tree.rules.map.width = tree.rules.map.height = opt.size;
if (opt.scale !== undefined) island.scale = opt.scale;
if (opt.land !== undefined) island.land = opt.land;
if (opt.shore !== undefined) island.shore = opt.shore;
if (tree.rules.map.relief) {
  if (opt.levels !== undefined) tree.rules.map.relief.levels = opt.levels;
  if (opt['relief-scale'] !== undefined) tree.rules.map.relief.scale = opt['relief-scale'];
}
const waterIdx = tree.terrain.findIndex((t) => t.id === island.water);
const groundIdx = tree.terrain.findIndex((t) => t.id === tree.rules.map.ground);

for (const seed of seeds) {
  const st = createGame(tree, seed);
  const { width: w, height: h } = st;
  const starts = new Set(st.starts.map((s) => s.y * w + s.x));
  const nodes = new Set(Object.values(st.nodes).map((n) => n.y * w + n.x));
  let land = 0;
  let cliffs = 0;
  for (let i = 0; i < w * h; i++) if (st.terrain[i] !== waterIdx) land++;
  const lines: string[] = [];
  const shape = 'shape' in opt; // --shape: coast only, half width, for judging the outline at a glance
  for (let y = 0; y < h; y += 2) {
    let line = y % 4 === 0 ? '' : ' ';
    for (let x = 0; x < w; x += shape ? 2 : 1) {
      if (shape) {
        line += st.terrain[y * w + x] === waterIdx ? '~' : '#';
        continue;
      }
      const i = y * w + x;
      const t = st.terrain[i];
      let ch: string;
      if (starts.has(i)) ch = 'S';
      else if (t === waterIdx) ch = '~';
      else if (nodes.has(i)) ch = '*';
      else if (t !== groundIdx) ch = '^';
      else ch = String(st.elevation[i]);
      if (t !== waterIdx && st.elevation[i] > 0) {
        for (const d of [-1, 1]) if (x + d >= 0 && x + d < w && st.terrain[i + d] === waterIdx) cliffs++;
      }
      line += ch + ' ';
    }
    lines.push(line);
  }
  console.log(
    `seed ${seed}: ${w}x${h}, land ${((100 * land) / (w * h)).toFixed(0)}%, island.scale ${island.scale}, land ${island.land}, cliff edges (sampled) ${cliffs}`,
  );
  console.log(lines.join('\n'));
  console.log();
}
