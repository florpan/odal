# 0003 – All game rules are data (the tech tree)

Date: 2026-09-04 Status: accepted

## Context

The first version hard-coded units, buildings and techs as TypeScript constants and had `if (tech ===
'sharp_axes')` inside the harvest code. Adding content meant touching the engine, and contributors had to
understand the simulation to change a number.

## Decision

A ruleset is six JSON files validated by a zod schema in `engine/src/tree.ts`. Units declare abilities and
stats, buildings declare what they train/research/produce/unlock, techs declare generic effects. The engine
never references a specific id. The server loads the ruleset and sends it to clients in `welcome`.

## Consequences

- Adding a unit, building, tech or resource is a JSON change validated by CI. See `docs/CONTENT.md`.
- New _kinds_ of rules still need engine work: extend the schema, apply it in a system, document it.
  This is the intended pressure: engine changes should add capability, not content.
- Ids are strings, not literal unions; the validator catches dangling references at load time instead
  of the compiler.
- Different rooms can run different rulesets in the future without code changes.
