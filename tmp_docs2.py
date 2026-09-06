def sub(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        if a not in s:
            raise SystemExit(f"MISSING in {p}: {a[:70]}")
        s = s.replace(a, b)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)

sub('docs/CONTENT.md', [
 ("| `resources.json` | `ResourceDef[]`                   |\n",
  "| `resources.json` | `ResourceDef[]`                   |\n| `terrain.json`   | `TerrainDef[]`                    |\n"),
 ("| `map.width`, `map.height` | required | Tiles (16–256)                                                                                                                                       |",
  "| `map.width`, `map.height` | required | Hex columns and rows (16–256)                                                                                                                        |\n| `map.ground`              | required | Terrain id every hex starts as. Must be passable                                                                                                     |\n| `map.island`              | –        | `{ water, shore: 0.12, roughness: 0.06 }`: makes the map an island. `water` is the terrain outside the coast, `shore` how much of the half-size is sea at the edge, `roughness` how far the coastline wanders. Without it the whole map is `ground` |"),
 ("### nodes\n",
  "### terrain\n\n| Field      | Default  | Meaning                                                                                                                                                                                                                     |\n| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |\n| `passable` | true     | `false` blocks like a node: nothing walks, spawns or builds there (water)                                                                                                                                                   |\n| `visual`   | required | `{ color, height: 0, model? }`. `height` is where the tile's top sits relative to the ground plane (water below 0 gives a shore step). `model` is a GLB hex tile under `/models/`, one hex wide, top at y=0; without it a flat coloured hex is drawn |\n\nEvery hex of a generated map has one terrain (`state.terrain`, an index into this list). Unexplored hexes are\nnot drawn at all, so the island's shape is something to scout.\n\n### nodes\n"),
])

sub('docs/PLAN.md', [
 ("A hex grid (`rules.map`, 96×96 hexes by default) from a seed: forest blobs, stone, iron and gold deposits,",
  "A hex grid (`rules.map`, 96×96 hexes by default) from a seed: an island with a wandering coastline and\nimpassable water around it (terrain is data, `terrain.json`), forest blobs, stone, iron and gold deposits,"),
 ("- [ ] Terrain texture, water/cliffs as impassable terrain",
  "- [x] Terrain layer: `terrain.json`, island with water as the natural border, unexplored hexes hidden (2026-09-06)\n- [ ] KayKit hex tiles as ground (grass, coast, water), then per-hex stepped height"),
])

sub('docs/ARCHITECTURE.md', [
 ("| `mapgen.ts`    | Seeded map generation: start slots on a ring, per-start home resources, each node type's `spawn` scatter (optionally centre-only), then a corridor for any start sealed in. |",
  "| `mapgen.ts`    | Seeded map generation: terrain (island coastline), start slots on a ring, per-start home resources, each node type's `spawn` scatter, then a corridor for any start sealed in. |"),
 ("hex (`x`, `y`); a building's footprint is its centre hex plus every hex within `r` steps. Units and every",
  "hex (`x`, `y`); a building's footprint is its centre hex plus every hex within `r` steps. `state.terrain`\nholds one terrain index per hex; impassable terrain is part of the blocked grid. Units and every"),
])
print('ok')
