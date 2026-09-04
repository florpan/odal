# 0005 – Engine split into one system per file with a fixed tick order

Date: 2026-09-04   Status: accepted

## Context

The simulation started as one 600-line `sim.ts` that every gameplay feature touched. With several people
working at once that file would have been a permanent merge conflict.

## Decision

`engine/src/systems/` holds one behaviour per file (movement, harvest, construction, combat, production,
separation). `systems/index.ts` fixes the order they run in each tick; `game.ts` orchestrates; `commands.ts`
validates player input; `queries.ts` answers read-only questions for engine, server and client alike.
A shared `Ctx` (state, tree, defs, dt, events, blocked grid) is passed to every system.

## Consequences

- Two people can work on combat and harvesting without touching the same file.
- The tick order is explicit and documented in one place (ARCHITECTURE.md §3).
- Systems communicate only through the state and the `Ctx`; no hidden coupling.
- Adding a system is a checklist: file, registration, doc row, test.
