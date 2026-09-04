import type { Vec2 } from '@odal/engine';
import type { Renderer } from './render/scene';
import type { World } from './world';

// ---------------------------------------------------------------------------
// Minimap drawing. The React Minimap component owns the <canvas>; this module
// owns what is drawn on it (like the renderer owns the 3D canvas).
// ---------------------------------------------------------------------------

const GROUND: [number, number, number] = [75, 122, 52];
let image: ImageData | null = null;
let scratch: HTMLCanvasElement | null = null;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  world: World,
  renderer: Renderer | null,
) {
  const st = world.state;
  if (!st) {
    ctx.fillStyle = '#2f4d24';
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
  const w = st.width;
  const h = st.height;
  if (!image || image.width !== w || image.height !== h) {
    image = new ImageData(w, h);
    scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
  }
  const px = image.data;
  const { vision, explored } = world;
  const nodeColors: Record<string, [number, number, number]> = {};
  for (const n of st.tree.nodes) nodeColors[n.id] = hexToRgb(n.visual.color);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    px[o] = GROUND[0];
    px[o + 1] = GROUND[1];
    px[o + 2] = GROUND[2];
    px[o + 3] = 255;
  }
  for (const id in st.nodes) {
    const n = st.nodes[id];
    const i = n.y * w + n.x;
    if (explored && !explored[i]) continue;
    const o = i * 4;
    const col = nodeColors[n.type] ?? GROUND;
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
  }
  if (vision && explored) {
    for (let i = 0; i < w * h; i++) {
      const dim = vision[i] ? 1 : explored[i] ? 0.55 : 0.12;
      if (dim === 1) continue;
      const o = i * 4;
      px[o] *= dim;
      px[o + 1] *= dim;
      px[o + 2] *= dim;
    }
  }
  scratch!.getContext('2d')!.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch!, 0, 0, cw, ch);

  const sx = cw / w;
  const sy = ch / h;
  const buildings = world.renderBuildings();
  for (const id in buildings) {
    const b = buildings[id];
    ctx.fillStyle = st.players[b.owner]?.color ?? '#fff';
    ctx.globalAlpha = st.buildings[id] ? 1 : 0.5;
    ctx.fillRect(b.x * sx - 1, b.y * sy - 1, b.w * sx + 2, b.h * sy + 2);
  }
  ctx.globalAlpha = 1;
  for (const id in st.units) {
    const u = st.units[id];
    ctx.fillStyle = st.players[u.owner]?.color ?? '#fff';
    ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 3, 3);
  }
  if (renderer) {
    const vw = 30 * renderer.zoom;
    const vh = 18 * renderer.zoom;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect((renderer.camTarget.x - vw / 2) * sx, (renderer.camTarget.y - vh / 2) * sy, vw * sx, vh * sy);
  }
}

/** Map a 0..1 minimap position to world coordinates. */
export function minimapToWorld(world: World, x01: number, y01: number): Vec2 | null {
  const st = world.state;
  if (!st) return null;
  return { x: x01 * st.width, y: y01 * st.height };
}
