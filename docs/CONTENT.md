# Content: the tech tree

Everything the game knows about resources, nodes, units, buildings and technologies is data in
`packages/content/default/`. Change the data, change the game. The engine only understands the generic
concepts described here.

```bash
bun run validate:content                    # validate the default ruleset
bun run tree:graph                          # whole tree as a Mermaid diagram
bun run tree:graph unit:soldier             # what leads to the soldier, in order
bun packages/content/src/validate.ts <dir>  # validate a JSON ruleset directory
TREE_DIR=<dir> bun run dev:server           # play a JSON ruleset
```

The validator checks the schema (unknown fields are errors, so typos fail fast), every cross-reference,
and the dependency graph: no cycles, and everything must be obtainable from the starting position. CI runs
it. Tests in `content/src/content.test.ts` add sanity checks such as "every resource can be obtained".

## Where the types live

| | |
|-|-|
| `engine/src/content.ts` | The interfaces. `EntityDef` → `ResourceDef`, `NodeDef`, `ProducibleDef` → `UnitDef`, `BuildingDef`, `TechDef`. This is the source of truth. |
| `engine/src/tree.ts` | zod schemas with defaults, asserted at compile time to produce exactly those interfaces. Exports the `*Input` types authors write against. |
| `packages/content/default/*.ts` | The default ruleset, typed with `UnitDefInput[]` etc. so the editor checks and autocompletes fields. |
| `engine/src/techgraph.ts` | The dependency graph derived from a tree: `buildGraph`, `prerequisites`, `findCycle`, `unobtainable`, `toMermaid`. |

The hierarchy exists so code can be written against the general shape: anything `ProducibleDef` has a
`cost`, a `time` and `requires`, so affordability, unlock checks and the tech graph work the same way for
units, buildings and techs.

## Files

| File | Exports |
|------|---------|
| `rules.ts` | `name`, `version`, `rules`, `start` |
| `resources.ts` | `resources: ResourceDefInput[]` |
| `nodes.ts` | `nodes: NodeDefInput[]` |
| `units.ts` | `units: UnitDefInput[]` |
| `buildings.ts` | `buildings: BuildingDefInput[]` |
| `techs.ts` | `techs: TechDefInput[]` |

JSON rulesets use the same six names with `.json` and the same shapes. Ids are lowercase `snake_case`,
unique within their file. Colors are `#rrggbb`. Times are seconds, distances tiles, rates multipliers.

## Field reference

Fields shared by every unit, building and tech (`ProducibleDef`):

| Field | Default | Meaning |
|-------|---------|---------|
| `id`, `name` | required | |
| `desc` | `''` | HUD text |
| `cost` | `{}` | `{ resourceId: amount }` paid when queued or placed |
| `time` | required | Seconds to train / build (per builder) / research |
| `requires` | `[]` | Prerequisites, see below |

### requires

A list of requirements that must all hold before the thing can be trained, placed or queued:

```ts
requires: [
  { type: 'tech', id: 'ironworking' },   // the player has researched it
  { type: 'building', id: 'library' },   // the player owns a completed one
]
```

Being trained by a building or researched at one is an implicit requirement and does not need listing.
The HUD shows the first missing requirement on the disabled button; the engine rejects the command with
the same message. Requirements feed the tech graph (below), so listing them explicitly is worth it even
when they are implied, because it makes the item's own card honest in a tree view.

### rules

| Field | Default | Meaning |
|-------|---------|---------|
| `tickRate` | 10 | Simulation steps per second |
| `map.width`, `map.height` | required | Tiles (16–256) |
| `startResources` | required | `{ resourceId: amount }` every player starts with |
| `maxQueue` | 5 | Max items in a building's train/research queue |
| `separationDist` | 0.6 | Units closer than this push each other apart (0 disables) |
| `startClearRadius` | 4 | Nodes within this radius of a start building are removed |
| `upkeepInterval` | 60 | Seconds between upkeep payments |
| `playerColors` | required | Array of colors assigned in join order |

### start

| Field | Meaning |
|-------|---------|
| `building` | Building id placed for each new player. Must be a `dropOff`. Usually `buildable: false`. |
| `units` | `[{ type, count }]` spawned next to it |

### resources

| Field | Default | Meaning |
|-------|---------|---------|
| `id`, `name` | required | |
| `desc` | `''` | |
| `icon` | `''` | Shown in the HUD (an emoji works) |

### nodes

| Field | Default | Meaning |
|-------|---------|---------|
| `id`, `name`, `desc` | | |
| `resource` | required | Resource id gathered from it |
| `amount` | required | Total per node; the node disappears at 0 |
| `gatherTime` | required | Seconds per load |
| `gatherAmount` | required | Resources per load |
| `spawn` | required | `{ kind: 'forest', clustersPer1000Tiles, radius: [min,max] }` blobs, or `{ kind: 'deposit', depositsPer1000Tiles, size: [min,max] }` small clumps |
| `visual` | required | `{ shape: 'cone' \| 'rock', color }` |

### units

| Field | Default | Meaning |
|-------|---------|---------|
| shared | | `id`, `name`, `desc`, `cost`, `time`, `requires` |
| `hp`, `speed` | required | Speed in tiles/second |
| `damage` | 0 | Per hit |
| `range` | 1 | Tiles |
| `attackTime` | 1 | Seconds between hits |
| `aggro` | 0 | Auto-attack enemies within this radius when idle or attack-moving (0 = never) |
| `vision` | 6 | Fog-of-war sight radius |
| `pop` | 1 | Population used |
| `upkeep` | `{}` | `{ resourceId: amount }` paid every `rules.upkeepInterval` seconds while alive |
| `abilities` | `[]` | Any of `harvest`, `build`, `attack`. Decides which commands apply and which buttons show. |
| `visual` | `{}` | `{ width: 0.4, height: 1, helmet: false }`, body in player color |

