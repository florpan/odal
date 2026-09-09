import { hexCentre, worldSize } from '@odal/engine';
import type { Building, Vec2 } from '@odal/engine';
import type { Renderer } from './render/scene';
import type { World } from './world';

// ---------------------------------------------------------------------------
// The minimap is a radar: a fixed-scale window centred on the camera, not a
// chart of the world. Unexplored ground and the void beyond the map are the
// same slate, so the window never tells you where on the map you are; you
// learn that by scouting (or, later, by researching Cartography). A flag marks
// your town hall and sits on the rim pointing home when home is out of view.
// The React Minimap component owns the <canvas>; this module owns what is
// drawn on it. Everything goes through `toCanvas`, so a camera yaw can turn
// the radar later by changing that one function.
// ---------------------------------------------------------------------------

/** World units across the canvas. Fixed on purpose: the radar does not follow the camera zoom. */
export const RADAR_SPAN = 44;
/** Same slate as the renderer's fog (render/fow.ts FOG_COLOR). */
const UNEXPLORED: [number, number, number] = [28, 36, 40];
const SLATE = '#1c2428';
/** How close to the edge the home flag may sit before it is clamped to the rim. */
const RIM = 8;

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
  ctx.fillStyle = SLATE;
  ctx.fillRect(0, 0, cw, ch);
  const st = world.state;
  if (!st || !renderer) return;
  const cam = renderer.camTarget;
  const scale = cw / RADAR_SPAN; // canvas px per world unit
  // The radar turns with the camera: what is ahead on screen is up on the radar.
  const sinY = Math.sin(renderer.yaw);
  const cosY = Math.cos(renderer.yaw);
  const toCanvas = (wx: number, wy: number) => {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    return { x: cw / 2 + (dx * cosY - dy * sinY) * scale, y: ch / 2 + (dx * sinY + dy * cosY) * scale };
  };

  const w = st.width;
  const h = st.height;
  if (!image || image.width !== w || image.height !== h) {
    image = new ImageData(w, h);
    scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
  }
  const px = image.data;
  const { vision, charted } = world;
  const nodesKnown = world.nodesRevealed ? null : world.explored;
  const nodeColors: Record<string, [number, number, number]> = {};
  for (const n of st.tree.nodes) nodeColors[n.id] = hexToRgb(n.visual.color);
  const terrainColors = st.tree.terrain.map((t) => hexToRgb(t.visual.color));

  // Terrain where charted (explored, or the whole map after Cartography), slate where not. Higher
  // ground is drawn a little lighter.
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const col = charted && !charted[i] ? UNEXPLORED : terrainColors[st.terrain[i]];
    const lift = charted && !charted[i] ? 1 : 1 + 0.12 * (st.elevation[i] ?? 0);
    px[o] = Math.min(255, col[0] * lift);
    px[o + 1] = Math.min(255, col[1] * lift);
    px[o + 2] = Math.min(255, col[2] * lift);
    px[o + 3] = 255;
  }
  // Resources only where the ground was actually seen (charts do not show them).
  for (const id in st.nodes) {
    const n = st.nodes[id];
    const i = n.y * w + n.x;
    if (nodesKnown && !nodesKnown[i]) continue;
    const o = i * 4;
    const col = nodeColors[n.type] ?? terrainColors[st.terrain[i]];
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
  }
  if (vision && charted) {
    for (let i = 0; i < w * h; i++) {
      if (vision[i] || !charted[i]) continue;
      const o = i * 4;
      px[o] *= 0.55;
      px[o + 1] *= 0.55;
      px[o + 2] *= 0.55;
    }
  }
  scratch!.getContext('2d')!.putImageData(image, 0, 0);
  // One texel per hex, stretched over the map's world rectangle (odd rows' half-hex offset is ignored),
  // through the same turn as toCanvas.
  const size = worldSize(w, h);
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(renderer.yaw);
  ctx.scale(scale, scale);
  ctx.translate(-cam.x, -cam.y);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch!, 0, 0, size.x, size.y);
  ctx.restore();

  const buildings = world.renderBuildings();
  for (const id in buildings) {
    const b = buildings[id];
    const c = hexCentre(b.x, b.y);
    const p = toCanvas(c.x, c.y);
    const half = (b.r + 0.5) * scale + 1;
    ctx.fillStyle = st.players[b.owner]?.color ?? '#fff';
    ctx.globalAlpha = st.buildings[id] ? 1 : 0.5;
    ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
  }
  ctx.globalAlpha = 1;
  for (const id in st.units) {
    const u = st.units[id];
    const p = toCanvas(u.x, u.y);
    ctx.fillStyle = st.players[u.owner]?.color ?? '#fff';
    ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
  }

  // Home: a flag on the town hall, or on the rim in its direction when it is out of the window.
  const home = homeOf(world);
  if (home) {
    const c = hexCentre(home.x, home.y);
    let p = toCanvas(c.x, c.y);
    const dx = p.x - cw / 2;
    const dy = p.y - ch / 2;
    const k = Math.max(Math.abs(dx) / (cw / 2 - RIM), Math.abs(dy) / (ch / 2 - RIM));
    const clamped = k > 1;
    if (clamped) p = { x: cw / 2 + dx / k, y: ch / 2 + dy / k };
    drawFlag(ctx, p, st.players[home.owner]?.color ?? '#fff', clamped ? Math.atan2(dy, dx) : null);
  }

  // The camera's view: always in the middle, its size is the zoom.
  const vw = 30 * renderer.zoom * scale;
  const vh = 18 * renderer.zoom * scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cw / 2 - vw / 2, ch / 2 - vh / 2, vw, vh);
}

