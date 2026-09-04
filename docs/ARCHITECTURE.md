# Architecture

How the pieces fit, what talks to what, and the rules that keep it that way. If you change something
described here, change this file in the same PR.

## 1. The shape

```
                 ┌──────────────────────────────────────────────────────────┐
                 │  packages/content   rulesets: typed data = the tech tree │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ validated by
                 ┌───────────────▼──────────────────────────────────────────┐
                 │  packages/engine    pure simulation, shared by both sides│
                 └───────┬───────────────────────────────────────┬──────────┘
                         │                                       │
   ┌─────────────────────▼──────────┐   JSON over WebSocket   ┌──▼─────────────────────────────────┐
   │  packages/server (Bun)         │◀───────────────────────▶│  packages/client (Vite)            │
   │  rooms · sessions · fog filter │   commands ▶  ◀ snapshots│  game/ (TS+Three)  ui/ (React)     │
   └────────────────────────────────┘                         └────────────────────────────────────┘
```

Dependencies only point upwards in this picture: content → engine, server → engine + content,
client → engine. Server and client never import each other. The client never imports content: it receives
the tech tree from the server inside the `welcome` message, so it always plays by the server's rules.

## 2. The tech tree (content)

A ruleset is six files (`rules`, `resources`, `nodes`, `units`, `buildings`, `techs`; TypeScript in `content/default/`, or JSON for external rulesets loaded with `TREE_DIR`)
merged into one `TechTree` object. The schema (zod) and cross-reference validator live in
`engine/src/tree.ts`; the default ruleset lives in `content/default/`. The engine never names a specific
unit, building, tech or resource. It reads:

- what a unit can do (`abilities`: harvest, build, attack) and its stats
- what a building trains, researches, produces, unlocks (`requires`), whether it's a drop-off, its footprint
- what a tech does through generic **effects** (`gatherRate`, `produceRate`, `damage`, `maxHp`, `speed`,
  `buildSpeed`) with optional filters
- how nodes spawn on a generated map, and how everything looks (`visual` blocks) so the client can render
  new content without code

`idx(tree)` gives cached id → definition maps. `validateTree(data)` returns a list of readable errors;
`parseTree` throws on any. CI runs the validator on the default ruleset. See [CONTENT.md](CONTENT.md).

## 3. The engine

`engine/src/` is framework-free TypeScript that runs identically in Bun and in the browser.

| File | Responsibility |
|------|----------------|
| `types.ts` | Game state: `GameState`, `Unit`, `Building`, `Player`, `ResourceNode`, tasks. Plain data only. |
| `protocol.ts` | `Command`, `ClientMessage`, `ServerMessage`, `Snapshot`, `PROTOCOL_VERSION`. |
| `content.ts` | The content type hierarchy: `EntityDef` → `ResourceDef`, `NodeDef`, `ProducibleDef` → `UnitDef`, `BuildingDef`, `TechDef`. Source of truth for what a ruleset can express. |
| `tree.ts` | zod schemas (asserted to match `content.ts`), `*Input` author types, validation, `idx()` lookups, `formatCost`. |
| `techgraph.ts` | Dependency graph: `buildGraph`, `prerequisites`, `findCycle`, `unobtainable`, `toMermaid`. Used by validation and by tree views. |
| `game.ts` | `createGame(tree, seed)`, `addPlayer`, `stepGame`. The only lifecycle entry points. |
| `commands.ts` | Turns a `PlayerCommand` into tasks/queue entries after validating it against the rules. |
| `queries.ts` | Read-only questions: affordability, population, unlocks, tech effect multipliers, spatial lookups. Used by engine, server and client UI. |
| `entities.ts` | `makeUnit`, `makeBuilding`. |
| `ctx.ts` | The per-tick `Ctx` (state, tree, defs, dt, events, blocked grid) and tiny helpers. |
| `grid.ts` | Blocking grid, adjacency, footprint checks, A* (8-directional, no corner cutting). |
| `mapgen.ts` | Seeded map generation driven by each node type's `spawn` rule. |
| `vision.ts` | Fog of war: vision grids from a player's units and buildings. |
| `systems/` | One behaviour per file, see below. |

### Tick order (`stepGame`)

