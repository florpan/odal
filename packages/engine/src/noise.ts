// ---------------------------------------------------------------------------
// Seeded 2D value noise for map generation: a lattice of pseudo-random values
// blended with smoothstep, two octaves. Deterministic for a seed, and pure
// integer hashing so every platform generates the same map.
// ---------------------------------------------------------------------------

/** A pseudo-random value in [0, 1) for a lattice point. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise in [0, 1) with features about `scale` units across. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Two octaves: broad shapes plus finer detail at half the scale and weight. */
export function terrainNoise(x: number, y: number, scale: number, seed: number): number {
  return (valueNoise(x, y, scale, seed) * 2 + valueNoise(x, y, scale / 2, seed + 1)) / 3;
}
