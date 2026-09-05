// Print what is inside a .glb: meshes with triangle counts, materials, textures,
// skins and animation clips. Handy before wiring a third-party model into the tree.
//
//   bun tools/models/inspect.ts path/to/model.glb [...more]

import { readFileSync } from 'node:fs';

interface Gltf {
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[] }[];
  meshes?: {
    name?: string;
    primitives: { indices?: number; attributes: Record<string, number>; material?: number }[];
  }[];
  accessors?: { count: number; type: string }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: object; baseColorFactor?: number[] } }[];
  textures?: object[];
  images?: { name?: string; uri?: string; mimeType?: string }[];
  skins?: { name?: string; joints: number[] }[];
  animations?: { name?: string; channels: object[]; samplers: { input: number }[] }[];
}

function readGlbJson(file: string): Gltf {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) {
    return JSON.parse(buf.toString('utf8')) as Gltf; // plain .gltf
  }
  const jsonLen = dv.getUint32(12, true);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
}

export function describe(file: string): string {
  const g = readGlbJson(file);
  const acc = g.accessors ?? [];
  const lines: string[] = [file];
  let total = 0;
  for (const m of g.meshes ?? []) {
    let tris = 0;
    for (const p of m.primitives) {
      const n = p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count;
      tris += n / 3;
    }
    total += tris;
    const skinned = m.primitives.some((p) => 'JOINTS_0' in p.attributes);
    lines.push(
      `  mesh ${m.name ?? '?'}: ${tris} tris, ${m.primitives.length} primitive(s)${skinned ? ', skinned' : ''}`,
    );
  }
  lines.push(`  total ${total} tris, ${g.nodes?.length ?? 0} nodes`);
  lines.push(
    `  materials: ${(g.materials ?? []).map((m) => `${m.name ?? '?'}${m.pbrMetallicRoughness?.baseColorTexture ? '(tex)' : ''}`).join(', ') || 'none'}`,
  );
  lines.push(`  images: ${(g.images ?? []).map((i) => i.name ?? i.uri ?? i.mimeType ?? '?').join(', ') || 'none'}`);
  for (const s of g.skins ?? []) lines.push(`  skin ${s.name ?? '?'}: ${s.joints.length} joints`);
  for (const a of g.animations ?? []) {
    const len = Math.max(...a.samplers.map((s) => acc[s.input].count));
    lines.push(`  animation ${a.name ?? '?'}: ${a.channels.length} channels, ${len} keys`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  for (const f of process.argv.slice(2)) console.log(describe(f));
}