Upkeep is summed per player and charged in one go. When a player can't pay, the resource bottoms out at 0
and they get a message. What else happens to starving units is an open balance decision (PLAN.md).

### buildings

| Field | Default | Meaning |
|-------|---------|---------|
| shared | | `id`, `name`, `desc`, `cost`, `time`, `requires` |
| `buildable` | true | `false` for things only placed by `start` |
| `hp` | required | |
| `size` | required | `{ w, h }` in tiles |
| `pop` | 0 | Population capacity granted when complete |
| `trains` | `[]` | Unit ids |
| `researches` | `[]` | Tech ids |
| `dropOff` | false | Harvesters deliver here |
| `produces` | – | `{ resource, amount, interval }` passive income while complete |
| `vision` | 6 | |
| `hotkey` | – | Single letter for build mode. Must be unique. Avoid `A`, `S`, `W`, `D`, `X` (camera/commands). |
| `visual` | required | `{ shape: 'box' \| 'cone', color, height, glow? }`. `glow` adds emissive color and a point light. |

### techs

| Field | Default | Meaning |
|-------|---------|---------|
| shared | | `id`, `name`, `desc`, `cost`, `time`, `requires` |
| `effects` | `[]` | See below. A tech with no effects is still useful as a requirement gate. |

A tech must appear in some building's `researches`, or the validator reports it as unobtainable.

### effects

All effects multiply. Filters are optional; omit them to affect everything of that kind.

| `type` | Filter | Applies to |
|--------|--------|-----------|
| `gatherRate` | `resource` | Gathering speed of that resource |
| `produceRate` | `building` | `produces` interval of that building |
| `damage` | `unit` | Damage per hit |
| `maxHp` | `unit` | Max HP (new units; existing keep current HP) |
| `speed` | `unit` | Movement speed |
| `buildSpeed` | – | Construction speed of all builders |

Example: `{ type: 'damage', unit: 'soldier', multiplier: 1.5 }`.

Need a new effect? Add it to `Effect` in `engine/src/content.ts` and `EffectSchema` in `tree.ts`, apply
it in the relevant system via a helper in `engine/src/queries.ts`, add a test, and document it here.

## The tech graph

`buildGraph(tree)` turns a ruleset into a directed graph. Nodes are units, buildings and techs; an edge
A → B means A must exist before B: a building `trains` a unit or `researches` a tech, or A is in B's
`requires`. On top of it:

- `prerequisites(tree, ref)` – everything needed for `ref`, in an order you could obtain them in.
- `findCycle(graph)` – validation: requirement loops are rejected.
- `unobtainable(tree, graph)` – validation: units nobody trains, techs nobody researches, or anything
  whose prerequisites can never be met.
- `toMermaid(tree, graph, highlight?)` – diagram source; `bun run tree:graph [ref]` prints it.

A ref is `unit:<id>`, `building:<id>` or `tech:<id>`. This is the data a Civilization-style tree screen
renders and what a "focus on defence" or "rush a strong unit" planner would search. The engine keeps it
pure so the client can show it from the tree it already receives in `welcome`.

## Walkthroughs

### Add a unit: the archer

1. `units.ts`: add
   ```ts
   {
     id: 'archer', name: 'Archer', desc: 'Shoots from a distance.',
     cost: { wheat: 20, lumber: 15 }, time: 12,
     requires: [{ type: 'tech', id: 'ironworking' }],
     hp: 40, speed: 2.8, damage: 6, range: 5, attackTime: 1.2, aggro: 7,
     upkeep: { wheat: 1 },
     abilities: ['attack'], visual: { width: 0.4, height: 1.1, helmet: true },
   }
   ```
2. `buildings.ts`: add `'archer'` to the barracks' `trains`.
3. `bun run validate:content`, then `bun test`, then `bun run tree:graph unit:archer` to see its path.
4. Play-test in two tabs. Done: no engine or client code touched.

### Add a building: the tower

1. `buildings.ts`: add a 1×1 building with `hp`, `cost`, `time`, `hotkey: 'T'`, `visual`, `vision: 10`.
2. Want it to shoot? That is behaviour the tree can't express yet. Add an optional `attack` block to
   `BuildingDef` and `BuildingSchema` (`{ damage, range, attackTime }`), a `systems/towers.ts` that finds
   targets like `combat.ts` does, register it in `systems/index.ts`, test it, document the field above.
   Then the tower is data again for everyone after you.

### Add a resource: stone

1. `resources.ts`: add `{ id: 'stone', name: 'Stone', icon: '🪨' }`.
2. `nodes.ts`: add a `stone_rock` node with a `deposit` spawn and `resource: 'stone'`.
3. Use it in some `cost`. Add `stone: 0` to `rules.startResources` (optional; missing means 0).
4. Validate. The HUD, minimap and renderer pick it up from the tree.

### Gate something behind a building

`requires: [{ type: 'building', id: 'library' }]` on a unit, building or tech means the player must own a
completed library. Use it for "you need a Blacksmith before Steel Weapons" style rules without inventing a
placeholder tech.

### Tune balance

Edit numbers, validate, play. Keep a note of what you changed and why in the PR; PLAN.md tracks the
reasoning behind bigger shifts.
