import { hexCentre, worldSize } from '@odal/engine';
import type { Vec2 } from '@odal/engine';
import type { Renderer } from './render/scene';
import type { World } from './world';

// ---------------------------------------------------------------------------
// Minimap drawing. The React Minimap component owns the <canvas>; this module
// owns what is drawn on it (like the renderer owns the 3D canvas).
// ---------------------------------------------------------------------------

const UNEXPLORED: [number, number, number] = [13, 18, 11];
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
  const terrainColors = st.tree.terrain.map((t) => hexToRgb(t.visual.color));

  // Terrain where explored, nothing where not: the island's shape is something to discover.
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const col = explored && !explored[i] ? UNEXPLORED : terrainColors[st.terrain[i]];
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
    px[o + 3] = 255;
  }
  for (const id in st.nodes) {
    const n = st.nodes[id];
    const i = n.y * w + n.x;
    if (explored && !explored[i]) continue;
    const o = i * 4;
    const col = nodeColors[n.type] ?? terrainColors[st.terrain[i]];
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
  }
  if (vision && explored) {
    for (let i = 0; i < w * h; i++) {
      if (vision[i] || !explored[i]) continue;
      const o = i * 4;
      px[o] *= 0.55;
      px[o + 1] *= 0.55;
      px[o + 2] *= 0.55;
    }
  }
  scratch!.getContext('2d')!.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch!, 0, 0, cw, ch);

  const size = worldSize(w, h);
  const sx = cw / size.x;
  const sy = ch / size.y;
  const buildings = world.renderBuildings();
  for (const id in buildings) {
    const b = buildings[id];
    const c = hexCentre(b.x, b.y);
    const half = (b.r + 0.5) * sx + 1;
    ctx.fillStyle = st.players[b.owner]?.color ?? '#fff';
    ctx.globalAlpha = st.buildings[id] ? 1 : 0.5;
    ctx.fillRect(c.x * sx - half, c.y * sy - half, half * 2, half * 2);
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
  const size = worldSize(st.width, st.height);
  return { x: x01 * size.x, y: y01 * size.y };
}
