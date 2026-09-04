# 0006 – Typed content, uniform requirements, and a derived tech graph

Date: 2026-09-04   Status: accepted

## Context

The first data-driven tree loaded JSON as `unknown`, had prerequisites only on buildings and techs (as
plain tech-id lists), and no notion of upkeep. We want contributors to get editor support while authoring,
and we want to be able to show a Civilization-style "what leads to what" view so players can plan a
style (defensive research first, rush a strong unit, …).

## Decision

1. **Explicit type hierarchy** in `engine/src/content.ts`: `EntityDef` → `ResourceDef`, `NodeDef`,
   `ProducibleDef` (cost, time, requires) → `UnitDef`, `BuildingDef`, `TechDef`. The zod schemas in
   `tree.ts` are asserted at compile time to produce exactly these types, and are strict (unknown fields
   are errors).
2. **Content is authored in TypeScript** (`packages/content/default/*.ts`, typed as `UnitDefInput[]`
   etc.) and still validated at runtime. JSON rulesets remain loadable for external/modded content.
3. **Uniform requirements**: `requires: ({ type: 'tech' } | { type: 'building' })[]` on units, buildings
   and techs alike. Being trained/researched somewhere is an implicit requirement.
4. **Upkeep is data**: `unit.upkeep` paid every `rules.upkeepInterval`. The consequence of not paying
   beyond "resource stays at zero" is deliberately left open.
5. **The tech graph is derived, not authored** (`engine/src/techgraph.ts`). Validation rejects cycles and
   unobtainable content; `prerequisites()` and `toMermaid()` serve tooling and future UI.

## Consequences

- Authors get autocomplete and red squiggles in the editor; CI still catches semantic errors.
- Any planner or tree screen is a pure function of the tree the client already has.
- One more field name to learn: `time` replaces `trainTime`/`buildTime` so all producibles look alike.
- Building-type requirements make "you need a Blacksmith first" expressible without placeholder techs.
- Starvation rules are a balance decision to be made with real opponents (PLAN.md).
