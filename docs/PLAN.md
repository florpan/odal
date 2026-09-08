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

Start: 80 lumber, 0 stone, 0 iron, 20 gold, 40 wheat. One town hall, one worker.

Why stone (decided 2026-09-04): lumber, wheat and to a degree gold are mandatory, so they create no
decision. Stone is the first resource a player can choose to ignore. That choice, and the worker
allocation it implies, is the depth gathering was missing. The condition is that stone has enough sinks to
be a strategy rather than a chore: wall, gate, watchtower and Masonry at launch.

### Buildings

Every building occupies one hex (ADR 0008: board-game scale, a tile represents what is on it). Tree
decided 2026-09-08 from the Hexagon pack's contact sheets. Research happens at the town hall (no library);
harvested goods go to the building that takes them (`accepts`), never to the town hall.

| Building                       | Cost                           | Effect                                                                       | Requires       |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------- | -------------- |
| Town hall                      | —                              | Start. Trains workers, directs research (Select research). +5 pop. → Castle  | —              |
| Castle                         | 150 stone, 100 lumber, 50 gold | Upgrade of the town hall, 60 s. +10 pop, trains workers and knights, 1200 HP | Feudalism      |
| House                          | 25 lumber                      | +5 population cap.                                                           | —              |
| Windmill                       | 20 lumber                      | +4 wheat every 8 s.                                                          | —              |
| Grain field                    | 10 lumber                      | +2 wheat every 8 s.                                                          | —              |
| Lumber mill                    | 30 lumber                      | Takes lumber. First building of every game.                                  | —              |
| Quarry / Iron mine / Gold mine | 40 lumber                      | Take stone / iron / gold (same pack model for now).                          | Mining         |
| Barracks                       | 50 lumber                      | Trains soldiers.                                                             | House          |
| Blacksmith                     | 40 lumber, 10 iron             | Steel weapons and chainmail need one.                                        | Ironworking    |
| Archery range                  | 40 lumber                      | Trains archers. Longbows need one.                                           | Fletching      |
| Church                         | 50 lumber, 20 gold             | Rites need one.                                                              | Faith          |
| Shrine                         | 40 lumber, 20 stone, 20 gold   | One per player. The three blessings need one.                                | Rites          |
| Market                         | 40 lumber, 10 gold             | +2 gold every 10 s. Trade routes need one.                                   | Trade          |
| Workshop                       | 60 lumber, 20 iron             | Lets towers mount a catapult. Gunpowder needs one.                           | Engineering    |
| Tower                          | 40 stone, 20 lumber            | Shoots 6 / 1.5 s within 6. → Stone tower → Catapult tower → Cannon tower     | Masonry        |
| Stone tower                    | 40 stone, 10 iron              | Upgrade, 20 s. 9 / 1.5 s within 7, 400 HP.                                   | Fortification  |
| Catapult tower                 | 40 stone, 40 lumber            | Upgrade, 25 s. 20 / 3 s within 8, 450 HP.                                    | Workshop built |
| Cannon tower                   | 60 stone, 40 iron, 20 gold     | Upgrade, 30 s. 35 / 3.5 s within 9, 500 HP.                                  | Gunpowder      |
| Watchtower                     | 15 lumber                      | Unarmed, sees 12 hexes. 80 HP.                                               | —              |
| Wall / Wall corner             | 10 stone                       | Blocks everyone. 250 HP. The corner is rotated to fit (Q).                   | Masonry        |
| Gate                           | 15 stone, 10 lumber            | Wall segment the owner's units walk through. 300 HP.                         | Masonry        |

Skipped for now (models converted, no role): cottage, stables, tavern, tent, watermill, well, docks,
shipyard, fences, bridge, ruin, scaffolding, stages, projectile.

### Units

| Unit    | Cost                        | HP  | Speed | Damage | Range | Trained at    | Abilities                           |
| ------- | --------------------------- | --- | ----- | ------ | ----- | ------------- | ----------------------------------- |
| Worker  | 20 wheat                    | 30  | 1.5   | 2      | 1     | Town hall     | harvest, build, attack              |
| Soldier | 20 wheat, 15 iron           | 60  | 1.3   | 8      | 1.2   | Barracks      | attack, auto-engages within 6 tiles |
| Archer  | 20 wheat, 10 lumber, 5 iron | 40  | 1.4   | 6      | 4     | Archery range | attack (no projectile yet)          |
| Knight  | 30 wheat, 40 iron, 20 gold  | 130 | 1.6   | 14     | 1.2   | Castle        | attack, eats 2 wheat                |

