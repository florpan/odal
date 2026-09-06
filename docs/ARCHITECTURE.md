# Architecture

How the pieces fit, what talks to what, and the rules that keep it that way. If you change something
described here, change this file in the same PR.

## 1. The shape

```
                 ┌──────────────────────────────────────────────────────────┐
                 │  packages/content   rulesets: JSON files = the tech tree │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ validated by
                 ┌───────────────▼──────────────────────────────────────────┐
                 │  packages/engine    pure simulation, shared by both sides│
                 └───────┬───────────────────────────────────────┬──────────┘
                         │                                       │
   ┌─────────────────────▼──────────┐   JSON over WebSocket   ┌──▼─────────────────────────────────┐
   │  packages/server (Bun)         │◀───────────────────────▶│  packages/client (Vite)            │
   │  rooms · sessions · fog filter │   commands ▶  ◀ snapshots│  game/ (TS+Three)  ui/ (React)     │
   │  dev: /dev/tree read + write   │◀── editor (dev only) ──▶│  editor/ (React, second page)      │
   └────────────────────────────────┘                         └────────────────────────────────────┘
```

Dependencies only point upwards in this picture: content → engine, server → engine + content,
client → engine. Server and client never import each other. The client never imports content: the game
receives the tech tree from the server inside the `welcome` message, so it always plays by the server's
rules, and the editor fetches the raw files from the dev server's `/dev/tree` route.

## 2. The tech tree (content)

A ruleset is six JSON files (`rules`, `resources`, `nodes`, `units`, `buildings`, `techs`) in one directory
(`content/default/`, or any directory via `TREE_DIR`), merged into one `TechTree` object by
`engine/src/tree.ts#mergeFiles`. The schema (zod) and cross-reference validator live in `engine/src/tree.ts`.
The engine never names a specific unit, building, tech or resource. It reads:

- what a unit can do (`abilities`: harvest, build, attack) and its stats
- what a building trains, researches, produces, unlocks (`requires`), whether it's a drop-off, whether it
  shoots (`attack`), whether its owner walks through it (`passable`), its footprint
- what a tech does through generic **effects** (`gatherRate`, `produceRate`, `damage`, `maxHp`, `speed`,
  `buildingHp`, `buildSpeed`) with optional filters
- requirements: a researched tech, an owned building, or a minimum population
- how nodes spawn on a generated map, and how everything looks (`visual` blocks) so the client can render
  new content without code

`idx(tree)` gives cached id → definition maps. `validateTree(data)` returns a list of readable errors;
`parseTree` throws on any. CI runs the validator on the default ruleset and checks that the JSON Schemas
in `content/schema/` (generated from the zod schemas by `bun run schema:gen`, used by VS Code through
`.vscode/settings.json`) are up to date. See [CONTENT.md](CONTENT.md).

`techgraph.ts` derives the dependency graph (`buildGraph`, `prerequisites`, `chainCost`, `findCycle`,
`unobtainable`, `toMermaid`). Validation, the in-game tree screen and the editor all consume it.

## 3. The engine

`engine/src/` is framework-free TypeScript that runs identically in Bun and in the browser.

