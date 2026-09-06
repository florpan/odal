# Odal — Design & Plan

_Last updated: 2026-09-04_

## Vision

A classic harvest → build → research → fight RTS in the style of Warcraft II: The Tides of Darkness (1995),
but running in the browser with real multiplayer. Medieval setting. **Simplicity is the core value**: few
resources, few units, few buildings, rules you can explain in a minute.

Long-term: proper 3D models and a polished look. Short-term: colored primitives so we can iterate on
gameplay first.

## Core loop

1. Workers harvest resources from the map and carry them back to the town hall.
2. Resources pay for buildings; workers construct them.
3. Buildings unlock production (units) and research (technology).
4. Research unlocks better buildings and improvements; buildings unlock units and research in turn.
5. Soldiers fight other players' units and buildings.

The two things the old game lacked were gathering and research. Both get their depth from the same place:
**choices about where workers go and what to unlock first**, made visible in the tech tree.

## The rules are data

Everything below is the _default ruleset_ in `packages/content/default/`. Change the JSON, change the
game. See [CONTENT.md](CONTENT.md) for the format, the editor and walkthroughs.

### Resources

Five resources, each with a **primary sink**. The sink is a design guideline for authoring costs, not a
rule the engine knows about: mixed costs (a gate is stone and lumber, a research might be gold and
population) are where the interesting trade-offs live. Five is the ceiling; a sixth would need a very good
reason.

| Resource | Source                               | Primary sink         | Notes                                                                                                                              |
| -------- | ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Lumber   | Trees (forest clusters)              | General buildings    | Mandatory every game. Trees disappear when depleted.                                                                               |
| Stone    | Stone outcrops (larger deposits)     | Protective buildings | **Optional.** Quarrying is a visible commitment to defence; a scout seeing your quarry learns something. A bit slower than lumber. |
| Iron     | Iron rocks (small deposits)          | Military units       | Weapons, barracks.                                                                                                                 |
| Gold     | Gold rocks (rarer deposits)          | Research             |                                                                                                                                    |
| Wheat    | **Farms** (built, produce over time) | Unit count           | Every unit costs wheat and soldiers eat wheat as upkeep. Forces you to dedicate space to farming.                                  |

Start: 60 lumber, 0 stone, 0 iron, 20 gold, 40 wheat. One town hall, one worker.

Why stone (decided 2026-09-04): lumber, wheat and to a degree gold are mandatory, so they create no
decision. Stone is the first resource a player can choose to ignore. That choice, and the worker
allocation it implies, is the depth gathering was missing. The condition is that stone has enough sinks to
be a strategy rather than a chore: wall, gate, watchtower and Masonry at launch.

### Buildings

Every building occupies one hex (ADR 0008: board-game scale, a tile represents what is on it).

| Building    | Cost                 | Effect                                                                 | Requires    |
| ----------- | -------------------- | ---------------------------------------------------------------------- | ----------- |
| Town hall   | —                    | Start building. Drop-off point. Trains workers. +5 pop. Not buildable. | —           |
| House       | 25 lumber            | +5 population cap.                                                     | —           |
| Windmill    | 20 lumber            | +4 wheat every 8 s. Researches crop rotation.                          | —           |
| Lumber mill | 40 lumber            | Drop-off, to shorten hauls from the woods.                             | —           |
| Mine        | 40 lumber            | Drop-off, to shorten hauls from the rocks.                             | —           |
| Market      | 40 lumber, 10 gold   | +2 gold every 12 s.                                                    | —           |
| Blacksmith  | 40 lumber, 10 gold   | Researches tools, weapons and masonry.                                 | —           |
| Barracks    | 50 lumber, 20 iron   | Trains soldiers.                                                       | Ironworking |
| Castle      | 120 stone, 80 lumber | +10 pop, trains soldiers, 1200 HP.                                     | Masonry     |
| Wall        | 10 stone             | Blocks everyone. 250 HP.                                               | —           |
| Gate        | 15 stone, 10 lumber  | Wall segment the owner's units walk through. 300 HP.                   | Masonry     |
| Watchtower  | 40 stone, 20 lumber  | Vision 11, shoots 6 damage every 1.5 s within 6 hexes. 400 HP.         | Masonry     |

### Units

| Unit    | Cost              | HP  | Speed | Damage | Abilities                           |
| ------- | ----------------- | --- | ----- | ------ | ----------------------------------- |
| Worker  | 20 wheat          | 30  | 3     | 2      | harvest, build, attack              |
| Soldier | 20 wheat, 15 iron | 60  | 2.6   | 8      | attack, auto-engages within 6 tiles |

