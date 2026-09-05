// Minimal glTF 2.0 binary writer for flat-shaded, vertex-per-face low-poly
// meshes: one mesh, one primitive per material, positions + indices only
// (loaders compute flat normals because no vertex is shared between faces).
// No dependencies; runs under Bun.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Material {
  name: string;
  color: [number, number, number]; // linear RGB 0..1
}

/** Triangles of one material, as flat arrays. */
export class Part {
  positions: number[] = [];
  indices: number[] = [];
  constructor(readonly material: Material) {}

  /** Add a triangle (counter-clockwise seen from outside). */
  tri(a: Vec3, b: Vec3, c: Vec3) {
    const base = this.positions.length / 3;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.indices.push(base, base + 1, base + 2);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  get triangles() {
    return this.indices.length / 3;
  }
}

function align4(n: number) {
  return (n + 3) & ~3;
}

export function writeGlb(name: string, parts: Part[]): Uint8Array {
  const used = parts.filter((p) => p.indices.length);
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const primitives: object[] = [];
  const materials = used.map((p) => ({
    name: p.material.name,
    pbrMetallicRoughness: { baseColorFactor: [...p.material.color, 1], metallicFactor: 0, roughness: 1 },
    doubleSided: false,
  }));
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array, target: number) => {
    const padded = align4(bytes.byteLength);
    const buf = new Uint8Array(padded);
    buf.set(bytes);
    chunks.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += padded;
    return bufferViews.length - 1;
  };

  used.forEach((p, i) => {
    const pos = new Float32Array(p.positions);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3)
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], pos[k + c]);
        max[c] = Math.max(max[c], pos[k + c]);
      }
    const idx = new Uint32Array(p.indices);
    const posView = push(new Uint8Array(pos.buffer), 34962);
    const idxView = push(new Uint8Array(idx.buffer), 34963);
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: idxView, componentType: 5125, count: idx.length, type: 'SCALAR' });
    primitives.push({
      attributes: { POSITION: accessors.length - 2 },
      indices: accessors.length - 1,
      material: i,
      mode: 4,
    });
  });

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }

  const json = {
    asset: { version: '2.0', generator: 'odal tools/models' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonBytes.byteLength)).fill(0x20);
  jsonPadded.set(jsonBytes);

  const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPadded.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonPadded, 20);
  const binStart = 20 + jsonPadded.byteLength;
  dv.setUint32(binStart, bin.byteLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // BIN
  out.set(bin, binStart + 8);
  return out;
}

// ---------------------------------------------------------------------------
// Primitive builders. All take a Part, build in local space, and apply an
// optional transform (scale, rotation about Y/Z/X in radians, translation).
// ---------------------------------------------------------------------------

export interface Xf {
  s?: Vec3 | number;
  rx?: number;
  ry?: number;
  rz?: number;
  t?: Vec3;
}

export function apply(p: Vec3, xf: Xf = {}): Vec3 {
  let { x, y, z } = p;
  const s = typeof xf.s === 'number' ? { x: xf.s, y: xf.s, z: xf.s } : (xf.s ?? { x: 1, y: 1, z: 1 });
  x *= s.x;
  y *= s.y;
  z *= s.z;
  if (xf.rx) {
    const c = Math.cos(xf.rx),
      n = Math.sin(xf.rx);
    [y, z] = [y * c - z * n, y * n + z * c];
  }
  if (xf.ry) {
    const c = Math.cos(xf.ry),
      n = Math.sin(xf.ry);
    [x, z] = [x * c + z * n, -x * n + z * c];
  }
  if (xf.rz) {
    const c = Math.cos(xf.rz),
      n = Math.sin(xf.rz);
    [x, y] = [x * c - y * n, x * n + y * c];
  }
  const t = xf.t ?? { x: 0, y: 0, z: 0 };
  return { x: x + t.x, y: y + t.y, z: z + t.z };
}

/** Axis-aligned box centred at origin, size 1, optionally tapered: top face scaled by `taper` in x/z. */
export function box(part: Part, xf: Xf = {}, taper = 1) {
  const v = (x: number, y: number, z: number) =>
    apply({ x: x * (y > 0 ? taper : 1), y, z: z * (y > 0 ? taper : 1) }, xf);
  const h = 0.5;
  const p000 = v(-h, -h, -h),
    p100 = v(h, -h, -h),
    p110 = v(h, h, -h),
    p010 = v(-h, h, -h);
  const p001 = v(-h, -h, h),
    p101 = v(h, -h, h),
    p111 = v(h, h, h),
    p011 = v(-h, h, h);
  part.quad(p001, p101, p111, p011); // front (+z)
  part.quad(p100, p000, p010, p110); // back
  part.quad(p000, p001, p011, p010); // left
  part.quad(p101, p100, p110, p111); // right
  part.quad(p010, p011, p111, p110); // top
  part.quad(p000, p100, p101, p001); // bottom
}

