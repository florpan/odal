// The worker as a hand-built low-poly labourer: chunky proportions, oversized
// head, flat cap, tunic in the team colour under a leather apron, rolled-up
// sleeves, an axe over the shoulder and a hammer on the belt. Someone about
// to build or dig, not tied to farming.
// Height 1 unit = one tile; feet at y=0, facing +z. Flat shaded, chamfered edges, ~900 tris.
//
//   bun run model:worker      → packages/client/public/models/labourer.glb
//
// Kept as a reference; the game's worker.glb is the KayKit Rogue (kaykit_character.py).
// Materials are named so the client can recolour "Team" per player.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Part, box, cylinder, rbox, sphere, writeGlb } from './glb';
import type { Material } from './glb';

const M = {
  skin: { name: 'Skin', color: [0.87, 0.62, 0.45] } as Material,
  team: { name: 'Team', color: [0.8, 0.2, 0.18] } as Material,
  cloth: { name: 'Cloth', color: [0.85, 0.78, 0.6] } as Material,
  leather: { name: 'Leather', color: [0.42, 0.27, 0.15] } as Material,
  trousers: { name: 'Trousers', color: [0.3, 0.3, 0.34] } as Material,
  boots: { name: 'Boots', color: [0.2, 0.14, 0.1] } as Material,
  cap: { name: 'Cap', color: [0.25, 0.2, 0.16] } as Material,
  wood: { name: 'Wood', color: [0.55, 0.38, 0.2] } as Material,
  iron: { name: 'Iron', color: [0.5, 0.52, 0.55] } as Material,
  dark: { name: 'Dark', color: [0.08, 0.06, 0.05] } as Material,
};

export function buildWorker(): Part[] {
  const parts = Object.fromEntries(Object.entries(M).map(([k, m]) => [k, new Part(m)])) as Record<keyof typeof M, Part>;

  // Proportions (height ~1.0): boots 0.08, legs 0.22, torso 0.32, head 0.28, cap on top.
  const legY = 0.08;
  const torsoY = legY + 0.22;
  const headY = torsoY + 0.32 + 0.14;

  // Boots and legs
  for (const side of [-1, 1]) {
    const x = side * 0.08;
    rbox(parts.boots, { s: { x: 0.13, y: 0.08, z: 0.17 }, t: { x, y: 0.04, z: 0.02 } }, 0.2);
    rbox(parts.trousers, { s: { x: 0.12, y: 0.24, z: 0.13 }, t: { x, y: legY + 0.1, z: 0 } }, 0.12);
  }

  // Tunic in the team colour, slightly narrower at the shoulders.
  rbox(parts.team, { s: { x: 0.36, y: 0.32, z: 0.24 }, t: { x: 0, y: torsoY + 0.16, z: 0 } }, 0.14, 0.85);
  // Leather apron: a front panel from the belt to mid-chest, and a strap up to the neck.
  rbox(parts.leather, { s: { x: 0.24, y: 0.26, z: 0.035 }, t: { x: 0, y: torsoY + 0.13, z: 0.125 } }, 0.15, 0.8);
  box(parts.leather, { s: { x: 0.07, y: 0.1, z: 0.03 }, t: { x: 0, y: torsoY + 0.3, z: 0.115 } });
  // Belt with a pouch on the left hip.
  rbox(parts.dark, { s: { x: 0.37, y: 0.045, z: 0.25 }, t: { x: 0, y: torsoY + 0.05, z: 0 } }, 0.2);
  rbox(parts.leather, { s: { x: 0.08, y: 0.07, z: 0.05 }, t: { x: -0.13, y: torsoY + 0.02, z: 0.11 } }, 0.2);

  // Arms: short sleeves in the tunic colour, bare forearms, fists.
  for (const side of [-1, 1]) {
    const x = side * 0.21;
    const rz = side * -0.22;
    cylinder(parts.team, 8, { s: { x: 0.11, y: 0.13, z: 0.11 }, rz, t: { x, y: torsoY + 0.26, z: 0 } }, 0.5, 0.5);
    cylinder(
      parts.skin,
      8,
      { s: { x: 0.08, y: 0.14, z: 0.08 }, rz, t: { x: x + side * 0.03, y: torsoY + 0.13, z: 0 } },
      0.5,
      0.45,
    );
    sphere(parts.skin, 8, 5, { s: 0.1, t: { x: x + side * 0.045, y: torsoY + 0.05, z: 0 } });
  }

  // Head: big and a little squashed, nose, eyes.
  sphere(parts.skin, 12, 8, { s: { x: 0.3, y: 0.28, z: 0.3 }, t: { x: 0, y: headY, z: 0 } });
  rbox(parts.skin, { s: { x: 0.05, y: 0.05, z: 0.06 }, t: { x: 0, y: headY - 0.03, z: 0.155 } }, 0.25);
  for (const side of [-1, 1])
    box(parts.dark, { s: { x: 0.035, y: 0.05, z: 0.02 }, t: { x: side * 0.055, y: headY + 0.02, z: 0.135 } });

  // Flat cap: a squashed disc sitting on the head, pushed back a little, with a short peak in front.
  cylinder(parts.cap, 12, { s: { x: 0.34, y: 0.09, z: 0.34 }, t: { x: 0, y: headY + 0.1, z: -0.02 } }, 0.42, 0.5);
  rbox(parts.cap, { s: { x: 0.22, y: 0.025, z: 0.12 }, t: { x: 0, y: headY + 0.07, z: 0.14 } }, 0.2);

  // Axe over the right shoulder: handle from the fist up behind the head, blade at the top with
  // the edge pointing outwards (+x).
  const handX = 0.21 + 0.045;
  const tilt = -0.3;
  cylinder(parts.wood, 6, { s: { x: 0.035, y: 0.8, z: 0.035 }, rx: tilt, t: { x: handX, y: torsoY + 0.33, z: -0.08 } });
  // Head: a thin blade that flares towards the edge (+x), on a thicker neck at the handle.
  rbox(
    parts.iron,
    { s: { x: 0.14, y: 0.22, z: 0.045 }, rx: tilt, t: { x: handX + 0.1, y: torsoY + 0.7, z: -0.2 } },
    0.18,
  );
  rbox(
    parts.iron,
    { s: { x: 0.08, y: 0.1, z: 0.075 }, rx: tilt, t: { x: handX + 0.03, y: torsoY + 0.7, z: -0.2 } },
    0.2,
  );

  // Hammer hanging from the belt on the right hip: short handle, iron head.
  box(parts.wood, { s: { x: 0.03, y: 0.16, z: 0.03 }, t: { x: 0.16, y: torsoY - 0.03, z: 0.06 } });
  rbox(parts.iron, { s: { x: 0.05, y: 0.05, z: 0.1 }, t: { x: 0.16, y: torsoY + 0.06, z: 0.06 } }, 0.25);

  return Object.values(parts);
}

if (import.meta.main) {
  const parts = buildWorker();
  const glb = writeGlb('labourer', parts);
  const dir = join(import.meta.dir, '../../packages/client/public/models');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'labourer.glb');
  writeFileSync(file, glb);
  const tris = parts.reduce((s, p) => s + p.triangles, 0);
  console.log(
    `wrote ${file}: ${tris} triangles, ${parts.filter((p) => p.triangles).length} materials, ${glb.byteLength} bytes`,
  );
}
