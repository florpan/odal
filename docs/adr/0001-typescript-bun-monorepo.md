# 0001 – TypeScript everywhere in a Bun workspace monorepo

Date: 2026-09-04   Status: accepted

## Context

The game needs a browser client and a server that share the simulation. The owner's primary languages are
C#/.NET and TypeScript, with Bun as the preferred runtime.

## Decision

One language, TypeScript, for engine, server and client, in a Bun workspaces monorepo
(`packages/engine`, `content`, `server`, `client`). The server runs on Bun; the client is built by Vite.

## Consequences

- The simulation is written once and runs identically on both sides (validation, prediction, tests).
- One toolchain: `bun install`, `bun test`, one ESLint/Prettier config, one CI job.
- A C# server would have needed a second implementation of every rule, or a rules interpreter. Rejected.
- Bun-specific APIs are confined to `server/` and `content/src/index.ts` (file loading); the engine and
  client stay portable.
