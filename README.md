# Odal

A simple browser-based multiplayer RTS: harvest lumber, iron, gold and wheat, build a village around your
campfire, research, and fight. Inspired by Warcraft II. Every rule is data in a tech tree.

*Odal* (Old Norse óðal): inherited land, held and defended by a family. Your village around the fire is
exactly that.

- Playing and contributing: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Adding units, buildings, techs: [docs/CONTENT.md](docs/CONTENT.md)
- Design and roadmap: [docs/PLAN.md](docs/PLAN.md)

## Run it

```bash
bun install
bun run dev:server   # game server on http://localhost:3000
bun run dev:client   # client on http://localhost:5173
```

Open http://localhost:5173 in two tabs (or on two machines on the LAN) and join the same room with
different names. Production: `bun run build && bun start` serves the built client from the game server.

## Controls

| Action | Input |
|--------|-------|
| Select | Left click, drag for box select, Shift to add |
| Command | Right click: ground = move, tree/rock = harvest, enemy = attack, own unfinished building = help build |
| Attack-move | A, then click. Fighters engage anything they meet on the way |
| Control groups | Ctrl+1–9 saves the selection, 1–9 recalls it, press twice to center the camera |
| Rally point | Select a campfire or barracks and right-click the ground or a resource. New workers auto-harvest a rallied resource |
| Build | Select workers, press the building's hotkey (H F L B) or use the buttons, click to place. Shift-click to place several |
| Stop | S |
| Camera | Arrow keys / W D X, middle-drag, mouse wheel, click minimap |
| Cancel | Esc |
| Restart | Button top-right, click twice. Sends the whole room back to the lobby with a fresh map |

Rooms: the join screen has a room field (also `?room=name&name=you` in the URL). The game starts when
everyone in the room is ready. Late joiners drop straight in; refreshing the page rejoins your village by name.
Fog of war is enforced by the server.

## Layout

```
packages/content   rulesets (JSON): resources, nodes, units, buildings, techs
packages/engine    pure simulation shared by server and client
packages/server    Bun WebSocket server: rooms, sessions, fog filtering
packages/client    React app around a Three.js canvas
docs/              architecture, contributing, content guide, plan, ADRs
```
