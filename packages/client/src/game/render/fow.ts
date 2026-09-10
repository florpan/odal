import * as THREE from 'three';
import { worldToHex } from '@odal/engine';
import type { Vec2 } from '@odal/engine';

// ---------------------------------------------------------------------------
// Fog of war, drawn by the materials themselves. Every fogged material samples
// a map-sized alpha texture at its fragment's world x/z and mixes towards the
// fog colour, so the darkening sits exactly on the ground, trees and buildings
// it belongs to at any camera angle. (A translucent sheet above the board was
// tried first: from the game camera it is crossed a hex or two nearer than the
// ground it should cover, and the edge of the known world stood out.)
//
// The texture has FOG_RES texels per world unit, each knowing the hex under it
// (so odd rows land where they are), and is blurred on the CPU so hex steps
// become a soft gradient. The whole board is always drawn and unexplored ground
// is simply under full fog, so the mist runs to the map edge: nothing ends at a
// hex edge. The texture carries FOG_PAD world units of full fog around the map,
// so the plain the board stands on (scene.ts) samples full fog everywhere off
// the board and the rim blends like any other edge; with the scene's distance
// fog fading everything into the sky's horizon, nothing outlines the map.
//
// Tuning: the constants below. Editing this file makes Vite reload the page
// (game modules are not hot-swapped), so rejoin the room afterwards.
// ---------------------------------------------------------------------------

/**
 * Fog colour and scene background as display bytes (sRGB): a pale mist near the atlas' linen, a shade
 * cooler than the sky's horizon (scene.ts HORIZON_COLOR). Keep minimap.ts UNEXPLORED in step.
 */
export const FOG_COLOR = { r: 230, g: 226, b: 212 };
/** Texels per world unit. At 4 a hex is 4×3.5 texels, enough for the blur to round its corners. */
const FOG_RES = 4;
/**
 * Box blur radius in texels; three passes approximate a Gaussian whose reach is 3 × FOG_BLUR texels
 * (1.5 world units), about a hex and a half of mist between explored ground and the unexplored.
 */
const FOG_BLUR = 2;
/** World units of full fog around the map in the texture; at least the blur's reach, so the rim fades out fully. */
const FOG_PAD = 2;
/** How much of the fog colour each level shows: visible, explored, unexplored (0..255). */
const FOG_ALPHA = [0, 96, 255];

export const FogLevel = { Visible: 0, Explored: 1, Unexplored: 2 } as const;
export type FogLevel = (typeof FogLevel)[keyof typeof FogLevel];

const VERT_UNIFORMS = 'uniform vec2 fowSize;\nuniform float fowPad;\nvarying vec2 vFowUv;';
const VERT_BODY = `
vec4 fowWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fowWorld = instanceMatrix * fowWorld;
#endif
fowWorld = modelMatrix * fowWorld;
vFowUv = vec2( ( fowWorld.x + fowPad ) / fowSize.x, 1.0 - ( fowWorld.z + fowPad ) / fowSize.y );`;
const FRAG_UNIFORMS = 'uniform sampler2D fowMap;\nuniform vec3 fowColor;\nvarying vec2 vFowUv;';
const FRAG_BODY = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fowColor, texture2D( fowMap, vFowUv ).r );';

export class FogOfWar {
  /** Per hex: the last FogLevel computed, so an update that changes nothing uploads nothing. */
  level = new Uint8Array(0);
  private cols = 0;
  private rows = 0;
  private tex: THREE.DataTexture | null = null;
  private data = new Uint8Array(0);
  private w = 0;
  private h = 0;
  /** Per texel: index of the hex under it, or -1 outside the map. */
  private hexOf = new Int32Array(0);
  private a = new Float32Array(0);
  private b = new Float32Array(0);
  /** Shared by reference with every compiled shader, so a new map's texture reaches them all. */
  private uniforms = {
    fowMap: { value: null as THREE.Texture | null },
    /** World size the texture covers (map plus padding) and the padding on each side. */
    fowSize: { value: new THREE.Vector2(1, 1) },
    fowPad: { value: FOG_PAD },
    // Raw components on purpose: the mix runs in display space (after colorspace_fragment), so the
    // shader wants the sRGB bytes as they are, not converted to linear.
    fowColor: { value: new THREE.Color(FOG_COLOR.r / 255, FOG_COLOR.g / 255, FOG_COLOR.b / 255) },
  };

