# 0007 – Rulesets are JSON, edited with a graphical tree editor

Date: 2026-09-04 Status: accepted (supersedes point 2 of [0006](0006-typed-content-requirements-graph.md))

## Context

Balancing the game means changing many numbers and dependencies many times. ADR 0006 chose TypeScript for
the default ruleset so authors get autocomplete. A tool that edits content cannot safely round-trip
TypeScript (comments, formatting, expressions), and a "what leads to what" view is impossible to keep in
your head once the tree has more than a dozen nodes. Players need the same view to plan.

## Decision

1. **The default ruleset is JSON** (`packages/content/default/*.json`), the same six files external rulesets
   already used. Editor support comes from **JSON Schema generated from the zod schemas**
   (`bun run schema:gen` → `packages/content/schema/`, mapped in `.vscode/settings.json`; CI fails when
   the committed schemas are stale). Author comments move to an optional `notes` field on every entity
   that the game ignores.
2. **One graph component, two consumers.** `client/src/ui/tree/TechTreeGraph.tsx` (React Flow + dagre)
   renders the derived tech graph. The in-game tech tree screen (Tab) uses it read-only, coloured by the
   player's progress. The **content editor** (`/editor.html`, `client/src/editor/`) uses it read-write:
   drag between nodes to add a requirement or a trains/researches entry, Delete to remove one.
3. **The editor's forms are generated from the zod schemas.** A new field in `engine/src/tree.ts` appears
   in the editor without editor work. Field names decide which ids a picker offers.
4. **Saving goes through the dev server** (`PUT /dev/tree`, only when `ODAL_DEV=1`), which validates,
   formats with Prettier and writes the files, then swaps the ruleset for new rooms. Invalid trees are
   refused so the repository never holds a ruleset the server cannot load.

## Consequences

- Content edits are a save in a browser tab instead of a TypeScript edit, with the validator's errors shown
  live and clickable. Renaming an id updates every reference.
- We lose TypeScript's `satisfies` checking on content; the JSON Schema and the runtime validator cover the
  same ground, and the compile-time assert between zod and `content.ts` still guarantees the schema is right.
- The engine gains `mergeFiles`, `RULESET_FILES`, `FILE_SCHEMAS`, `chainCost`, `describeEffect`: pure
  helpers both the editor and the game screen need.
- The client depends on `zod` (same major as the engine) so the editor can walk schemas with `instanceof`.
- `packages/content/schema/` is generated output and excluded from Prettier.
