# Odal — Design & Plan

_Last updated: 2026-09-04_

## Vision

A classic harvest → build → research → fight RTS in the style of Warcraft II: The Tides of Darkness (1995),
but running in the browser with real multiplayer. Medieval setting. **Simplicity is the core value**: few
resources, few units, few buildings, rules you can explain in a minute.

Long-term: proper 3D models and a polished look. Short-term: colored primitives so we can iterate on
gameplay first.

## Core loop

1. Workers harvest resources from the map and carry them back to the campfire.
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

Start: 60 lumber, 0 stone, 0 iron, 20 gold, 40 wheat. One campfire, one worker.

Why stone (decided 2026-09-04): lumber, wheat and to a degree gold are mandatory, so they create no
decision. Stone is the first resource a player can choose to ignore. That choice, and the worker
allocation it implies, is the depth gathering was missing. The condition is that stone has enough sinks to
be a strategy rather than a chore: wall, gate, watchtower and Masonry at launch.

### Buildings

| Building   | Cost                | Size | Effect                                                                 | Requires    |
| ---------- | ------------------- | ---- | ---------------------------------------------------------------------- | ----------- |
| Campfire   | —                   | 1×1  | Start building. Drop-off point. Trains workers. +5 pop. Not buildable. | —           |
| House      | 25 lumber           | 1×1  | +5 population cap.                                                     | —           |
| Farm       | 20 lumber           | 2×2  | +4 wheat every 8 s.                                                    | —           |
| Library    | 40 lumber, 10 gold  | 2×2  | Research.                                                              | —           |
| Barracks   | 50 lumber, 20 iron  | 2×2  | Trains soldiers.                                                       | Ironworking |
| Wall       | 10 stone            | 1×1  | Blocks everyone. 250 HP.                                               | —           |
| Gate       | 15 stone, 10 lumber | 1×1  | Wall segment the owner's units walk through. 300 HP.                   | Masonry     |
| Watchtower | 40 stone, 20 lumber | 1×1  | Vision 11, shoots 6 damage every 1.5 s within 6 tiles. 400 HP.         | Masonry     |

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

64×64 tiles from a seed: forest blobs, stone, iron and gold deposits, densities per node type in
`nodes.json`. Each new player is placed as far as possible from existing campfires and the area around
their campfire is cleared. Trees, rocks and buildings block movement; units path around them (A*,
8-directional). Gates are open for their owner's units only. Units push each other apart but don't block.

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
| Campfire                   | Glowing orange cone with a point light               |
| House / Library / Barracks | Brown / purple / dark red box                        |
| Wall / Gate / Watchtower   | Gray block / dark wooden block / tall light-gray box |
| Farm                       | Flat wheat-colored slab                              |
| Ownership                  | Colored plate under every building                   |
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
- [ ] Win condition: destroy all enemy campfires
- [ ] Balance pass with real opponents, using the editor

### Playtest feedback 2026-09-05 (first real match, one player vs an empty base)

- [x] **Idle units must not pick fights with buildings.** A scouting soldier razed a whole base without an
      order. Now: idle units engage enemy _units_ within their aggro radius, are leashed to 1.5× that radius,
      and walk back to their post; only attack-move and explicit orders target buildings (`systems/combat.ts`).
- [x] **Tech tree is the research screen.** Available techs have a Research button in the tree (queued at the
      least busy own building that can), Library actions include "Tech tree (Tab)".
- [x] **Select resource nodes.** Left-click shows type, remaining amount and yield per trip.
- [x] **Fair resource placement.** `rules.map.starts` slots on a ring around the centre; every slot gets each
      node type's `spawn.perStart` within `rules.homeRadius`; `zone: 'centre'` keeps the contested gold in the
      middle. Players take the free slot farthest from everyone. Mirrored maps are the next step if this is
      not fair enough.
- [x] **Larger map**: 96×96.
- [x] **Controls overview** in game (F1 / ?), building hotkeys read from the tree.
- [ ] **Camera:** edge scrolling, follow selected unit, jump to last event. Deferred to the graphics milestone.
- [ ] **Map rotation** (Q/E in 90° steps, or free orbit). Deferred to the graphics milestone.

### M3 — Looks

- [ ] Replace primitives with low-poly models (Blender / Meshy pipeline); `visual` blocks grow a `model` field
- [ ] Terrain texture, water/cliffs as impassable terrain
- [ ] Animations (walk, chop, attack), sound
- [ ] Flashier start screen, in-game help, settings dialog (all React)

### Ops

- [x] Dockerfile + image at registry.berge.tech/lab/odal (2026-09-04); stack + Cloudflare tunnel still to be set up
- [ ] Delta snapshots or binary encoding if bandwidth becomes an issue
- [ ] Multiple rulesets selectable per room (the loader and editor already take any directory)

## Open questions

- Hexagonal tiles? Raised after the first playtest. Touches grid, pathfinding, building footprints (rect
  w×h today), rendering and the editor; only worth it with a gameplay reason (e.g. no diagonal cheese).

- Population is a hard cap and wheat is consumed as upkeep (both, as of 2026-09-04). Still undecided: what
  happens when a player cannot pay upkeep. Options: units lose HP, units stop fighting, production halts.
  Decide with real opponents.
- Towers use raw `attack.damage`; should a tech be able to buff them? Add a `buildingDamage` effect when
  there is a reason.
- Player elimination: campfire destroyed = out? Or allow rebuilding? Decide with the win condition in M2.
- Persistence: is a game ever saved, or is every server restart a fresh map? Fresh for now.
- Same-name reconnect is convenient but lets anyone claim an unattended village. Fine among friends; a
  token per session before any public deployment.
