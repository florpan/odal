import type { Ctx } from '../ctx';
import { isWalkable } from '../grid';
import type { GameState, Unit } from '../types';

// ---------------------------------------------------------------------------
// Separation: push overlapping units apart so they don't stack on one spot.
// Only idle and walking units are pushed; working units (gathering,
// building, fighting) stay put and act as obstacles.
// ---------------------------------------------------------------------------

const pushable = (u: Unit) => u.task.kind === 'idle' || u.task.kind === 'move' || u.task.kind === 'attackMove';

export function separateUnits(ctx: Ctx) {
  const { state, blocked } = ctx;
  const dist = ctx.tree.rules.separationDist;
  if (dist <= 0) return;
  const list = Object.values(state.units);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= dist) continue;
      const push = (dist - d) * 0.35;
      if (d < 1e-4) {
        const ang = (a.id * 2.399) % (Math.PI * 2);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      const pa = pushable(a);
      const pb = pushable(b);
      if (pa) nudge(state, blocked, a, -nx * push * (pb ? 1 : 2), -ny * push * (pb ? 1 : 2));
      if (pb) nudge(state, blocked, b, nx * push * (pa ? 1 : 2), ny * push * (pa ? 1 : 2));
    }
  }
}

function nudge(state: GameState, blocked: Uint8Array, u: Unit, dx: number, dy: number) {
  const nx = Math.max(0.1, Math.min(state.width - 0.1, u.x + dx));
  const ny = Math.max(0.1, Math.min(state.height - 0.1, u.y + dy));
  if (isWalkable(blocked, state.width, state.height, Math.floor(nx), Math.floor(ny))) {
    u.x = nx;
    u.y = ny;
  }
}