### Research (Library)

| Tech           | Cost               | Effect                                                              | Requires    |
| -------------- | ------------------ | ------------------------------------------------------------------- | ----------- |
| Ironworking    | 30 gold            | Unlocks Barracks                                                    | —           |
| Sharpened Axes | 20 gold, 10 iron   | gatherRate lumber ×1.5                                              | —           |
| Crop Rotation  | 20 gold, 20 lumber | produceRate farm ×1.5                                               | —           |
| Steel Weapons  | 40 gold, 30 iron   | damage soldier ×1.5                                                 | Ironworking |
| Masonry        | 30 gold, 20 stone  | Unlocks Gate and Watchtower; buildings finished afterwards ×1.25 HP | —           |

### Map

A hex grid (`rules.map`, 96×96 hexes by default) from a seed: an island with a wandering coastline and
impassable water around it (terrain is data, `terrain.json`), forest blobs, stone, iron and gold deposits,
densities per node type in `nodes.json`. Each new player is placed as far as possible from existing
town halls and the area around their town hall is cleared; every start is guaranteed a path to the centre.
Trees, rocks and buildings block movement; units path around them (hex A*, six neighbours). Gates are open
for their owner's units only. Units push each other apart but don't block.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) and the ADRs in [adr/](adr/). In one line: content → engine ←
server/client, server-authoritative with fog-filtered snapshots, React shell around a framework-free
Three.js game, and a content editor page that shares the tree view with the game.

## Visual language (placeholder primitives, from `visual` blocks in the ruleset)

| Thing                      | Shape                                                |
| -------------------------- | ---------------------------------------------------- |
| Worker                     | Tall box in player color                             |
| Soldier                    | Taller box in player color with a dark "helmet"      |
| Tree                       | Green cone (shrinks as it is harvested)              |
| Stone / iron / gold        | Gray / steel / yellow rock (dodecahedron)            |
| Town hall, other buildings | KayKit Hexagon buildings in the owner's colour       |
| House / Library / Barracks | Brown / purple / dark red box                        |
| Wall / Gate / Watchtower   | Gray block / dark wooden block / tall light-gray box |
| Farm                       | Flat wheat-colored slab                              |
| Ground                     | KayKit hex tiles: grass, water (lower), coast A–D    |
| Ownership                  | Team-coloured models; a plate only under primitives  |
| Under construction         | Building grows in height with progress               |
| Remembered enemy building  | Translucent ghost until seen again                   |

## Roadmap

### M0 — Playable skeleton ✅ (2026-09-04)

Map generation, join with name, harvest all four resources, build all buildings, research, train,
basic combat, multiplayer over WebSocket, minimap, HUD.

### M1 — Feel & fairness ✅ (2026-09-04)

- [x] Fog of war, server-enforced; explored map and remembered enemy buildings
- [x] Units push apart instead of stacking
- [x] In-world HP bars, damage flash, death bursts
- [x] Rally points (with auto-harvest on resources)
- [x] Attack-move (A), control groups (Ctrl+1–9)
- [x] Lobby: rooms, ready-up, late join, reconnect by name, restart
- [ ] Balance pass — deferred until there are real opponents

### M1.5 — Ready for contributors ✅ (2026-09-04)

- [x] Engine split into systems, server split into modules
- [x] Data-driven tech tree with schema, validator and generic effects
- [x] React shell with a single canvas bridge; UI never touches Three
- [x] ESLint boundary rules, Prettier, CI workflow
- [x] Docs: CLAUDE.md entry point, ARCHITECTURE, CONTRIBUTING, CONTENT, ADRs

### M2 — Depth (still simple)

- [x] Requirements on units, buildings and techs (tech, owned building, population); tech graph
- [x] Tech tree screen in the client (Tab), coloured by the player's progress
- [x] **Content editor** (`/editor.html`): graph editing, schema-generated forms, live validation,
      rename-everywhere, save through the dev server (ADR 0007)
- [x] Stone as a fifth resource with real sinks: wall, gate, watchtower, Masonry
- [x] Defensive building (tower): building `attack` field + `systems/towers.ts`
- [x] Walls and gates: `passable` buildings, per-owner blocking grid
- [x] Upkeep: units consume wheat over time. Still open: what starving does.
- [ ] One ranged unit (archer) — content only, see CONTENT.md walkthrough
- [ ] Gathering depth, next candidates: per-resource drop-off buildings (lumber mill, quarry) so distance
      matters; contested deposits placed between players; a second tier of gathering techs