1. Apply this tick's commands (`commands.ts`). A placed building blocks its tiles immediately.
2. Recompute the blocked grid.
3. `stepUnits` – per unit, dispatch on `task.kind`:
   idle → auto-acquire (combat); move/attackMove → movement (+ auto-acquire);
   harvest → `systems/harvest.ts`; build → `systems/construction.ts`; attack → `systems/combat.ts`.
4. `separateUnits` – push idle/walking units apart (`systems/separation.ts`).
5. `stepBuildings` – production timers and train/research queues (`systems/production.ts`), rally points.
6. `stepUpkeep` – every `rules.upkeepInterval` seconds, players pay their units' `upkeep` (`systems/upkeep.ts`).
7. Remove dead units and buildings, emit messages.
8. `tick++`. Return `TickEvents` (changed/removed nodes, messages) for the server to forward.

Commands (`commands.ts`) check `requires` on units, buildings and techs through `queries.ts`
(`unitUnlocked`, `buildingUnlocked`, `techUnlocked`); a requirement is a researched tech or an owned,
completed building. The same helpers drive the disabled state and "Requires …" text in the HUD.

Movement (`systems/movement.ts`) is a service other systems call (`goTo`, `goToAdjacent`); it is the only
code that changes unit positions apart from separation.

Adding a system: new file in `systems/`, call it from `systems/index.ts` at the right point in the order,
add a row to the table above, add a test in `game.test.ts`.

## 4. The server

| File | Responsibility |
|------|----------------|
| `index.ts` | Config (`PORT`, `TREE_DIR`, `EMPTY_ROOM_TTL_MS`), `Bun.serve`, tick timer. |
| `room.ts` | `Room`: lobby → playing → restart. Members, ready-up, late join, reconnect by name, tick, snapshots. `RoomManager`: lookup and cleanup. |
| `session.ts` | Decode one client's messages, check protocol version, route to its room. |
| `visibility.ts` | Fog filtering: what a given player may see in welcome and snapshot messages. Other players' resources and techs are masked. |
| `static.ts` | Serves the built client in production. |
| `conn.ts` | Per-connection data type and `send`. |

The server is authoritative. It runs `stepGame` at `rules.tickRate`, applies queued commands, and sends each
member a personal snapshot: full lists of visible units/buildings/players plus node deltas. There is no
client-side prediction; the client interpolates positions between snapshots.

## 5. The client

```
client/src/
  main.tsx              React root
  app/store.ts          zustand/vanilla store: screen, connection, lobby, session, hud view model
  game/                 PURE TS. Never imports React.
    session.ts          GameSession: owns World, Net, and (while mounted) Renderer + Input + frame loop.
                        The controller the UI calls. Publishes the HUD view model to the store.
    world.ts            Client copy of state, fog (vision/explored), remembered enemy buildings (ghosts)
    net.ts              WebSocket wrapper
    input.ts            Mouse/keyboard on the canvas: selection, context commands, camera, build mode,
                        attack-move, control groups
    viewmodel.ts        buildHud(): resolves rules into plain data + action ids for the UI
    minimap.ts          Draws the minimap into a 2D context
    render/scene.ts     Three.js scene. Everything in world coordinates. Looks come from tree `visual`s.
    index.ts            The ONLY module ui/ may import from game/
  ui/                   REACT. Never imports Three.js or game internals.
    App.tsx             Screen switch (start | lobby | game) from the store
    GameCanvas.tsx      THE bridge: renders <canvas>, session.attach(canvas) in an effect, cleanup disposes
    hooks.ts            useApp(selector)
    screens/            StartScreen, LobbyScreen, GameScreen
    hud/                TopBar, Messages, ModeHint, SelectionPanel, ActionBar, Minimap, HelpBar
    dialogs/            RestartButton
    styles.css
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
no rules. The `Minimap` component follows the same pattern with its own 2D canvas.

### What goes where

- Has text, is clicked like a button, opens/closes, scrolls → React (`ui/`).
- Lives in world coordinates and moves with the camera → Three.js (`game/render/`).
- Needs both (floating labels over units) → `renderer.project()` + a small absolutely positioned overlay
  component. Use sparingly and say why in the PR.

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

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests, content validation and the
production build on every push and PR.

## 8. Reading list

- Game Programming Patterns: Command, Game Loop, Update Method (why commands + fixed tick).
- "1500 Archers on a 28.8" (why a deterministic simulation is worth protecting; we are not lockstep today,
  but the engine is built so we could be).
