# Odal

Browser-based multiplayer RTS in the spirit of Warcraft II: harvest, build, research, fight. Medieval,
deliberately simple. TypeScript everywhere, Bun workspaces, React shell around a Three.js canvas,
authoritative Bun server, and **every game rule lives in a data-driven tech tree**.

This file is the entry point for humans and agents. Read the linked docs before changing the area they cover.

| Doc                                          | Read it when you…                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | touch anything. Layers, data flow, tick order, the React/canvas bridge, and the rules ESLint enforces. |
| [docs/CONTENT.md](docs/CONTENT.md)           | add or change a unit, building, tech, resource or node. Field reference and walkthroughs.              |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | set up, branch, test, open a PR. Definition of done.                                                   |
| [docs/PLAN.md](docs/PLAN.md)                 | want to know why the game is the way it is and what is planned next.                                   |
| [docs/adr/](docs/adr/)                       | wonder why a big decision was made (or make one yourself).                                             |

## Packages (dependencies point left to right)

```
content ──▶ engine ◀── server        content: rulesets as JSON (the tech tree) + loader
              ▲                      engine:  types, protocol, simulation systems, pathfinding, vision
              └────── client         server:  rooms, sessions, fog filtering (Bun WebSocket)
                                     client:  game/ (pure TS + Three.js)  ui/ (React)  app/store (the bridge)
```

## Commands

```bash
bun install
bun run dev:server          # http://localhost:3000, WebSocket on /ws, editor routes on /dev/tree
bun run dev:client          # http://localhost:5173 (proxies /ws and /dev to the server)
bun run dev:editor          # the tech tree editor: http://localhost:5173/editor.html (needs dev:server)
bun run check               # typecheck + lint + tests + content validation + schema check  ← before every PR
bun run validate:content    # validate the default ruleset (or: bun packages/content/src/validate.ts <dir>)
bun run schema:gen          # regenerate packages/content/schema/*.json after changing engine/src/tree.ts
bun run tree:graph unit:soldier   # what leads to something (prerequisites + Mermaid); no arg = whole tree
bun run model:worker        # regenerate the procedural labourer GLB (tools/models); KayKit conversions run in Blender
#                             model viewer: http://localhost:5173/models.html?m=rogue.glb (needs dev:client)
#                             ?atlas=default|fall|winter (game or viewer) swaps the Hexagon pack's texture (exports carry Summer)
#                             ?fog=0 (game) shows the whole map, for looking at map generation
#                             contact sheets of the whole pack: blender -b -P tools/models/kaykit_sheet.py -> C:\Dev\KayKit\sheets
bun run build && bun start  # production: server serves the built client (no editor routes)
bun run start:editor        # same, but with /dev/tree mounted so /editor.html works against the built client
```

## Hard rules (ESLint enforces the import ones)

1. **Rules are data.** Never hard-code a unit, building, tech or resource id in engine, server or client code.
   Read it from the tree. If the tree can't express what you need, extend the interface in
   `engine/src/content.ts` and the schema in `engine/src/tree.ts` (the compile-time asserts keep them in
   sync), apply it in a system, run `bun run schema:gen`, and document the new field in `docs/CONTENT.md`.
   Content itself is JSON in `packages/content/default/`, edited with the editor or by hand.
2. **Server-authoritative.** Clients send `Command`s (`engine/src/protocol.ts`); the server never trusts client state.
3. **Engine is pure.** No I/O, no Bun/Node APIs, no rendering. Same code runs on server and in the browser.
4. **One system per file** in `engine/src/systems/`. Add new behaviour as a new system, register it in
   `systems/index.ts`, describe it in ARCHITECTURE.md.
5. **State is plain data**: records keyed by id, no classes or Maps, JSON-serialisable.
6. **Client split:** `client/src/game/**` never imports React. `client/src/ui/**` never imports Three.js and only
   imports `game/index.ts`. They meet in `app/store.ts` (zustand/vanilla) and `ui/GameCanvas.tsx`.
   `client/src/editor/**` is a separate page: engine + `ui/tree/` only, never `game/` or `app/`.
7. **Protocol changes** bump `PROTOCOL_VERSION` and update server `visibility.ts`/`session.ts` and client
   `game/world.ts`/`game/session.ts` together.
8. **Balance numbers** live only in `packages/content/default/*.json`.

## Conventions

- Prettier + ESLint config at the root; `bun run format` before committing.
- Tests: `*.test.ts` next to the code, run with `bun test`. Engine tests use the default ruleset.
- Coordinates: the map is a hex grid (ADR 0008, `engine/src/hex.ts`). Tiles are `(col, row)` offset coordinates,
  positions are continuous world units (a hex is ~1 wide). Convert with `hexCentre`/`worldToHex`, never by hand.
  Game `y` is Three.js `z`.
- Keep it simple. New resources/units/buildings need a reason in `docs/PLAN.md` first.
- 3D models are data: GLBs in `packages/client/public/models`, referenced from `visual` blocks (CONTENT.md),
  built by `tools/models/` (procedural TypeScript or Blender scripts over the CC0 KayKit packs). Missing model →
  primitive fallback; never make the client depend on a file being there. Conventions in PLAN.md § M3.
- No C# here; the SharpTools rules from the global config do not apply.