- [ ] Simple AI opponent for solo play and balancing
- [ ] Win condition: destroy all enemy town halls
- [ ] Balance pass with real opponents, using the editor

### Playtest feedback 2026-09-05 (first real match, one player vs an empty base)

- [x] **Idle units must not pick fights with buildings.** A scouting soldier razed a whole base without an
      order. Now: idle units engage enemy _units_ within their aggro radius, are leashed to 1.5× that radius,
      and walk back to their post; only attack-move and explicit orders target buildings (`systems/combat.ts`).
- [x] **Tech tree is the research screen.** Civilization-style sideways timeline: a column per tier, a card
      per tech with chips for everything it unlocks, dashed connectors, progress on the card being researched.
      Available techs have a Research button (queued at the least busy own building that can), locked ones
      show what they still need. Library actions include "Tech tree (Tab)". The editor keeps the free graph.
- [x] **Select resource nodes.** Left-click shows type, remaining amount and yield per trip.
- [x] **Fair resource placement.** `rules.map.starts` slots on a ring around the centre; every slot gets each
      node type's `spawn.perStart` within `rules.homeRadius`; `zone: 'centre'` keeps the contested gold in the
      middle. Players take the free slot farthest from everyone. Mirrored maps are the next step if this is
      not fair enough.
- [x] **Larger map**: 96×96.
- [x] **Controls overview** in game (F1 / ?), building hotkeys read from the tree.
- [ ] **Camera:** edge scrolling, follow selected unit, jump to last event. Deferred to the graphics milestone.
- [ ] **Map rotation** (Q/E in 90° steps, or free orbit). Deferred to the graphics milestone.

### M2 content plan (2026-09-06): buildings from the Hexagon pack

The tree is built around what the KayKit Hexagon packs actually contain, so nothing is a placeholder.
Ids stay stable where a building only changed its look (`farm` is the windmill, `library` the blacksmith).

| Pack model                                            | Building       | Status                                                                                                                           |
| ----------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| townhall                                              | Town hall      | in: start, drop-off, workers                                                                                                     |
| home_A                                                | House          | in                                                                                                                               |
| windmill                                              | Windmill       | in: wheat, crop rotation                                                                                                         |
| lumbermill, mine                                      | drop-offs      | in; later per-resource drop-off and a gather bonus                                                                               |
| market                                                | Market         | in: gold trickle; later trade                                                                                                    |
| blacksmith                                            | Blacksmith     | in: research                                                                                                                     |
| barracks                                              | Barracks       | in                                                                                                                               |
| castle                                                | Castle         | in: late-game pop and soldiers                                                                                                   |
| tower_A / B / catapult / cannon, watchtower           | Tower line     | tower_A in; upgrade-in-place command still to build                                                                              |
| church, shrine                                        | healer, mage   | in as test buildings (5 lumber, 3 s) until healing and mages exist                                                               |
| archeryrange                                          | Archer         | in as test building until ranged exists                                                                                          |
| stables                                               | Scout, speed   | in as test building                                                                                                              |
| workshop                                              | Siege          | in as test building; siege needs damage-by-target                                                                                |
| watermill                                             | Wheat by water | in as test building (needs placement rules to matter)                                                                            |
| well, tavern, tent, docks, shipyard                   | –              | in as test buildings, no role yet                                                                                                |
| wall_straight, gate, corner, fences, bridge (neutral) | walls          | in: wall and gate use the pack pieces; corner, fences and bridge as test buildings. Orienting walls to neighbours is still to do |
| building_grain                                        | Grain field    | in as test building: wheat, cheaper than the windmill                                                                            |
| scaffolding, destroyed                                | stages         | converted, not used: construction and ruin looks later                                                                           |

Test buildings cost 5 lumber and take 3 s so the look can be checked in play; they get real prices when
they get a role. Units in the plan (worker with tools,
soldier with sword and shield, archer, healer, mage, berserker, scout, siege) come from the
Adventurers characters plus hand props and the shared animation set; only the worker and soldier exist.
Model files are 100–360 KB each because every one embeds its own copy of the atlas; sharing one
texture per pack is the fix when size matters.

### M3 — Looks