Speeds halved 2026-09-08: the old values were tuned when a person was a full hex tall.

### Research

Research belongs to the community, not to a building (decided 2026-09-08): the tech tree shows every
tech, the player queues what to research next (`rules.maxQueue` deep, one in progress), and a tech that
needs a building says so in its `requires`, the way a society needs a factory before it thinks of
machines. The town hall (and the castle) carries the "Select research" button; the top bar shows what is
in progress.

Civic chain: Mining (30 lumber) → Ironworking (20 gold, 10 iron) and Masonry (20 gold, 20 stone);
Fletching (40 lumber, 10 gold; needs a barracks); Faith (30 gold); Trade (20 gold, 30 lumber);
Engineering (40 gold, 20 iron; needs a blacksmith); Fortification (40 gold, 40 stone; after Masonry;
buildings finished afterwards ×1.25 HP); Feudalism (100 gold, 60 stone, 40 iron; after Fortification and
Engineering, with a church) → the castle.

Needing a building: Sharpened Axes (lumber mill; lumber ×1.5), Crop Rotation (windmill; farm ×1.5), Steel
Weapons (blacksmith; soldier ×1.5, knight ×1.25) and Chainmail (blacksmith; soldier HP ×1.3), Longbows
(archery range; archer ×1.5), Rites (church → shrine), Gunpowder (workshop → cannon tower), Trade Routes
(market ×1.5), and with a shrine the blessings of the Harvest (all gathering ×1.2), of Arms (all damage
×1.15) and of Stone (buildings ×1.2 HP).

### Map

A hex grid (`rules.map`, 112×112 hexes by default) from a seed: an island cut from domain-warped noise
(bays, fjords, peninsulas; 40% of the map is land) with impassable water around it (terrain is data,
`terrain.json`), forest blobs, stone, iron and gold deposits,
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
- [ ] **Map rotation** (Q/E in 90° steps, or free orbit). Now part of M4 (free orbit by right-drag).

### M2 content plan: buildings from the Hexagon pack

Decided 2026-09-08 from the pack's contact sheets (`tools/models/kaykit_sheet.py`); the tables under
"The rules are data" above are the result. Engine additions that made it expressible: `upgrades`
(town hall → castle, the tower line), `accepts` (per-resource drop-offs), `limit` (one shrine), and the
`upgrade` command (protocol 9). Still to come for the tree: a wall tool that lays runs and picks
corners; scaffolding and ruin stages as looks; the Resource Bits stacks next to a mine to show its kind;
healer or mage from the church; siege units; projectiles for archers and towers; road and river tiles
only if road and river rules ever exist. Units in the plan (worker with tools, soldier with sword and
shield, archer, knight) come from the Adventurers characters plus hand props and the shared animation
set; only the worker has a model.

### M3 — Looks

