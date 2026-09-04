import { say } from '../ctx';
import type { Ctx } from '../ctx';
import type { Cost } from '../content';

// ---------------------------------------------------------------------------
// Upkeep: every `rules.upkeepInterval` seconds each player pays the summed
// `upkeep` of their living units. What happens when they can't pay is a
// balance decision still open in docs/PLAN.md; for now the resource bottoms
// out at zero and the player is told.
// ---------------------------------------------------------------------------

export function stepUpkeep(ctx: Ctx) {
  const { state, tree, defs } = ctx;
  const every = Math.max(1, Math.round(tree.rules.upkeepInterval * tree.rules.tickRate));
  if (state.tick === 0 || state.tick % every !== 0) return;

  for (const pid in state.players) {
    const player = state.players[pid];
    const due: Cost = {};
    for (const id in state.units) {
      const u = state.units[id];
      if (u.owner !== player.id) continue;
      for (const [res, n] of Object.entries(defs.units[u.type].upkeep)) due[res] = (due[res] ?? 0) + n;
    }
    for (const [res, n] of Object.entries(due)) {
      if (n <= 0) continue;
      const have = player.resources[res] ?? 0;
      if (have >= n) {
        player.resources[res] = have - n;
      } else {
        player.resources[res] = 0;
        say(ctx, player.id, `Not enough ${defs.resources[res]?.name.toLowerCase() ?? res} to feed your units.`);
      }
    }
  }
}
