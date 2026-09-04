# 0004 – React owns the app, the game owns the canvas, one bridge component

Date: 2026-09-04 Status: accepted

## Context

The first HUD was hand-written DOM patching and shipped a bug where buttons were recreated under the
cursor. Past projects of the owner ended up drawing menus and dialogs onto the canvas because there was no
UI framework, and regretted it. A full-canvas UI or a canvas-plus-scattered-vanilla-DOM mix were both
rejected.

## Decision

The client is a React single-page app (start screen, lobby, game screen, dialogs). The game itself is
framework-free TypeScript around Three.js. They meet in exactly two places: a zustand/vanilla store
(`app/store.ts`) and the `GameCanvas` component, which renders a `<canvas>` once and hands it to the game
session in an effect whose cleanup disposes everything. UI reads a plain view model from the store and
calls methods on the session; it never touches Three.js or game internals. ESLint enforces the boundary.

## Consequences

- Anything with text, buttons or layout is React from day one, so the "should have been HTML" regret
  cannot happen.
- The game core has no React dependency and could be embedded elsewhere or driven headlessly in tests.
- Per-frame data (unit positions) stays out of React; only the 10 Hz view model crosses the bridge.
- Contributors need to know which side they are on; CONTRIBUTING.md's table and the lint rules tell them.
- StrictMode double-mounting forced complete teardown of renderer and listeners, which restart and
  leaving a room needed anyway.