- [ ] Replace primitives with low-poly models. **State on 2026-09-06 (evening):**
  - Data: `visual.model` on units and buildings, `visual.models` + `scale` on nodes (CONTENT.md). Anything
    missing falls back to the primitives, so the repo is playable without any GLB.
  - Renderer: `render/models.ts` loads once, clones skinned models with their skeleton, "Team" material in the
    owner colour, clips by task name (idle, walk, chop, mine, build, attack; hit and death reserved), units face
    their movement, buildings grow during construction, `{team}` picks the nearest KayKit colour variant.
  - Assets (CC0 KayKit, packs on Christer's machine in `C:\Dev\KayKit`, licence note in
    `client/public/models`): worker = Rogue with eight clips (`tools/models/kaykit_character.py`); every
    building, the ground tiles, coast, forests, rocks, hills and mountains come from the Medieval Hexagon
    EXTRA pack (`kaykit_prop.py` DEFAULT_JOBS and `kaykit_compose.py`); the four Forest Nature trees are
    still converted but unused. The Blender scripts run headless with
    `"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b -P <script>` (the MCP is optional).
  - Scale convention: one factor per pack family. The whole Hexagon pack (tiles, buildings, decorations)
    is at `scale:0.5`, so a pack tile is one hex and a house is half a hex, a castle a whole one.
    Characters are exported 1 unit tall and sized by `visual.height`: **decided 2026-09-07: a person is
    0.3 hex** (Warcraft II proportions: half a house, a third of the town hall; the pack's own figure is
    0.17, too small to click). Buildings stay one hex each (`size.radius` exists per building if a castle
    ever needs seven). Units are free agents inside the hex grid: continuous positions, separation 0.35,
    and a work stance (`movement.ts` `stance`) that moves a working unit from its hex centre to the edge
    facing its tree, wall or target. Selection ring, HP bar and carried load scale with `visual.width`.
    Still to do for the small character: path smoothing (string pulling) so walks are straight lines
    rather than centre-to-centre hops.
  - Colours: the exports carry the Hexagon pack's **Summer** atlas (`kaykit_prop.ATLAS`, chosen 2026-09-07;
    `remap_palette` is kept as a tool, no longer called: the grass nudge tried on 2026-09-06 made the whole
    board lime). The renderer uses AgX tone mapping, Blender's default view transform, so the pack reads as
    it does in Blender instead of clipping to saturated lime and red under the 1.4 sun + 0.9 hemisphere.
    The four atlases also live in `client/public/models/atlas/`; `?atlas=default|fall|winter` on the game
    or the model viewer swaps them in at load (`render/models.ts`, materials named `hexagons_medieval`).
    Sun light is neutral white so colour lives in the models. Shadows: one 2048 PCF shadow map on the sun,
    following the camera target with an extent tied to the zoom. `kaykit_compose.py` builds whole-tile
    terrains. Water: the pack's water surface is 0.1 below a tile top in both the water and the coast
    tiles, so the water terrain has no extra `visual.height` offset.
  - Tooling: `tools/models/glb.ts` + `worker.ts` (procedural labourer, `bun run model:worker`, kept as a
    reference), `inspect.ts` (what is in a GLB), `models.html` viewer (`?m=file.glb`, plays clips),
    `kaykit_sheet.py` (contact sheets of every pack folder as PNG + .blend in `C:\Dev\KayKit\sheets`, for
    choosing tiles and decorations without importing them one by one).
  - Done 2026-09-06: hex grid, island terrain, ground tiles, relief, decorations, palette nudge, all pack
    buildings in (12 real, 21 cheap test ones, see the M2 content plan), pack walls and gate, ownership
    plate dropped under modelled buildings.
  - **Next:** path smoothing; tools in the worker's hands per clip (axe / pickaxe / hammer on the
    hand slot); Knight with sword and shield as the soldier; walls turned to face their neighbours (same
    trick as the coast tiles); an upgrade-in-place command for the tower line; construction scaffolding and
    ruin stages from the pack; one shared texture per pack instead of a copy in every GLB (files are
    100–360 KB each); the four-colour conversion of test buildings once they get a role.
- [x] Terrain layer: `terrain.json`, island with water as the natural border, unexplored hexes hidden (2026-09-06)
- [x] KayKit hex tiles as ground: grass, water, coast A–D picked by consecutive water edges and turned
      towards the sea (2026-09-06). Flat coloured pucks remain the fallback without the GLBs.
- [x] Per-hex stepped height from seeded noise (`rules.map.relief`), everything on a hex rises with it (2026-09-06)
- [x] Hexagon-pack decorations tried (2026-09-06): forest clusters as tree nodes, pack rocks as stone (scale 3), hills and
      mountains composed onto a grass tile as terrains scattered by `rules.map.features`. Verdict pending Christer.
- [ ] The pack's sloped tiles on the steps, cliffs as terrain that costs more to climb (a `findPath` parameter)
- [ ] Animations (walk, chop, attack), sound
- [x] Buildings rotate (2026-09-07): `Building.rot` in sixths of a turn, `rotate` command (protocol 8), Q / Shift+Q or the
      action button, any time after placement. Cosmetic only: footprints are hexes, so no rule depends on facing.