| File             | Responsibility                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`       | Game state: `GameState`, `Unit`, `Building`, `Player`, `ResourceNode`, tasks. Plain data only.                                                                                 |
| `protocol.ts`    | `Command`, `ClientMessage`, `ServerMessage`, `Snapshot`, `PROTOCOL_VERSION`.                                                                                                   |
| `content.ts`     | The content type hierarchy: `EntityDef` → `ResourceDef`, `NodeDef`, `ProducibleDef` → `UnitDef`, `BuildingDef`, `TechDef`. Source of truth for what a ruleset can express.     |
| `tree.ts`        | zod schemas (asserted to match `content.ts`), `*Input` author types, `FILE_SCHEMAS`, `mergeFiles`, validation, `idx()` lookups, `formatCost`, `describeEffect`.                |
| `techgraph.ts`   | Dependency graph: `buildGraph`, `prerequisites`, `chainCost`, `findCycle`, `unobtainable`, `toMermaid`. Used by validation and by tree views.                                  |
| `game.ts`        | `createGame(tree, seed)`, `addPlayer`, `stepGame`. The only lifecycle entry points.                                                                                            |
| `commands.ts`    | Turns a `PlayerCommand` into tasks/queue entries after validating it against the rules.                                                                                        |
| `queries.ts`     | Read-only questions: affordability, population, unlocks, tech effect multipliers, spatial lookups. Used by engine, server and client UI.                                       |
| `entities.ts`    | `makeUnit`, `makeBuilding`.                                                                                                                                                    |
| `ctx.ts`         | The per-tick `Ctx` (state, tree, defs, dt, events, blocked grids) and tiny helpers. `blockedFor(ctx, owner)` opens the owner's gates.                                          |
| `hex.ts`         | Hex geometry (ADR 0008): offset ↔ axial coordinates, `hexCentre`, `worldToHex`, neighbours, distance, rings, areas, lines, `worldSize`. Pure math.                             |
| `grid.ts`        | Blocking grid (optionally per owner), footprints (centre hex + radius), adjacency rings, placement checks, `footprintDistance`.                                                |
| `pathfinding.ts` | A* over the hex grid behind one `findPath(nav, from, to)`. The only caller is `movement.ts`; per-unit pathing styles go in here as parameters.                                 |
| `mapgen.ts`      | Seeded map generation: terrain (island coastline), start slots on a ring, per-start home resources, each node type's `spawn` scatter, then a corridor for any start sealed in. |
| `vision.ts`      | Fog of war: vision grids from a player's units and buildings.                                                                                                                  |
| `systems/`       | One behaviour per file, see below.                                                                                                                                             |

### Tick order (`stepGame`)

1. Apply this tick's commands (`commands.ts`). A placed building blocks its hexes immediately.
2. Recompute the blocked grid; per-owner grids (gates) are built lazily by `blockedFor`.
3. `stepUnits` – per unit, dispatch on `task.kind`:
   idle → auto-acquire (combat); move/attackMove → movement (+ auto-acquire);
   harvest → `systems/harvest.ts`; build → `systems/construction.ts`; attack → `systems/combat.ts`.
4. `separateUnits` – push idle/walking units apart (`systems/separation.ts`).
5. `stepBuildings` – production timers and train/research queues (`systems/production.ts`), rally points;
   then buildings with an `attack` block shoot the nearest enemy in range (`systems/towers.ts`).
6. `stepUpkeep` – every `rules.upkeepInterval` seconds, players pay their units' `upkeep` (`systems/upkeep.ts`).
7. Remove dead units and buildings, emit messages.
8. `tick++`. Return `TickEvents` (changed/removed nodes, messages) for the server to forward.

Commands (`commands.ts`) check `requires` on units, buildings and techs through `queries.ts`
(`unitUnlocked`, `buildingUnlocked`, `techUnlocked`); a requirement is a researched tech, an owned
completed building, or a minimum living population. The same helpers drive the disabled state and
"Requires …" text in the HUD and the colours in the tech tree screen.

Movement (`systems/movement.ts`) is a service other systems call (`goTo`, `goToAdjacent`); it is the only
code that changes unit positions apart from separation. It paths on `blockedFor(ctx, unit.owner)`, so a
player's own `passable` buildings are open to them and closed to everyone else.

### Coordinates

The map is a hex grid (ADR 0008, `hex.ts`). Tiles are `(col, row)` in odd-r offset coordinates and are
stored `row * width + col`, so a `width × height` `Uint8Array` covers the map. Nodes and buildings sit on a
hex (`x`, `y`); a building's footprint is its centre hex plus every hex within `r` steps. `state.terrain`
holds one terrain index per hex; impassable terrain is part of the blocked grid. Units and every
command target are continuous world positions: neighbouring hexes in a row are 1 unit apart, rows are
`ROW_H` (≈ 0.866) apart, odd rows are shifted right by 0.5. Convert with `hexCentre(col, row)` and
`worldToHex(pos)`; never add 0.5 by hand. `worldSize(width, height)` gives the map's extent in world units.

Adding a system: new file in `systems/`, call it from `systems/index.ts` at the right point in the order,
add a row to the table above, add a test in `game.test.ts`.

## 4. The server

| File            | Responsibility                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`      | Config (`PORT`, `TREE_DIR`, `EMPTY_ROOM_TTL_MS`, `ODAL_DEV`), `Bun.serve`, tick timer.                                                                                     |
| `room.ts`       | `Room`: lobby → playing → restart. Members, ready-up, late join, reconnect by name, tick, snapshots. `RoomManager`: lookup, cleanup, `setTree`.                            |
| `session.ts`    | Decode one client's messages, check protocol version, route to its room.                                                                                                   |
| `visibility.ts` | Fog filtering: what a given player may see in welcome and snapshot messages. Other players' resources and techs are masked.                                                |
| `static.ts`     | Serves the built client in production.                                                                                                                                     |
| `dev.ts`        | `GET`/`PUT /dev/tree` for the content editor. Validates, formats with Prettier, writes the ruleset files, swaps the ruleset for new rooms. Mounted only with `ODAL_DEV=1`. |
| `conn.ts`       | Per-connection data type and `send`.                                                                                                                                       |

