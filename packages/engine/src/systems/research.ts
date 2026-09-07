import { say } from '../ctx';
import type { Ctx } from '../ctx';

// ---------------------------------------------------------------------------
// Research: every player works through their own research queue, one tech at
// a time, community-wide. Nothing about it belongs to a building: a tech that
// needs a blacksmith says so in its `requires`, and the "Select research"
// button just lives on buildings flagged `research` (the town hall).
// ---------------------------------------------------------------------------

export function stepResearch(ctx: Ctx) {
  const { state, dt, defs } = ctx;
  for (const id in state.players) {
    const p = state.players[id];
    const tech = p.research[0];
    if (tech === undefined) continue;
    const def = defs.techs[tech];
    p.researchProgress = Math.min(def.time, p.researchProgress + dt);
    if (p.researchProgress < def.time) continue;
    if (!p.techs.includes(tech)) p.techs.push(tech);
    say(ctx, p.id, `Research complete: ${def.name}.`);
    p.research.shift();
    p.researchProgress = 0;
  }
}