- [x] Chrome matches the pack (2026-09-08): every HUD, screen and editor colour is a custom property in `ui/theme.css`
      sampled from the Summer atlas (slate stone, terracotta wood, linen text, gold accent); Grenze for titles and
      Alegreya Sans for text, self-hosted in `client/public/fonts`. Fog is the same slate as the minimap's unexplored
      and the scene background, sampled by every material at its world position (`render/fow.ts`; a sheet above the
      board sat a hex or two off from the game camera), at 4 texels per world unit, blurred on the CPU, with two rings of "fringe" tiles drawn
      beyond the explored ones (deeper than the blur's reach) so the ground vanishes into fog instead of ending at a
      hex edge. Selection ring, build
      ghost and health bars use the same palette, not tone mapped. Next: a skybox instead of the flat background.
- [x] HUD as a selection card (2026-09-08): what is selected and its actions in one floating card (a bottom
      sheet on phones), a minimap in the corner behind a Map toggle, nothing spanning the bottom.
- [x] Touch controls (2026-09-07): tap selects, a held finger is the right click, one-finger drag pans, pinch
      zooms; on coarse pointers or short windows the bottom HUD is a one-line strip that opens on tap and closes
      after an action (`ui/screens/GameScreen.tsx` COMPACT_QUERY, `game/input.ts`). Box select has no touch form.
- [ ] Flashier start screen, in-game help, settings dialog (all React)

### M4 — Hidden geography (designed 2026-09-09, not started)

**Why.** Christer wants exploration to matter: you should not know where you are on the map, nor where the
others are, until you have scouted. Today three things give it away: the island is a blob around one
centre, starts sit on a ring around that centre with the contested gold in the middle, and the minimap is a
chart of the whole world, so the fog's frame tells you which corner you are in.

- [x] **Irregular island** (2026-09-09). Coast from domain-warped fractal noise (`noise.ts fractalNoise`) cut
      at a quantile so `island.land` of the map is land, with a bias of about one noise deviation towards
      the edge and a wandering sea band; islets go under, lakes fill, the cut is loosened until one landmass
      holds the target. Bays, fjords, peninsulas; 112×112 map at 40% land keeps the old land area.
      Elevation is a _separate_ noise so height does not point at the centre (the tank-game lesson: a
      falloff on elevation makes a volcano you can walk up). Three levels at `HEIGHT_STEP` 0.4; land
      neighbours still differ by one step but the coast keeps its height: beach tiles only at level 0,
      higher land meets the sea as a cliff on a rock plinth (`scene.ts`). Start slots still sit on a ring
      (next item). Tuning: `bun tools/map/preview.ts [seeds] --shape --land F --scale N --size N`; in
      game, `?fog=0` shows the whole map.
- [x] **Random starts** (2026-09-09). Slots anywhere on land where most of `homeRadius` around is land (the
      sea itself is fine), picked farthest-point with some randomness among sampled candidates, at least
      `rules.map.startSpacing` (30) apart when the land allows. Each start keeps `perStart` guarantees for every
      node type. `zone: 'centre'` became `zone: 'contested'`: the land farthest from every start (top quarter of
      that distance, outside every home zone), successive spots kept apart, so contested gold lies between the
      players wherever they are; with two players that may well be the coast.
- [x] **Radar minimap** (2026-09-09). A fixed-scale window (`RADAR_SPAN` 44 hexes across) centred on the
      camera, not a chart of the world; unexplored and beyond-the-map are the same slate. The camera square
      stays as a zoom indicator (it will rotate with the map, so it reveals nothing else). A flag marks the town
      hall; when it is outside the window the flag sits on the rim with a chevron pointing home. Attack alerts
      on the rim later. Everything is drawn through one world-to-canvas function, ready for a camera yaw.
- [ ] **The map as research.** Cartography (late tier) reveals the whole map's terrain; Geography reveals
      resource nodes. Needs a `reveal` effect and a split of "explored" into terrain-known and nodes-known on
      the server (`vision.ts`, `visibility.ts`) since one bit currently shows both. An Intel tech that reveals
      enemy positions was considered and parked: too strong early, pointless late.
- [ ] **Camera rotation and tilt.** Right-drag: left/right yaws, up/down tilts (a right _click_ stays the
      command; movement past the tap slop makes it a drag). Touch: two fingers left/right yaw, up/down tilt,
      pinch still zooms, one finger pans. Renderer: the camera offset becomes a yaw/pitch around the target;
      keyboard and edge panning rotate the input vector by the yaw; the minimap draws with the same rotation
      and inverts it for clicks. Key bindings: pick something, they will be revisited.

Order: island first (it changes how the other two feel), then starts and contested placement, then the radar,
then rotation, then the research items.

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
