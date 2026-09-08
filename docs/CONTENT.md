# Content: the tech tree

Everything the game knows about resources, nodes, units, buildings and technologies is data in
`packages/content/default/`. Change the data, change the game. The engine only understands the generic
concepts described here.

Two ways to edit it:

- **The editor** (recommended for anything structural): run `bun run dev:server` and `bun run dev:editor`
  (or open http://localhost:5173/editor.html while `dev:client` runs; with a built client,
  `bun run start:editor` serves it at http://localhost:3000/editor.html). Plain `bun start` is production
  mode and has no editor routes. Left: everything that exists.
  Middle: the tree, drag from a prerequisite to what it unlocks, select an edge and press Delete to remove
  it. Right: the selected item's fields (generated from the schema) plus its facts: cost and time from
  scratch, where it is obtained, what it leads to. Bottom: the validator's complaints, click one to jump
  there. Save (Ctrl+S) validates, formats and writes the JSON; new rooms on the dev server use the new
  rules immediately. Renaming an id renames every reference.
- **A text editor**: the files are plain JSON. `.vscode/settings.json` maps them to JSON Schemas generated
  from the engine (`packages/content/schema/`), so VS Code autocompletes fields and flags mistakes.

```bash
bun run validate:content                    # validate the default ruleset
bun run schema:gen                          # regenerate the JSON Schemas after changing engine/src/tree.ts
bun run tree:graph                          # whole tree as a Mermaid diagram
bun run tree:graph unit:soldier             # what leads to the soldier, in order
bun packages/content/src/validate.ts <dir>  # validate another JSON ruleset directory
TREE_DIR=<dir> bun run dev:server           # play (and edit) another ruleset
```

The validator checks the schema (unknown fields are errors, so typos fail fast), every cross-reference,
and the dependency graph: no cycles, and everything must be obtainable from the starting position. CI runs
it, and fails if the committed JSON Schemas are stale. Tests in `content/src/content.test.ts` add sanity
checks such as "every resource can be obtained" and "every resource is spent on something".

In the game, **Tab** opens the same tree for players, coloured by what they have, what is in progress, what
they could get right now and what is still locked.

## Where the types live

|                                   |                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/src/content.ts`           | The interfaces. `EntityDef` → `ResourceDef`, `NodeDef`, `ProducibleDef` → `UnitDef`, `BuildingDef`, `TechDef`. This is the source of truth.                       |
| `engine/src/tree.ts`              | zod schemas with defaults, asserted at compile time to produce exactly those interfaces. `FILE_SCHEMAS` drives the editor's forms and the generated JSON Schemas. |
| `packages/content/default/*.json` | The default ruleset.                                                                                                                                              |
| `packages/content/schema/`        | Generated JSON Schemas (`bun run schema:gen`). Do not edit by hand.                                                                                               |
| `engine/src/techgraph.ts`         | The dependency graph derived from a tree: `buildGraph`, `prerequisites`, `chainCost`, `findCycle`, `unobtainable`, `toMermaid`.                                   |

The hierarchy exists so code can be written against the general shape: anything `ProducibleDef` has a
`cost`, a `time` and `requires`, so affordability, unlock checks and the tech graph work the same way for
units, buildings and techs.

## Files

| File             | Contents                          |
| ---------------- | --------------------------------- |
| `rules.json`     | `{ name, version, rules, start }` |
| `resources.json` | `ResourceDef[]`                   |
| `terrain.json`   | `TerrainDef[]`                    |
| `nodes.json`     | `NodeDef[]`                       |
| `units.json`     | `UnitDef[]`                       |
| `buildings.json` | `BuildingDef[]`                   |
| `techs.json`     | `TechDef[]`                       |

Ids are lowercase `snake_case`, unique within their file. Colors are `#rrggbb`. Times are seconds,
distances tiles, rates multipliers. A `$schema` key at the top level of a file is ignored.

## Field reference

Fields shared by every entity (`EntityDef`):

| Field        | Default  | Meaning                                                                        |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| `id`, `name` | required |                                                                                |
| `desc`       | `''`     | HUD text                                                                       |
| `notes`      | `''`     | Author notes: balance reasoning, todos. Shown in the editor, never to players. |

Fields shared by every unit, building and tech (`ProducibleDef`):

| Field      | Default  | Meaning                                             |
| ---------- | -------- | --------------------------------------------------- |
| `cost`     | `{}`     | `{ resourceId: amount }` paid when queued or placed |
| `time`     | required | Seconds to train / build (per builder) / research   |
| `requires` | `[]`     | Prerequisites, see below                            |

### requires

A list of requirements that must all hold before the thing can be trained, placed or queued:

```json
"requires": [
  { "type": "tech", "id": "ironworking" },
  { "type": "building", "id": "library" },
  { "type": "population", "min": 10 }
]
```

- `tech`: the player has researched it.
- `building`: the player owns a completed one.
- `population`: the player's living units add up to at least `min` population. A gate, not an edge: it
  is checked but not drawn in the tree.

Being trained by a building or researched at one is an implicit requirement and does not need listing.
The HUD shows the first missing requirement on the disabled button; the engine rejects the command with
the same message. Requirements feed the tech graph (below), so listing them explicitly is worth it even
when they are implied, because it makes the item's own card honest in the tree view.

### rules

| Field                     | Default  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tickRate`                | 10       | Simulation steps per second                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `map.width`, `map.height` | required | Hex columns and rows (16–256)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `map.ground`              | required | Terrain id every hex starts as. Must be passable                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `map.relief`              | –        | `{ levels, scale: 9 }`: hexes get an elevation of 0..`levels` steps from seeded noise with features about `scale` hexes across, independent of the coast. Water stays flat and slopes between land hexes are single steps, but land keeps its height at the coast: cliffs. A look only; movement ignores it                                                                                                                                                                                                                |
| `map.features`            | `[]`     | `[{ terrain, per1000, size: [min, max] }]`: clumps of another terrain (hills, mountains) random-walked over the ground, `per1000` clumps per 1000 land hexes of `size` hexes each, clear of the start clearings. No node spawns on them; `passable` decides whether units cross                                                                                                                                                                                                                                            |
| `map.island`              | –        | `{ water, shore: 0.12, scale: 26, land: 0.4 }`: makes the map an island cut from domain-warped fractal noise, with bays, inlets and peninsulas that say nothing about where the middle is. Preview shapes with `bun tools/map/preview.ts --shape`. `water` is the terrain outside the coast, `shore` how much of the half-size is always sea at the edge, `scale` the size of the bays (hexes), `land` the fraction of the whole map that is land. Only the largest landmass is kept. Without it the whole map is `ground` |
| `map.starts`              | 4        | Start slots on a ring around the centre (2–8). Players take the free slot farthest from everyone; late joiners beyond that land on a random far spot                                                                                                                                                                                                                                                                                                                                                                       |
| `homeRadius`              | 12       | Each start slot gets every node type's `spawn.perStart` within this radius                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `startResources`          | required | `{ resourceId: amount }` every player starts with                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `maxQueue`                | 5        | Max items in a building's train/research queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `separationDist`          | 0.6      | Units closer than this push each other apart (0 disables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `startClearRadius`        | 4        | Nodes within this radius of a start building are removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `upkeepInterval`          | 60       | Seconds between upkeep payments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `playerColors`            | required | Array of colors assigned in join order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### start

| Field      | Meaning                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `building` | Building id placed for each new player. Must be a `dropOff`. Usually `buildable: false`. |
| `units`    | `[{ type, count }]` spawned next to it                                                   |

### resources

| Field  | Default | Meaning                           |
| ------ | ------- | --------------------------------- |
| `icon` | `''`    | Shown in the HUD (an emoji works) |

The default ruleset gives each resource a primary sink (see PLAN.md): lumber for general buildings,
stone for protective buildings, iron for units, gold for research, wheat for unit count. That is a design
guideline, not a rule the engine knows about; mixed costs are the interesting ones.

### terrain

| Field      | Default  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passable` | true     | `false` blocks like a node: nothing walks, spawns or builds there (water)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `visual`   | required | `{ color, height: 0, model?, shore? }`. `height` is where the tile's top sits relative to the ground plane (water below 0 gives a shore step). `model` is a GLB hex tile under `/models/`, one hex wide, top at y=0; without it a flat coloured hex is drawn. `shore` lists coast tiles for a hex of this terrain that borders impassable terrain, by number of consecutive water edges (first entry = one edge; longer runs use the last entry); they are authored with the water side towards +z and the renderer turns them. `tools/models/kaykit_prop.py` mode `hex[:deg]` makes both from the KayKit Hexagon pack |

Every hex of a generated map has one terrain (`state.terrain`, an index into this list). Unexplored hexes are
not drawn at all, so the island's shape is something to scout.

### nodes

| Field          | Default  | Meaning                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource`     | required | Resource id gathered from it                                                                                                                                                                                                                                                                                                                                  |
| `amount`       | required | Total per node; the node disappears at 0                                                                                                                                                                                                                                                                                                                      |
| `gatherTime`   | required | Seconds per load                                                                                                                                                                                                                                                                                                                                              |
| `gatherAmount` | required | Resources per load                                                                                                                                                                                                                                                                                                                                            |
| `spawn`        | required | `{ kind: 'forest', clustersPer1000Tiles, radius: [min,max] }` blobs, or `{ kind: 'deposit', depositsPer1000Tiles, size: [min,max] }` small clumps. Both take `perStart` (default 0: clusters/deposits guaranteed within `rules.homeRadius` of every start slot) and `zone` (`'anywhere'` or `'centre'`, the middle fifth of the map, for contested resources) |
| `visual`       | required | `{ shape: 'cone' \| 'rock', color, models?, scale? }`. `models` lists GLBs under `/models/` at world scale (a hex is about 1 unit wide, base at y=0, a KayKit person is 1 unit tall); each node picks one by id, `scale` multiplies the size of all of them equally so their relative sizes survive. Without `models` the primitive is drawn                  |

### units

| Field         | Default  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hp`, `speed` | required | Speed in tiles/second                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `damage`      | 0        | Per hit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `range`       | 1        | Tiles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `attackTime`  | 1        | Seconds between hits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `aggro`       | 0        | Idle: fight enemy _units_ within this radius, then return. Attack-moving: fight anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `vision`      | 6        | Fog-of-war sight radius                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pop`         | 1        | Population used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `upkeep`      | `{}`     | `{ resourceId: amount }` paid every `rules.upkeepInterval` seconds while alive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `abilities`   | `[]`     | Any of `harvest`, `build`, `attack`. Decides which commands apply and which buttons show.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `visual`      | `{}`     | `{ width: 0.4, height: 1, helmet: false, model? }`. Without `model` the unit is a box in player colour with an optional helmet. With `model: "worker.glb"` the client loads that GLB from `/models/` (generated into `packages/client/public/models` by `tools/models`), scales it by `height` (models are authored 1 unit tall, feet at y=0, facing +z) and paints its material named `Team` in the player colour. If the GLB is skinned, its animation clips are played by name from the unit's task: `idle`, `walk` (whenever it moves), `chop` / `mine` (gathering at a cone / rock node), `build`, `attack`; `hit` and `death` are reserved. `tools/models/kaykit_character.py` assembles such a file from a KayKit character and animation pack. Missing file → box. |

Upkeep is summed per player and charged in one go. When a player can't pay, the resource bottoms out at 0
and they get a message. What else happens to starving units is an open balance decision (PLAN.md).

### buildings

| Field       | Default         | Meaning                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildable` | true            | `false` for things only placed by `start`                                                                                                                                                                                                                                                                                                                                              |
| `hp`        | required        |                                                                                                                                                                                                                                                                                                                                                                                        |
| `size`      | `{ radius: 0 }` | `{ radius }`: the footprint is the centre hex plus every hex within `radius` steps (0 = one hex, 1 = seven). The board-game rule of thumb is one hex per building                                                                                                                                                                                                                      |
| `pop`       | 0               | Population capacity granted when complete                                                                                                                                                                                                                                                                                                                                              |
| `trains`    | `[]`            | Unit ids                                                                                                                                                                                                                                                                                                                                                                               |
| `research`  | false           | Research is directed from this building: its card shows the "Select research" button (the town hall, the castle). Techs are never tied to a building; a tech that needs one says so in `requires`.                                                                                                                                                                                     |
| `upgrades`  | `[]`            | Building ids this one can turn into in place (town hall → castle, tower → stone tower). The target's own `cost`, `time` and `requires` are the upgrade's; the target is usually not `buildable`. The `upgrade` command queues it like research; the building keeps working and becomes the target when the time is up, same id, hex and facing, full HP of the new kind.               |
| `dropOff`   | false           | Harvesters deliver here                                                                                                                                                                                                                                                                                                                                                                |
| `accepts`   | `[]`            | Resource ids a drop-off takes; empty means everything. A harvester carrying something no finished drop-off takes stops and says so.                                                                                                                                                                                                                                                    |
| `limit`     | –               | At most this many per player, counting ones under construction (one shrine).                                                                                                                                                                                                                                                                                                           |
| `produces`  | –               | `{ resource, amount, interval }` passive income while complete                                                                                                                                                                                                                                                                                                                         |
| `attack`    | –               | `{ damage, range, attackTime }`: once complete it shoots the nearest enemy within `range` (towers). Raw damage; unit damage techs do not apply.                                                                                                                                                                                                                                        |
| `passable`  | false           | The owner's units walk through it, everyone else is blocked (gates)                                                                                                                                                                                                                                                                                                                    |
| `vision`    | 6               |                                                                                                                                                                                                                                                                                                                                                                                        |
| `hotkey`    | –               | Single letter for build mode. Must be unique. Avoid `A`, `S`, `W`, `D`, `X` (camera/commands).                                                                                                                                                                                                                                                                                         |
| `visual`    | required        | `{ shape: 'box' \| 'cone', color, height, glow?, model? }`. `glow` adds emissive color and a point light. `model` is a GLB under `/models/` authored to fill one hex (about 1 unit wide) with its base at y=0, scaled up for larger footprints; `{team}` in the name becomes the owner's nearest KayKit colour (red, blue, green, yellow). Remembered enemy buildings stay primitives. |

### techs

| Field     | Default | Meaning                                                                  |
| --------- | ------- | ------------------------------------------------------------------------ |
| `effects` | `[]`    | See below. A tech with no effects is still useful as a requirement gate. |

Research is community-wide: a player queues techs from the tech tree (`research` command, `rules.maxQueue`
deep, one in progress at a time) and only `requires` gates them. A building that is not `buildable` (and is
not the start building) must appear in some building's `upgrades`.

### effects

All effects multiply. Filters are optional; omit them to affect everything of that kind.

| `type`        | Filter     | Applies to                                                                          |
| ------------- | ---------- | ----------------------------------------------------------------------------------- |
| `gatherRate`  | `resource` | Gathering speed of that resource                                                    |
| `produceRate` | `building` | `produces` interval of that building                                                |
| `damage`      | `unit`     | Damage per hit                                                                      |
| `maxHp`       | `unit`     | Max HP (new units; existing keep current HP)                                        |
| `speed`       | `unit`     | Movement speed                                                                      |
| `buildingHp`  | `building` | Max HP of buildings completed after the research (existing buildings are unchanged) |
| `buildSpeed`  | –          | Construction speed of all builders                                                  |

Example: `{ "type": "damage", "unit": "soldier", "multiplier": 1.5 }`.

Need a new effect? Add it to `Effect` in `engine/src/content.ts` and `EffectSchema` in `tree.ts`, apply
it in the relevant system via a helper in `engine/src/queries.ts`, add a case to `describeEffect`, add a
test, run `bun run schema:gen`, and document it here. The editor picks it up from the schema.

## The tech graph

`buildGraph(tree)` turns a ruleset into a directed graph. Nodes are units, buildings and techs; an edge
A → B means A must exist before B: a building `trains` a unit or `upgrades` into a building, or A is in
B's `requires`. Population requirements are not edges. On top of it:

- `prerequisites(tree, ref)` – everything needed for `ref`, in an order you could obtain them in.
- `chainCost(tree, ref)` – total cost, summed time and step count of `ref` plus its whole prerequisite
  chain. The number shown as "From scratch" in the editor and the in-game tree.
- `findCycle(graph)` – validation: requirement loops are rejected.
- `unobtainable(tree, graph)` – validation: units nobody trains, buildings nobody can place or upgrade into, or anything
  whose prerequisites can never be met.
- `toMermaid(tree, graph, highlight?)` – diagram source; `bun run tree:graph [ref]` prints it.

A ref is `unit:<id>`, `building:<id>` or `tech:<id>`. `client/src/ui/tree/TechTreeGraph.tsx` renders this
graph for both the editor and the in-game screen; the engine keeps it pure so the client can show it from
the tree it already receives in `welcome`.

## Walkthroughs

### Add a unit: the archer

1. In the editor, Units → **+**. Set id `archer`, name, cost `{ wheat: 20, lumber: 15 }`, time 12, hp 40,
   speed 2.8, damage 6, range 5, attackTime 1.2, aggro 7, upkeep `{ wheat: 1 }`, abilities `attack`,
   visual helmet on. The problems bar says `unit:archer: unobtainable`.
2. Drag from the Barracks to the Archer and choose **trains**. Optionally drag from Ironworking to the
   Archer for an explicit requirement. The problem disappears.
3. Save. `bun test`, then play-test in two tabs. Done: no engine or client code touched.

By hand: add the object to `units.json`, add `"archer"` to the barracks' `trains`, `bun run validate:content`.

### Add a building: the tower

The default ruleset has one: `tower` in `buildings.json` with an `attack` block. The behaviour behind it
is `engine/src/systems/towers.ts`, added exactly as ARCHITECTURE.md describes: an optional field on
`BuildingDef` and `BuildingSchema`, a system that finds targets like `combat.ts` does, registered in
`systems/index.ts`, tested in `game.test.ts`. Anything you want that the tree can't express follows the
same path, and is data again for everyone after you.

### Add a resource: stone

Also already in the default ruleset. The recipe: a resource, a node with a `deposit` spawn for it, at least
two or three things that cost it (otherwise it is a chore, not a choice), `stone: 0` in
`rules.startResources` (optional; missing means 0). The HUD, minimap, renderer and tree pick it up from the
tree.

### Gate something behind a building

`requires: [{ type: 'building', id: 'library' }]` on a unit, building or tech means the player must own a
completed library. Use it for "you need a Blacksmith before Steel Weapons" style rules without inventing a
placeholder tech. In the editor: drag from the building to the thing and choose **requires**.

### Tune balance

Edit numbers in the editor, watch the "From scratch" line and the problems bar, save, play. Keep a note of
what you changed and why in the entity's `notes` and in the PR; PLAN.md tracks the reasoning behind bigger
shifts.