The server is authoritative. It runs `stepGame` at `rules.tickRate`, applies queued commands, and sends each
member a personal snapshot: full lists of visible units/buildings/players plus node deltas. There is no
client-side prediction; the client interpolates positions between snapshots.

## 5. The client

Three Vite pages share one source tree: `index.html` (the game), `editor.html` (the content editor) and
`models.html` (the model viewer, dev only).

```
client/src/
  main.tsx              React root of the game
  app/store.ts          zustand/vanilla store: screen, connection, lobby, session, hud view model, overlay
  game/                 PURE TS. Never imports React.
    session.ts          GameSession: owns World, Net, and (while mounted) Renderer + Input + frame loop.
                        The controller the UI calls. Publishes the HUD view model to the store.
    world.ts            Client copy of state, fog (vision/explored), remembered enemy buildings (ghosts)
    net.ts              WebSocket wrapper
    input.ts            Mouse/keyboard on the canvas: selection, context commands, camera, build mode,
                        attack-move, control groups, Tab toggles the tech tree overlay
    viewmodel.ts        buildHud(): resolves rules into plain data + action ids for the UI, plus the
                        TreeView (tree + per-item status) for the tech tree screen
    minimap.ts          Draws the minimap into a 2D context
    render/scene.ts     Three.js scene. Everything in world coordinates. Looks come from tree `visual`s.
    render/models.ts    GLB library for `visual.model`: load once, per-team "Team" material, Lambert look, skeleton clones + clips.
    index.ts            The ONLY module ui/ may import from game/
  ui/                   REACT. Never imports Three.js or game internals.
    App.tsx             Screen switch (start | lobby | game) from the store
    GameCanvas.tsx      THE bridge: renders <canvas>, session.attach(canvas) in an effect, cleanup disposes
    hooks.ts            useApp(selector)
    screens/            StartScreen, LobbyScreen, GameScreen, TechTreeOverlay (also the research screen), KeysOverlay
    hud/                TopBar, Messages, ModeHint, SelectionPanel, ActionBar, Minimap, HelpBar
    dialogs/            RestartButton
    tree/               TechTimeline (tier columns, in game), TechTreeGraph (React Flow + dagre, editor), RefDetails, layout.
    styles.css
  editor/               REACT. The content editor page. Imports engine + ui/tree, never game/ or app/.
  models/               Three.js only. The model viewer page (models.html): loads a GLB, plays clips, team colour.
    main.tsx            React root of editor.html
    EditorApp.tsx       Layout: entity list · graph · inspector + schema form · problems bar
    SchemaForm.tsx      Form generated by walking the zod schemas (FILE_SCHEMAS)
    ops.ts              Pure edits on the six raw files: set, add, duplicate, remove, renameId, connect, disconnect
    store.ts            zustand store: files, selection, undo/redo, load/save via /dev/tree
```

