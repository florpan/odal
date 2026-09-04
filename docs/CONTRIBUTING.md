# Contributing

## Setup

```bash
git clone <repo> && cd odal
bun install
bun run dev:server     # terminal 1 → http://localhost:3000
bun run dev:client     # terminal 2 → http://localhost:5173
```

Open the client in two tabs with different names to play against yourself. `?name=Bob&room=test` in the
URL prefills the join form.

Requirements: Bun ≥ 1.1. No Node needed. Editors: enable Prettier and ESLint; `.editorconfig` is provided.

## Before you start

1. Read [CLAUDE.md](../CLAUDE.md) (entry point) and [ARCHITECTURE.md](ARCHITECTURE.md).
2. Find where your change belongs. Most changes fall into one of these buckets:

| I want to… | Touch | Read first |
|-----------|-------|------------|
| Add/tune a unit, building, tech, resource, node | `packages/content/default/*.ts` only | [CONTENT.md](CONTENT.md) |
| Add a new kind of rule the tree can't express (e.g. a new effect) | `engine/src/tree.ts` schema + the system that applies it + CONTENT.md | ARCHITECTURE §2–3 |
| Change unit behaviour | `engine/src/systems/<system>.ts` | ARCHITECTURE §3 |
| Add a player command | `engine/src/protocol.ts` + `commands.ts` + client `input.ts`/`session.ts`, bump `PROTOCOL_VERSION` | ARCHITECTURE §6 |
| Change rooms, lobby, reconnect | `server/src/room.ts`, `session.ts` | ARCHITECTURE §4 |
| Change what the player sees on the map | `client/src/game/render/scene.ts` | ARCHITECTURE §5 |
| Change HUD/menus/dialogs | `client/src/ui/**` + `game/viewmodel.ts` if new data is needed | ARCHITECTURE §5 |
| Change mouse/keyboard handling | `client/src/game/input.ts` | ARCHITECTURE §5 |

If your change spans several buckets, split it into several PRs in dependency order.

## Workflow

- Branch from `main`: `feat/<thing>`, `fix/<thing>`, `content/<thing>`, `docs/<thing>`.
- Small PRs. One concern each. A content change and an engine change are two PRs.
- `bun run check` must pass locally (typecheck, lint, tests, content validation). CI runs the same plus
  `format:check` and the production build.
- Write or update a test when you change behaviour: engine tests in `engine/src/game.test.ts`
  (or a new `*.test.ts` next to the system), content tests in `content/src/content.test.ts`.
- Update docs in the same PR: ARCHITECTURE.md for structure, CONTENT.md for schema fields,
  PLAN.md for design intent, an ADR (see `docs/adr/`) for decisions others will ask about later.
- Commit messages: imperative, short subject, explain *why* in the body when it isn't obvious.

## Definition of done

- [ ] `bun run check` green, `bun run format` applied
- [ ] Behaviour covered by a test or, for UI, verified in two browser tabs (say so in the PR)
- [ ] No hard-coded content ids in engine/server/client code
- [ ] Docs updated (see above); PROTOCOL_VERSION bumped if the wire format changed
- [ ] PR description says what changed, why, and how you verified it

## Working with an AI agent

Agents get `CLAUDE.md` automatically. Ask them to read the doc for the bucket you're working in before
changing code, and to run `bun run check` at the end. The ESLint boundary rules will stop the most common
mistakes (React in game code, Three in UI, content ids in the engine). If an agent proposes disabling a
lint rule, the answer is almost always "move the code instead".

## Style

Prettier defaults with single quotes, trailing commas, 120 columns. Type-only imports use `import type`.
Comments explain why, not what. Keep functions small enough to read in one screen. Prefer plain data and
functions over classes in the engine; classes are fine for long-lived objects on the client and server
(session, renderer, room).
