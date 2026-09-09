# 0008 – Hex grid at person scale, board-game look

Date: 2026-09-06 Status: accepted

## Context

The first playtest raised hexagonal tiles as an open question. Three things then pushed in the same
direction: the art comes from the KayKit Medieval Hexagon pack, which ships ground, coast, river, road
and slope tiles that only fit together on a hex grid; the map is meant to become a round island with a
natural water border; and the ground should vary in height. On squares all three would need custom
work (a shoreline transition set, a smooth heightmap with footprint flattening). Pathfinding was never
the blocker: hex A* is simpler than the 8-directional square A* it replaces.

The real coupling was the rectangular building footprint (`size {w,h}`) spread through placement,
adjacency, blocking, drop-off distance, fog filtering and rendering. It was cheap to change with eight
buildings and one model fitted; it would not have stayed cheap.

## Decision

The map is a grid of pointy-top hexes in horizontal rows, odd rows shifted half a hex right ("odd-r"
offset coordinates). Storage stays `row * width + col`, so every `width × height` byte grid (blocking,
vision, fog, minimap) is unchanged. Neighbours and distances go through axial coordinates
(`engine/src/hex.ts`). Neighbouring centres in a row are 1 world unit apart, so a hex is about one unit
wide and speeds, ranges and radii in the tech tree keep meaning "about one hex".

Scale is the board-game kind: a hex is a building, or a tree, or a field. A tile represents what is on
it rather than its true size. _Amended 2026-09-07:_ people are not tile-sized. A character is 0.3 hex
tall, moves on continuous positions inside the hex grid (several per hex, kept apart by separation),
and takes a work stance at the edge of its hex facing its work. The hex remains the unit of terrain,
placement, pathfinding and vision. Footprints are a hex
radius (`size.radius`: 0 = one hex, 1 = seven) and every current building is radius 0.

Pathfinding is a service: `pathfinding.ts` exposes one `findPath(nav, from, to)` over a `NavGrid`, and
only `movement.ts` calls it. Per-unit pathing styles (a brute that only walks straight lines) are
parameters on that call, never logic in the systems that ask for a path.

Map generation guarantees every start slot can reach the map centre. A hex grid has no diagonal gaps,
so a ring of trees is a real wall; a start that is sealed in gets a one-hex corridor carved towards the
centre.

## Consequences

- The KayKit hex tiles can be used as-is for ground, coast, rivers, roads and stepped height. Per-hex
  flat heights sidestep sloped placement entirely.
- Ranges are naturally round and there is no diagonal-move cheese.
- Building sizes jump from 1 hex to 7; balance data needs revisiting when a larger building is wanted.
- Rectangular placement, rectangular walls and the fog texture (one texel per hex, so odd rows are
  half a hex off; the linear filter blurs it) are approximations for now.
- Protocol bumped to 5 (`Building.r` replaces `w`/`h`).
- Every hand-written coordinate in tests and tools goes through `hexCentre` / `worldToHex`.