/** Cylinder along Y from -0.5 to 0.5, radius 0.5 at bottom, `topR` at top, `n` segments. */
export function cylinder(part: Part, n = 6, xf: Xf = {}, topR = 0.5, botR = 0.5) {
  const ring = (y: number, r: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      return apply({ x: Math.cos(a) * r, y, z: Math.sin(a) * r }, xf);
    });
  const bot = ring(-0.5, botR);
  const top = ring(0.5, topR);
  const cb = apply({ x: 0, y: -0.5, z: 0 }, xf);
  const ct = apply({ x: 0, y: 0.5, z: 0 }, xf);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    part.quad(bot[j], bot[i], top[i], top[j]);
    if (botR > 0) part.tri(cb, bot[i], bot[j]);
    if (topR > 0) part.tri(ct, top[j], top[i]);
  }
}

/** Cone along Y: base radius 0.5 at y=-0.5, apex at y=0.5. */
export function cone(part: Part, n = 8, xf: Xf = {}) {
  cylinder(part, n, xf, 0, 0.5);
}

/** UV sphere of radius 0.5 with `seg` around and `rings` vertical bands. Low values look pleasantly chunky. */
export function sphere(part: Part, seg = 8, rings = 6, xf: Xf = {}) {
  const pt = (i: number, j: number) => {
    const phi = (j / rings) * Math.PI;
    const th = (i / seg) * Math.PI * 2 + Math.PI / seg;
    return apply(
      { x: Math.sin(phi) * Math.cos(th) * 0.5, y: Math.cos(phi) * 0.5, z: Math.sin(phi) * Math.sin(th) * 0.5 },
      xf,
    );
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      const a = pt(i, j),
        b = pt(i2, j),
        c = pt(i2, j + 1),
        d = pt(i, j + 1);
      if (j === 0) part.tri(a, d, c);
      else if (j === rings - 1) part.tri(a, b, d);
      else part.quad(a, b, c, d);
    }
  }
}

/**
 * Chamfered box: a unit box whose edges and corners are cut back by `c` (0..0.5), so it
 * reads as rounded under flat shading. 6 faces + 12 edge strips + 8 corner triangles = 44 tris.
 * Winding is derived from the centroid, so callers need not think about it.
 */
export function rbox(part: Part, xf: Xf = {}, c = 0.1, taper = 1) {
  const h = 0.5;
  const k = h - c;
  // Point of corner (sx,sy,sz) lying on the face perpendicular to `axis`.
  const P = (sx: number, sy: number, sz: number, axis: 0 | 1 | 2): Vec3 => ({
    x: sx * (axis === 0 ? h : k),
    y: sy * (axis === 1 ? h : k),
    z: sz * (axis === 2 ? h : k),
  });
  const faces: Vec3[][] = [];
  const signs = [-1, 1];
  // Main faces: for each axis and sign, the four corners in cyclic order over the other two axes.
  for (const axis of [0, 1, 2] as const) {
    const [b, d] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
    for (const s of signs) {
      const corner = (sb: number, sd: number) => {
        const v = [0, 0, 0];
        v[axis] = s;
        v[b] = sb;
        v[d] = sd;
        return P(v[0], v[1], v[2], axis);
      };
      faces.push([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
    }
  }
  // Edge strips: for each pair of axes (a,b) with fixed signs, along the third axis.
  for (const [a, b, e] of [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ] as const) {
    for (const sa of signs)
      for (const sb of signs) {
        const pt = (se: number, axis: 0 | 1 | 2) => {
          const v = [0, 0, 0];
          v[a] = sa;
          v[b] = sb;
          v[e] = se;
          return P(v[0], v[1], v[2], axis);
        };
        faces.push([pt(-1, a), pt(-1, b), pt(1, b), pt(1, a)]);
      }
  }
  // Corner triangles.
  for (const sx of signs)
    for (const sy of signs) for (const sz of signs) faces.push([P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2)]);

  for (const f of faces) {
    const [p0, p1, p2] = f;
    const u = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
    const v = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z };
    const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    const cx = f.reduce((s, p) => s + p.x, 0) / f.length;
    const cy = f.reduce((s, p) => s + p.y, 0) / f.length;
    const cz = f.reduce((s, p) => s + p.z, 0) / f.length;
    const ordered = n.x * cx + n.y * cy + n.z * cz < 0 ? [...f].reverse() : f;
    const w = ordered.map((p) => apply({ x: p.x * (p.y > 0 ? taper : 1), y: p.y, z: p.z * (p.y > 0 ? taper : 1) }, xf));
    if (w.length === 3) part.tri(w[0], w[1], w[2]);
    else part.quad(w[0], w[1], w[2], w[3]);
  }
}
