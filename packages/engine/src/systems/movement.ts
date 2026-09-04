import { blockedFor } from '../ctx';
import type { Ctx } from '../ctx';
import {
  adjacentTiles,
  findFreeTileNear,
  findPath,
  isAdjacentTo,
  isWalkable,
  nearestWalkableTile,
  tileOf,
} from '../grid';
import { unitSpeed } from '../queries';
import type { Unit } from '../types';

// ---------------------------------------------------------------------------
// Movement: walking units along A* paths. Other systems call goTo/goToAdjacent
// and react to the result; nothing else in the engine moves units.
// ---------------------------------------------------------------------------

export type GoResult = 'arrived' | 'moving' | 'unreachable';

/** Walk towards a tile, (re)computing the path when needed. */
export function goTo(ctx: Ctx, u: Unit, tx: number, ty: number): GoResult {
  const { state } = ctx;
  const blocked = blockedFor(ctx, u.owner);
  const { width: w, height: h } = state;

  // If the destination itself is blocked, aim for the nearest free tile around it.
  if (!isWalkable(blocked, w, h, tx, ty)) {
    const alt = findFreeTileNear(blocked, w, h, tx, ty, 1, 1, 3);
    if (!alt) return 'unreachable';
    tx = alt.x;
    ty = alt.y;
  }

  const cx = tx + 0.5;
  const cy = ty + 0.5;
  if (Math.hypot(u.x - cx, u.y - cy) < 0.05) {
    u.x = cx;
    u.y = cy;
    u.path = [];
    u.goal = null;
    return 'arrived';
  }

  if (!u.goal || u.goal.x !== tx || u.goal.y !== ty || u.path.length === 0) {
    const t = tileOf(u);
    const path = findPath(blocked, w, h, t.x, t.y, tx, ty);
    if (!path) {
      u.goal = null;
      u.path = [];
      return 'unreachable';
    }
    if (path.length === 0) path.push({ x: cx, y: cy });
    u.goal = { x: tx, y: ty };
    u.path = path;
  }

  let remaining = unitSpeed(ctx.tree, state.players[u.owner], u.type) * ctx.dt;
  while (remaining > 0 && u.path.length) {
    const wp = u.path[0];
    const dx = wp.x - u.x;
    const dy = wp.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= remaining) {
      u.x = wp.x;
      u.y = wp.y;
      u.path.shift();
      remaining -= d;
    } else {
      u.x += (dx / d) * remaining;
      u.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
  if (u.path.length === 0) {
    u.goal = null;
    return 'arrived';
  }
  return 'moving';
}

/** Walk until the unit's tile touches a rectangular footprint. */
export function goToAdjacent(ctx: Ctx, u: Unit, x: number, y: number, w: number, h: number): GoResult {
  if (isAdjacentTo(u, x, y, w, h)) {
    u.path = [];
    u.goal = null;
    return 'arrived';
  }
  const tile = nearestWalkableTile(
    blockedFor(ctx, u.owner),
    ctx.state.width,
    ctx.state.height,
    adjacentTiles(x, y, w, h),
    u,
  );
  if (!tile) return 'unreachable';
  const r = goTo(ctx, u, tile.x, tile.y);
  return r === 'arrived' ? (isAdjacentTo(u, x, y, w, h) ? 'arrived' : 'moving') : r;
}