/** The player's own starting building, if it still stands. */
function homeOf(world: World): Building | null {
  const st = world.state;
  if (!st) return null;
  for (const id in st.buildings) {
    const b = st.buildings[id];
    if (b.owner === world.playerId && b.type === st.tree.start.building) return b;
  }
  return null;
}

/** A small pennant on a pole; with `pointing` (radians), a chevron in that direction beside it. */
function drawFlag(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, color: string, pointing: number | null) {
  ctx.strokeStyle = SLATE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x + 0.5, p.y + 1);
  ctx.lineTo(p.x + 0.5, p.y - 12);
  ctx.stroke();
  ctx.strokeStyle = '#fefcfa';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = SLATE;
  ctx.beginPath();
  ctx.moveTo(p.x + 1, p.y - 12);
  ctx.lineTo(p.x + 10, p.y - 9);
  ctx.lineTo(p.x + 1, p.y - 5);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  if (pointing !== null) {
    const ax = Math.cos(pointing);
    const ay = Math.sin(pointing);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x + ax * 4 - ay * 3, p.y + ay * 4 + ax * 3);
    ctx.lineTo(p.x + ax * 7, p.y + ay * 7);
    ctx.lineTo(p.x + ax * 4 + ay * 3, p.y + ay * 4 - ax * 3);
    ctx.stroke();
  }
}

/** Map a 0..1 minimap position to world coordinates (the window is centred on the camera). */
export function minimapToWorld(world: World, renderer: Renderer | null, x01: number, y01: number): Vec2 | null {
  const st = world.state;
  if (!st || !renderer) return null;
  const size = worldSize(st.width, st.height);
  const cam = renderer.camTarget;
  // Undo the radar's turn (the inverse of toCanvas in drawMinimap).
  const rx = (x01 - 0.5) * RADAR_SPAN;
  const ry = (y01 - 0.5) * RADAR_SPAN;
  const sinY = Math.sin(renderer.yaw);
  const cosY = Math.cos(renderer.yaw);
  return {
    x: Math.max(0, Math.min(size.x, cam.x + rx * cosY + ry * sinY)),
    y: Math.max(0, Math.min(size.y, cam.y - rx * sinY + ry * cosY)),
  };
}