### The bridge, in one paragraph

React owns elements, the game owns what happens inside them. `GameCanvas` renders a `<canvas>` once and
calls `session.attach(canvas)` in an effect; the returned cleanup disposes the renderer, the input listeners
and the frame loop (React StrictMode mounts twice in development, so teardown must be complete).
Game → UI: `session.publish()` writes a `HudModel` (plain data) into the store after every snapshot,
selection change or mode change; components subscribe to slices with `useApp`. UI → game: components call
`session.action(id)`, `session.setReady()`, `session.restart()`, `session.minimapClick()`. Action ids are
strings like `build:farm`, `train:worker`, `research:ironworking`, `attackMove`, `stop`, `clearRally`,
`cancelQueue:0`; the view model decides which exist and whether they are enabled, so UI components contain
no rules. The `Minimap` component follows the same pattern with its own 2D canvas. The tech tree overlay
reads `hud.tree` (the tree plus an `owned | inProgress | available | locked` status per item) and never
computes rules itself.

### The editor, in one paragraph

The editor works on the six raw JSON files, not on a parsed tree, so what it saves is what the author
wrote. Every change is a pure function in `ops.ts` applied through the store (which keeps undo history);
validation is derived from the files on every render with the same `validateTree` the server uses, so
the problems bar is always truthful. The graph is the engine's `buildGraph` of the last parseable tree;
dragging between nodes calls `connect`, deleting an edge calls `disconnect`. Forms are generated from
`FILE_SCHEMAS`, so a new schema field needs no editor code; field names (`resource`, `unit`, `trains`, …)
turn string fields into id pickers.

### What goes where

- Has text, is clicked like a button, opens/closes, scrolls → React (`ui/`).
- Lives in world coordinates and moves with the camera → Three.js (`game/render/`).
- Needs both (floating labels over units) → `renderer.project()` + a small absolutely positioned overlay
  component. Use sparingly and say why in the PR.
- Shows the tech tree → `ui/tree/`, used by both the game and the editor.

## 6. Networking

- `join {name, room, version}` → server replies `lobby` (in lobby) or `welcome` (game running: late join or
  reconnect by name).
- `ready {ready}` → when every member is ready the room starts: `welcome` to all with a fresh map.
- `cmd {cmd}` → queued, applied next tick.
- `restart` → room back to lobby for everyone.
- `snapshot` every tick, personal per player (fog). `PROTOCOL_VERSION` mismatch is an error on join.

Bandwidth is fine at this scale (a few hundred entities). If it ever isn't, the next steps are delta
snapshots and binary encoding, both local to `visibility.ts` and `world.ts`.

## 7. Rules enforced by tooling

`eslint.config.mjs` fails the build on:

- engine importing content, server, client, Node/Bun APIs, Three or React
- content importing anything but engine
- server importing the client package or UI libraries
- `client/src/game/**` importing React, `zustand` (use `zustand/vanilla`), content, server, or `ui/`
- `client/src/ui/**` importing Three, content, server, or any `game/` module other than `game/index.ts`
- `client/src/editor/**` importing Three, content, server, or anything under `game/` or `app/`

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests, content validation, the JSON
Schema staleness check and the production build on every push and PR.

## 8. Reading list

- Game Programming Patterns: Command, Game Loop, Update Method (why commands + fixed tick).
- "1500 Archers on a 28.8" (why a deterministic simulation is worth protecting; we are not lockstep today,
  but the engine is built so we could be).
