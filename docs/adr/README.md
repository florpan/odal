# Architecture Decision Records

One short file per decision that someone will ask "why?" about later. Numbered, never edited after
acceptance; supersede with a new one instead.

Template:

```
# NNNN – Title
Date: YYYY-MM-DD   Status: accepted | superseded by NNNN

## Context
What situation forced a decision.
## Decision
What we chose, in one or two sentences.
## Consequences
What becomes easier, what becomes harder, what we gave up.
```

| #                                                | Decision                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [0001](0001-typescript-bun-monorepo.md)          | TypeScript everywhere in a Bun workspace monorepo                                                           |
| [0002](0002-server-authoritative-snapshots.md)   | Server-authoritative simulation with per-player snapshots                                                   |
| [0003](0003-data-driven-tech-tree.md)            | All game rules are data (the tech tree)                                                                     |
| [0004](0004-react-shell-canvas-bridge.md)        | React owns the app, the game owns the canvas, one bridge component                                          |
| [0005](0005-engine-systems-split.md)             | Engine split into one system per file with a fixed tick order                                               |
| [0006](0006-typed-content-requirements-graph.md) | Typed content, uniform requirements, upkeep as data, derived tech graph (content format superseded by 0007) |
| [0007](0007-json-content-and-editor.md)          | Rulesets are JSON with generated JSON Schema; graphical tree editor and in-game tree screen                 |