  /** Make `material` mix towards the fog colour by the fog at its world position. Safe to call twice. */
  apply(material: THREE.Material) {
    if (material.userData.fow) return;
    material.userData.fow = true;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_UNIFORMS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>${VERT_BODY}`);
      // fog_fragment comes after tone mapping and the colour-space conversion, so the mix happens in
      // display space and FOG_COLOR comes out exactly as the clear colour does. It goes before the
      // distance fog, which three also applies in display space: far fogged ground then fades into
      // the horizon like everything else instead of staying flat FOG_COLOR to the far plane.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_UNIFORMS}`)
        .replace('#include <fog_fragment>', `${FRAG_BODY}\n#include <fog_fragment>`);
    };
    material.customProgramCacheKey = () => 'fow';
    material.needsUpdate = true;
  }

  /** A new map: size the texture and forget every level. */
  setMap(cols: number, rows: number, size: Vec2) {
    this.tex?.dispose();
    this.cols = cols;
    this.rows = rows;
    this.level = new Uint8Array(cols * rows).fill(255); // no level yet: the first update always uploads
    const padW = size.x + 2 * FOG_PAD;
    const padH = size.y + 2 * FOG_PAD;
    const w = (this.w = Math.ceil(padW * FOG_RES));
    const h = (this.h = Math.ceil(padH * FOG_RES));
    this.data = new Uint8Array(w * h).fill(255);
    this.a = new Float32Array(w * h);
    this.b = new Float32Array(w * h);
    this.hexOf = new Int32Array(w * h);
    for (let ty = 0; ty < h; ty++) {
      const wy = padH * (1 - (ty + 0.5) / h) - FOG_PAD; // texture rows run bottom-up (see VERT_BODY)
      for (let tx = 0; tx < w; tx++) {
        const t = worldToHex({ x: padW * ((tx + 0.5) / w) - FOG_PAD, y: wy });
        this.hexOf[ty * w + tx] = t.x < 0 || t.y < 0 || t.x >= cols || t.y >= rows ? -1 : t.y * cols + t.x;
      }
    }
    const tex = new THREE.DataTexture(this.data, w, h, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.tex = tex;
    this.uniforms.fowMap.value = tex;
    this.uniforms.fowSize.value.set(padW, padH);
  }

  /**
   * Recompute levels from the player's vision and charted ground (explored, or all of it after
   * Cartography) and upload the blurred texture. Returns false when no hex changed level (then `level`
   * is untouched and nothing was uploaded).
   */
  update(vision: Uint8Array | null, charted: Uint8Array | null): boolean {
    if (!this.tex) return false;
    const { cols, rows, level } = this;
    const n = cols * rows;

    let changed = false;
    for (let i = 0; i < n; i++) {
      const l: FogLevel =
        !vision || !charted
          ? FogLevel.Unexplored
          : vision[i]
            ? FogLevel.Visible
            : charted[i]
              ? FogLevel.Explored
              : FogLevel.Unexplored;
      if (level[i] !== l) changed = true;
      level[i] = l;
    }
    if (!changed) return false;

    // Rasterise per texel, blur, upload.
    const { w, h, hexOf, data, a, b } = this;
    for (let t = 0; t < w * h; t++) {
      const i = hexOf[t];
      a[t] = i < 0 ? 255 : FOG_ALPHA[level[i]];
    }
    for (let pass = 0; pass < 3; pass++) {
      boxBlurX(a, b, w, h, FOG_BLUR);
      boxBlurY(b, a, w, h, FOG_BLUR);
    }
    for (let t = 0; t < w * h; t++) data[t] = a[t];
    this.tex.needsUpdate = true;
    return true;
  }

  dispose() {
    this.tex?.dispose();
    this.tex = null;
  }
}

/** Horizontal box blur with a running sum, edges clamped. `dst` gets the result. */
function boxBlurX(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * k;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}

/** Vertical counterpart of boxBlurX. */
function boxBlurY(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * k;
      sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}
