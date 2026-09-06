import json, re

def sub(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---- engine types + schema
sub('packages/engine/src/content.ts', [
 ("""    relief?: { levels: number; scale: number };
  };""",
  """    relief?: { levels: number; scale: number };
    /**
     * Clumps of other terrain scattered over the ground (hills, mountains): `per1000` clumps per 1000
     * land hexes, each a random walk of `size` hexes. Nothing spawns on them; whether units cross
     * them is the terrain's `passable`.
     */
    features: { terrain: string; per1000: number; size: [number, number] }[];
  };"""),
])
sub('packages/engine/src/tree.ts', [
 ("""        relief: z
          .object({ levels: z.number().int().min(1).max(4), scale: Positive.default(9) })
          .strict()
          .optional(),
      })
      .strict(),""",
  """        relief: z
          .object({ levels: z.number().int().min(1).max(4), scale: Positive.default(9) })
          .strict()
          .optional(),
        features: z
          .array(
            z
              .object({
                terrain: Id,
                per1000: NonNeg,
                size: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),"""),
 ("""  if (t.rules.map.island) {
    checkRef('rules.map.island.water', ids.terrain, t.rules.map.island.water, 'terrain');""",
  """  t.rules.map.features.forEach((f, i) => {
    checkRef(`rules.map.features[${i}].terrain`, ids.terrain, f.terrain, 'terrain');
    if (f.terrain === t.rules.map.ground) errors.push(`rules.map.features[${i}].terrain: must differ from rules.map.ground`);
  });
  if (t.rules.map.island) {
    checkRef('rules.map.island.water', ids.terrain, t.rules.map.island.water, 'terrain');"""),
])

# ---- mapgen: features pass, relief on all non-water land, hills walkable for connectivity
sub('packages/engine/src/mapgen.ts', [
 (""" * 1. `rules.map.starts` start slots on a ring around the centre, evenly spaced
 *    at a random rotation, on land. Players at the edges, the middle in between.
 * 2. Home zones:""",
  """ * 1. `rules.map.starts` start slots on a ring around the centre, evenly spaced
 *    at a random rotation, on land. Players at the edges, the middle in between.
 * 1b. Features: `rules.map.features` clumps of other terrain (hills, mountains)
 *    random-walked over the ground, away from the start clearings.
 * 2. Home zones:"""),
 ("""  const island = rules.map.island;
  /** How far inland (in world units, along each axis) the coast is guaranteed to be. */
  let landX = cx;
  let landY = cy;
  if (island) {
    const waterIdx = tree.terrain.findIndex((t) => t.id === island.water);""",
  """  const island = rules.map.island;
  const waterIdx = island ? tree.terrain.findIndex((t) => t.id === island.water) : -1;
  const isWater = (i: number) => terrain[i] === waterIdx;
  /** How far inland (in world units, along each axis) the coast is guaranteed to be. */
  let landX = cx;
  let landY = cy;
  if (island) {"""),
 ("""  // The start hexes themselves stay free: the starting building goes there.
  for (const s of starts) occupied.add(s.y * w + s.x);
""",
  """  // The start hexes themselves stay free: the starting building goes there.
  for (const s of starts) occupied.add(s.y * w + s.x);

  // 1b. Features: clumps of hills, mountains, ... on the ground, clear of the start clearings.
  //     They join `occupied` so no node spawns on them.
  const nearStart = (x: number, y: number) =>
    starts.some((s) => hexDistance(s, { x, y }) <= rules.startClearRadius + 1);
  for (const f of rules.map.features) {
    const fIdx = tree.terrain.findIndex((t) => t.id === f.terrain);
    const count = Math.round(f.per1000 * per1000);
    for (let k = 0; k < count; k++) {
      let x = 2 + Math.floor(rng() * (w - 4));
      let y = 2 + Math.floor(rng() * (h - 4));
      const n = f.size[0] + Math.floor(rng() * (f.size[1] - f.size[0] + 1));
      for (let step = 0; step < n; step++) {
        const i = y * w + x;
        if (isLand(x, y) && !occupied.has(i) && !nearStart(x, y)) {
          terrain[i] = fIdx;
          occupied.add(i);
        }
        const next = hexNeighbours(x, y)[Math.floor(rng() * 6)];
        x = next.x;
        y = next.y;
      }
    }
  }
"""),
 ("""  const byTile = new Map<number, number>();
  for (const id in nodes) byTile.set(nodes[id].y * w + nodes[id].x, Number(id));
  const blockedAt = (i: number) => byTile.has(i) || terrain[i] !== groundIdx;""",
  """  const byTile = new Map<number, number>();
  for (const id in nodes) byTile.set(nodes[id].y * w + nodes[id].x, Number(id));
  const blockedAt = (i: number) => byTile.has(i) || !tree.terrain[terrain[i]].passable;"""),
 ("""    const land = Array.from(values.filter((_, i) => terrain[i] === groundIdx)).sort((a, b) => a - b);""",
  """    const land = Array.from(values.filter((_, i) => !isWater(i))).sort((a, b) => a - b);"""),
 ("""    for (let i = 0; i < w * h; i++) {
      if (terrain[i] !== groundIdx) continue;
      let level = 0;
      for (const t of thresholds) if (values[i] >= t) level++;
      elevation[i] = level;
    }
    // The beach is flat, and every slope is a single step.
    for (let i = 0; i < w * h; i++) {
      if (terrain[i] !== groundIdx) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (hexNeighbours(x, y).some((n) => n.x >= 0 && n.y >= 0 && n.x < w && n.y < h && terrain[n.y * w + n.x] !== groundIdx))
        elevation[i] = 0;
    }""",
  """    for (let i = 0; i < w * h; i++) {
      if (isWater(i)) continue;
      let level = 0;
      for (const t of thresholds) if (values[i] >= t) level++;
      elevation[i] = level;
    }
    // The beach is flat, and every slope is a single step.
    for (let i = 0; i < w * h; i++) {
      if (isWater(i)) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (hexNeighbours(x, y).some((n) => n.x >= 0 && n.y >= 0 && n.x < w && n.y < h && isWater(n.y * w + n.x)))
        elevation[i] = 0;
    }"""),
])

# ---- tests: shore means next to water; features present and mountains blocked
sub('packages/engine/src/game.test.ts', [
 ("""        const land = st.terrain[i] === groundIdx;
        let shore = false;
        for (const n of hexNeighbours(x, y)) {
          if (n.x < 0 || n.y < 0 || n.x >= st.width || n.y >= st.height) continue;
          const j = n.y * st.width + n.x;
          if (st.terrain[j] !== groundIdx) shore = true;
          expect(Math.abs(st.elevation[j] - e)).toBeLessThanOrEqual(1);
        }
        if (!land || shore) expect(e).toBe(0);""",
  """        const water = st.terrain[i] === waterIdx;
        let shore = false;
        for (const n of hexNeighbours(x, y)) {
          if (n.x < 0 || n.y < 0 || n.x >= st.width || n.y >= st.height) continue;
          const j = n.y * st.width + n.x;
          if (st.terrain[j] === waterIdx) shore = true;
          expect(Math.abs(st.elevation[j] - e)).toBeLessThanOrEqual(1);
        }
        if (water || shore) expect(e).toBe(0);"""),
 ("""    const groundIdx = DEFAULT_TREE.terrain.findIndex((t) => t.id === rules.map.ground);
    for (const seed of [1, 7, 42]) {
      const st = createGame(DEFAULT_TREE, seed);
      expect(st.elevation.length).toBe(st.width * st.height);""",
  """    const waterIdx = DEFAULT_TREE.terrain.findIndex((t) => t.id === rules.map.island!.water);
    for (const seed of [1, 7, 42]) {
      const st = createGame(DEFAULT_TREE, seed);
      expect(st.elevation.length).toBe(st.width * st.height);"""),
 ("  test('centre-zone deposits stay in the middle of the map', () => {",
  """  test('terrain features are scattered on land, carry no nodes, and impassable ones block', () => {
    const { rules } = DEFAULT_TREE;
    expect(rules.map.features.length).toBeGreaterThan(0);
    const st = createGame(DEFAULT_TREE, 7);
    const blocked = computeBlocked(st);
    for (const f of rules.map.features) {
      const idx = DEFAULT_TREE.terrain.findIndex((t) => t.id === f.terrain);
      const hexes = st.terrain.map((t, i) => (t === idx ? i : -1)).filter((i) => i >= 0);
      expect(hexes.length).toBeGreaterThan(0);
      for (const i of hexes) {
        expect(Object.values(st.nodes).some((n) => n.y * st.width + n.x === i)).toBe(false);
        expect(blocked[i]).toBe(DEFAULT_TREE.terrain[idx].passable ? 0 : 1);
        for (const s of st.starts) expect(hexDistance(s, { x: i % st.width, y: Math.floor(i / st.width) })).toBeGreaterThan(rules.startClearRadius);
      }
    }
  });

  test('centre-zone deposits stay in the middle of the map', () => {"""),
])

# ---- content
terrain = json.load(open('packages/content/default/terrain.json', encoding='utf-8'))
terrain.append({
    "id": "hills", "name": "Hills", "desc": "Rolling ground. Walkable, nothing grows on it.",
    "visual": {"color": "#8a9a3c", "model": "hex_hills_a.glb"}})
terrain.append({
    "id": "mountain", "name": "Mountain", "desc": "Bare rock. Nothing crosses it.", "passable": False,
    "visual": {"color": "#8d8d8d", "height": 0, "model": "hex_mountain_a_trees.glb"}})
json.dump(terrain, open('packages/content/default/terrain.json', 'w', encoding='utf-8', newline='\n'), indent=2)

rules = json.load(open('packages/content/default/rules.json', encoding='utf-8'))
rules['rules']['map']['features'] = [
    {"terrain": "hills", "per1000": 5, "size": [3, 7]},
    {"terrain": "mountain", "per1000": 3, "size": [2, 5]},
]
json.dump(rules, open('packages/content/default/rules.json', 'w', encoding='utf-8', newline='\n'), indent=2)

nodes = json.load(open('packages/content/default/nodes.json', encoding='utf-8'))
for n in nodes:
    if n['id'] == 'tree':
        n['visual']['models'] = ['hex_trees_a_large.glb', 'hex_trees_b_large.glb', 'hex_trees_a_medium.glb', 'hex_trees_b_medium.glb']
        n['visual']['scale'] = 1
        n['notes'] = 'Hexagon-pack forest clusters (one hex = a wood). Forest Nature trees (tree_1..4.glb, scale 0.6) are the alternative.'
    if n['id'] == 'stone_rock':
        n['visual']['models'] = ['hex_rock_single_c.glb', 'hex_rock_single_e.glb', 'hex_rock_single_d.glb']
        n['visual']['scale'] = 3
json.dump(nodes, open('packages/content/default/nodes.json', 'w', encoding='utf-8', newline='\n'), indent=2)

# ---- docs
sub('docs/CONTENT.md', [
 ("| `map.island`              | –        |",
  "| `map.features`            | `[]`     | `[{ terrain, per1000, size: [min, max] }]`: clumps of another terrain (hills, mountains) random-walked over the ground, `per1000` clumps per 1000 land hexes of `size` hexes each, clear of the start clearings. No node spawns on them; `passable` decides whether units cross |\n| `map.island`              | –        |"),
])
sub('docs/PLAN.md', [
 ("- [ ] The pack's sloped tiles on the steps, cliffs as terrain that costs more to climb (a `findPath` parameter)",
  "- [x] Hexagon-pack decorations tried (2026-09-06): forest clusters as tree nodes, pack rocks as stone (scale 3), hills and\n      mountains composed onto a grass tile as terrains scattered by `rules.map.features`. Verdict pending Christer.\n- [ ] The pack's sloped tiles on the steps, cliffs as terrain that costs more to climb (a `findPath` parameter)"),
])
sub('docs/ARCHITECTURE.md', [
 ("Seeded map generation: terrain (island coastline), start slots on a ring,",
  "Seeded map generation: terrain (island coastline, feature clumps), start slots on a ring,"),
])
print('ok')
