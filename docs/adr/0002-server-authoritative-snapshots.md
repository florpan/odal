# 0002 – Server-authoritative simulation with per-player snapshots

Date: 2026-09-04   Status: accepted

## Context

Multiplayer RTS games classically use deterministic lockstep (only commands are sent, every client
simulates). It is bandwidth-efficient but hard to debug (desyncs), and players cannot join mid-game.

## Decision

The server is the only simulation that matters. Clients send `Command`s; the server runs `stepGame` at a
fixed tick and sends each player a snapshot filtered by fog of war. Clients render and interpolate.

## Consequences

- No desyncs, no cheating by editing client state, late join and reconnect are trivial.
- Bandwidth grows with entity count. Acceptable for a few hundred entities; delta/binary snapshots are the
  next step and are localised to `server/visibility.ts` and `client/game/world.ts`.
- Input latency is one round trip. Fine for this genre and scale.
- The engine is still deterministic and pure, so lockstep or replays remain possible later.