- [ ] Replace primitives with low-poly models. **State on 2026-09-05:**
  - Data: `visual.model` on units and buildings, `visual.models` + `scale` on nodes (CONTENT.md). Anything
    missing falls back to the primitives, so the repo is playable without any GLB.
  - Renderer: `render/models.ts` loads once, clones skinned models with their skeleton, "Team" material in the
    owner colour, clips by task name (idle, walk, chop, mine, build, attack; hit and death reserved), units face
    their movement, buildings grow during construction, `{team}` picks the nearest KayKit colour variant.
  - Assets (CC0 KayKit, packs on Christer's machine in `C:\Dev\KayKit`, licence note in
    `client/public/models`): worker = Rogue with eight clips (`tools/models/kaykit_character.py`), house =
    home_A in four colours, trees = four Forest Nature C-trees (`tools/models/kaykit_prop.py`). The Blender
    scripts run through the Blender MCP (start "Connect to Claude" in Blender's BlenderMCP sidebar tab first)
    or headless with `blender -b -P`.
  - Scale convention: one factor per pack family. Characters and nature use `CHARACTER_SCALE` (a KayKit
    person = 1 tile); the miniature Hexagon tile set is fitted to our tile by footprint instead. Building
    sizes still to be tuned (a 2×2 barracks should share the house's factor).
  - Colours: `kaykit_prop.py` has a `PALETTE` table that nudges pack swatches at export (the Hexagon grass
    was a lime with red ≈ green; now a touch greener). Sun light is neutral white so colour lives in the models.
    Small steps only, shadows and lighting are still to come. `kaykit_compose.py` builds whole-tile terrains.
  - Tooling: `tools/models/glb.ts` + `worker.ts` (procedural labourer, `bun run model:worker`, kept as a
    reference), `inspect.ts` (what is in a GLB), `models.html` viewer (`?m=file.glb`, plays clips).
  - **Next:** tools in the worker's hands per clip (KayKit axe / pickaxe props on the hand slot), Knight as
    the soldier, remaining buildings from the Hexagon pack, rocks from Resource Bits, one shared texture per
    pack instead of a copy in every GLB, softer shrink-with-amount for tree models.
- [x] Terrain layer: `terrain.json`, island with water as the natural border, unexplored hexes hidden (2026-09-06)
- [x] KayKit hex tiles as ground: grass, water, coast A–D picked by consecutive water edges and turned
      towards the sea (2026-09-06). Flat coloured pucks remain the fallback without the GLBs.
- [x] Per-hex stepped height from seeded noise (`rules.map.relief`), everything on a hex rises with it (2026-09-06)
- [x] Hexagon-pack decorations tried (2026-09-06): forest clusters as tree nodes, pack rocks as stone (scale 3), hills and
      mountains composed onto a grass tile as terrains scattered by `rules.map.features`. Verdict pending Christer.
- [ ] The pack's sloped tiles on the steps, cliffs as terrain that costs more to climb (a `findPath` parameter)
- [ ] Animations (walk, chop, attack), sound
- [ ] Flashier start screen, in-game help, settings dialog (all React)

### Ops

- [x] Dockerfile + image at registry.berge.tech/lab/odal (2026-09-04). Test server: stack `odal` on docker2,
      port 3123, updated with Dockhand (pull_image, then deploy with forceRecreate; the routine is in the
      global Containers skill). Cloudflare tunnel still to be set up.
- [ ] Delta snapshots or binary encoding if bandwidth becomes an issue
- [ ] Multiple rulesets selectable per room (the loader and editor already take any directory)

## Open questions

- ~~Hexagonal tiles?~~ Decided 2026-09-06: hex grid at person scale, board-game look (ADR 0008). Next on
  the map: sloped tiles, and whether height should matter to movement. Terrain layer, island, KayKit ground
  tiles and noise relief landed the same day.
- Pathfinding styles per unit (a dumb heavy hitter that walks straight and needs micro)? Idea from
  2026-09-06, not decided. `pathfinding.ts` is built so this is a parameter on `findPath`, nothing more.

- Population is a hard cap and wheat is consumed as upkeep (both, as of 2026-09-04). Still undecided: what
  happens when a player cannot pay upkeep. Options: units lose HP, units stop fighting, production halts.
  Decide with real opponents.
- Towers use raw `attack.damage`; should a tech be able to buff them? Add a `buildingDamage` effect when
  there is a reason.
- Player elimination: town hall destroyed = out? Or allow rebuilding? Decide with the win condition in M2.
- Persistence: is a game ever saved, or is every server restart a fresh map? Fresh for now.
- Same-name reconnect is convenient but lets anyone claim an unattended village. Fine among friends; a
  token per session before any public deployment. Also: a page reload while the old socket is still open
  joins as a _new_ player instead of reconnecting (seen 2026-09-05 during testing).
