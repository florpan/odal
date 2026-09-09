// ---------------------------------------------------------------------------
// Ground picking over a stepped heightfield. A flat plane at y = 0 is wrong
// once tiles rise with the relief: from a low camera the ray sails over the
// raised tile under the cursor and only meets the plane far behind it (six
// hexes off at the lowest tilt). So walk the ray from the highest possible
// ground down to the lowest and stop where it first dips below the tile top
// there. Pure math, no Three, so it can be tested with a synthetic terrain.
// ---------------------------------------------------------------------------

export interface Ray3 {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * First point along `ray` that is on or under the ground given by `groundY(x, z)`, searched between the
 * heights `top` (nothing is higher) and `bottom` (nothing is lower). Returns the point on the tile top
 * itself when the ray hits inside that tile, otherwise the last sampled point, `step` apart. Null for a
 * ray that does not descend or never reaches `bottom`.
 */
export function marchGround(
  ray: Ray3,
  groundY: (x: number, z: number) => number,
  top: number,
  bottom: number,
  step = 0.1,
): { x: number; y: number; z: number } | null {
  const { ox, oy, oz, dx, dy, dz } = ray;
  if (dy >= 0) return null;
  const at = (t: number) => ({ x: ox + dx * t, y: oy + dy * t, z: oz + dz * t });
  const t0 = Math.max(0, (top - oy) / dy);
  const t1 = (bottom - oy) / dy;
  if (t1 < t0) return null;
  // Sample in ground-plane distance, not ray length, so the step stays a fraction of a hex at any tilt.
  const horizontal = Math.hypot(dx, dz) || 1e-9;
  const dt = step / horizontal;
  for (let t = t0; t <= t1; t += dt) {
    const p = at(t);
    const h = groundY(p.x, p.z);
    if (p.y > h) continue;
    // Below this tile's top: the exact hit is where the ray crosses that height, if still on the same tile.
    const q = at((h - oy) / dy);
    return groundY(q.x, q.z) === h ? q : p;
  }
  return at(t1);
}
