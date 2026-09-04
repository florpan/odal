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
4. Research unlocks better buildings and improvements.
5. Soldiers fight other players' units and buildings.

## The rules are data

Everything below is the *default ruleset* in `packages/content/default/`. Change the JSON, change the
game. See [CONTENT.md](CONTENT.md) for the format and walkthroughs.

### Resources

| Resource | Source | Notes |
|----------|--------|-------|
| Lumber | Trees (forest clusters) | Main building material. Trees disappear when depleted. |
| Iron | Iron rocks (small deposits) | Weapons, barracks. |
| Gold | Gold rocks (rarer deposits) | Research. |
| Wheat | **Farms** (built, produce over time) | Feeds units: every unit costs wheat. Forces you to dedicate space to farming. |

Start: 60 lumber, 0 iron, 20 gold, 40 wheat. One campfire, one worker.

### Buildings

| Building | Cost | Size | Effect | Requires |
|----------|------|------|--------|----------|
| Campfire | — | 1×1 | Start building. Drop-off point. Trains workers. +5 pop. Not buildable. | — |
| House | 25 lumber | 1×1 | +5 population cap. | — |
| Farm | 20 lumber | 2×2 | +4 wheat every 8 s. | — |
| Library | 40 lumber, 10 gold | 2×2 | Research. | — |
| Barracks | 50 lumber, 20 iron | 2×2 | Trains soldiers. | Ironworking |

### Units

| Unit | Cost | HP | Speed | Damage | Abilities |
|------|------|----|-------|--------|-----------|
| Worker | 20 wheat | 30 | 3 | 2 | harvest, build, attack |
| Soldier | 20 wheat, 15 iron | 60 | 2.6 | 8 | attack, auto-engages within 6 tiles |

### Research (Library)

| Tech | Cost | Effect | Requires |
|------|------|--------|----------|
| Ironworking | 30 gold | Unlocks Barracks | — |
| Sharpened Axes | 20 gold, 10 iron | gatherRate lumber ×1.5 | — |
| Crop Rotation | 20 gold, 20 lumber | produceRate farm ×1.5 | — |
| Steel Weapons | 40 gold, 30 iron | damage soldier ×1.5 | Ironworking |

### Map

64×64 tiles from a seed: forest blobs, iron and gold deposits, densities per node type in `nodes.ts`.
Each new player is placed as far as possible from existing campfires and the area around their campfire is
cleared. Trees and rocks block movement; units path around them (A*, 8-directional). Units push each other
apart but don't block.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) and the ADRs in [adr/](adr/). In one line: content → engine ←
server/client, server-authoritative with fog-filtered snapshots, React shell around a framework-free
Three.js game.

## Visual language (placeholder primitives, from `visual` blocks in the ruleset)

| Thing | Shape |
|-------|-------|
| Worker | Tall box in player color |
| Soldier | Taller box in player color with a dark "helmet" |
| Tree | Green cone (shrinks as it is harvested) |
| Iron / gold | Gray / yellow rock (dodecahedron) |
| Campfire | Glowing orange cone with a point light |
| House / Library / Barracks | Brown / purple / dark red box |
| Farm | Flat wheat-colored slab |
| Ownership | Colored plate under every building |
| Under construction | Building grows in height with progress |
| Remembered enemy building | Translucent ghost until seen again |

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
- [ ] One ranged unit (archer) — content only, see CONTENT.md walkthrough
- [ ] Defensive building (tower) — needs a building `attack` field + system
- [ ] Walls / gates
- [x] Upkeep: units consume wheat over time — data (`unit.upkeep`, `rules.upkeepInterval`) and the
      payment system exist; soldiers eat 1 wheat/minute by default. Still open: what starving does.
- [x] Requirements on units, buildings and techs (tech or owned building); tech graph with
      `bun run tree:graph` for a future Civ-style planner screen
- [ ] Tech tree screen in the client (React) driven by `techgraph.ts`
- [ ] Simple AI opponent for solo play and balancing
- [ ] Win condition: destroy all enemy campfires
- [ ] Balance pass with real opponents

### M3 — Looks
- [ ] Replace primitives with low-poly models (Blender / Meshy pipeline); `visual` blocks grow a `model` field
- [ ] Terrain texture, water/cliffs as impassable terrain
- [ ] Animations (walk, chop, attack), sound
- [ ] Flashier start screen, in-game help, settings dialog (all React)

### Ops
- [ ] Dockerfile + deploy on the homelab behind Cloudflare tunnel
- [ ] Delta snapshots or binary encoding if bandwidth becomes an issue
- [ ] Multiple rulesets selectable per room

## Open questions

- Population is a hard cap and wheat is consumed as upkeep (both, as of 2026-09-04). Still undecided: what
  happens when a player cannot pay upkeep. Options: units lose HP, units stop fighting, production halts.
  Decide with real opponents.
- Player elimination: campfire destroyed = out? Or allow rebuilding? Decide with the win condition in M2.
- Persistence: is a game ever saved, or is every server restart a fresh map? Fresh for now.
- Same-name reconnect is convenient but lets anyone claim an unattended village. Fine among friends; a
  token per session before any public deployment.
