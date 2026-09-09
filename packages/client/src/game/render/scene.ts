import * as THREE from 'three';
import { HEX_R, buildingMaxHp, hexCentre, hexNeighbours, idx, unitMaxHp, worldSize, worldToHex } from '@odal/engine';
import type {
  Building,
  GameState,
  ProjectileDef,
  RallyPoint,
  ResourceNode,
  Shot,
  TechTree,
  Unit,
  Vec2,
} from '@odal/engine';
import { FOG_COLOR, FogLevel, FogOfWar } from './fow';
import { ModelLibrary } from './models';
import type { HexAtlasSeason } from './models';
import { marchGround } from './pick';
import { tileOf } from './shore';

// ---------------------------------------------------------------------------
// The 3D scene. Everything in world coordinates is drawn here and nowhere
// else. Looks come from the tech tree's `visual` blocks, so new content
// renders without code changes. Game y maps to Three.js z. The ground is a
// board of hex tiles (see engine hex.ts); buildings and nodes sit on hex
// centres, units move freely.
// ---------------------------------------------------------------------------

/** Footprint radius → width of the disc a building covers, in world units. */
const footprintWidth = (radius: number) => 1 + 2 * radius;

/** Everything solid casts and receives the sun's shadow (bars, rings, fog and ghosts do not). */
const shadowed = (m: THREE.Object3D) => {
  m.castShadow = true;
  m.receiveShadow = true;
};
/** World units per elevation step (`state.elevation`). Land neighbours differ by one step, under TILE_WALL. */
const HEIGHT_STEP = 0.4;
/** Thickness of a KayKit ground tile: how much of a drop its own side covers before rock has to show. */
const TILE_WALL = 0.5;
/** Rock under tiles standing higher than a wall above a neighbour (cliffs at the sea): the atlas' stone. */
const PLINTH_COLOR = 0x4a5155;

export interface Pick {
  kind: 'unit' | 'building' | 'node';
  id: number;
}

const FLASH_TIME = 0.15;
const PARTICLE_LIFE = 0.7;
/** Camera tilt limits (radians above the ground) and the classic RTS angle it starts at. */
export const PITCH_MIN = 0.35;
export const PITCH_MAX = 1.45;
export const PITCH_DEFAULT = Math.atan2(0.85, 0.6);
/** KayKit's building colour variants and the hue each one stands for. */
const TEAM_HUES: Record<string, number> = { red: 0, yellow: 52, green: 120, blue: 215 };
const TEAM_VARIANTS = Object.keys(TEAM_HUES);

interface HpBar {
  group: THREE.Group;
  fg: THREE.Mesh;
}

interface EntityView {
  group: THREE.Group;
  /** The visible body: a primitive mesh, or a model instance (an Object3D with meshes below it). */
  body: THREE.Object3D;
  /** Meshes whose material is swapped for the damage flash, and what to restore afterwards. */
  meshes: THREE.Mesh[];
  mats: THREE.Material[];
  /** Model file still loading; swapped in by syncUnits / syncBuildings once ready. */
  wantModel?: string;
  /** Buildings: uniform scale applied to a one-hex model (the footprint's width in hexes). */
  modelScale?: number;
  /** Units: selection ring scale, from the unit's visual width. */
  ringScale?: number;
  /** Animation state for skinned models. `workClip` is what the task wants when standing still. */
  mixer?: THREE.AnimationMixer;
  clips?: Record<string, THREE.AnimationClip>;
  action?: THREE.AnimationAction;
  clip?: string;
  workClip: string;
  speed: number;
  bar: HpBar;
  barHeight: number;
  maxHp: number;
  lastHp: number;
  flashUntil: number;
  target: THREE.Vector3;
  color: string;
  carry?: THREE.Mesh;
  ghost?: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
}

/**
 * A shot in flight. The engine only says where it left from, what it is homing on and how far along
 * it is; the flight is drawn here as a parabola from `from` to the target's current drawn position,
 * advanced by the frame clock between snapshots (`t` is the snapshot's time, `elapsed` since then).
 */
interface ShotView {
  root: THREE.Object3D;
  from: THREE.Vector3;
  /** Where the target was last drawn, kept for the last frames after it dies or slips under fog. */
  to: THREE.Vector3;
  targetId: number;
  targetKind: 'unit' | 'building';
  /** Height above the target's feet the shot aims at: chest height on a person, halfway up a building. */
  toLift: number;
  t: number;
  duration: number;
  elapsed: number;
  arc: number;
  color: string;
  size: number;
  /** Model still loading; swapped in by syncShots once ready. */
  wantModel?: string;
}

/** Height above the ground a shot leaves from or aims at on a person (0.3 tall): chest height. */
const UNIT_SHOT_HEIGHT = 0.2;
/** Fallback launch height for a building whose view is not drawn (under fog): about a tower's top. */
const BUILDING_SHOT_HEIGHT = 0.8;

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private shadowHalf = 0;
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  camTarget: Vec2 = { x: 32, y: 32 };
  /** Camera distance factor (wheel). 0.2 shows about ten hexes across: a person and a house are readable. */
  zoom = 0.2;
  /** Camera orbit around the target: yaw in radians (0 = north up, the camera south of the target), pitch from the ground. */
  yaw = 0;
  pitch = PITCH_DEFAULT;
  /** Map size in world units (for camera clamping and ground picking). */
  mapW = 64;
  mapH = 64;
  /** Map size in hexes (columns, rows). */
  private cols = 64;
  private rows = 64;

  private models: ModelLibrary;
  private nodeMeshes = new Map<number, THREE.Object3D>();
  private units = new Map<number, EntityView>();
  private buildings = new Map<number, EntityView>();
  private shots = new Map<number, ShotView>();
  private rings = new Map<string, THREE.Mesh>();
  private particles: Particle[] = [];
  private selectedUnits = new Set<number>();
  private selectedBuilding: number | null = null;
  private ghost: THREE.Mesh | null = null;
  private rallyMarker: THREE.Group | null = null;
  /** Ground tiles, one InstancedMesh per tile file (or per terrain while its file loads). */
  private ground: { mesh: THREE.InstancedMesh }[] = [];
  private mapState: GameState | null = null;
  /** Per hex: 1 when its ground tile is shown (explored). Unexplored hexes are not drawn at all. */
  private shown: Uint8Array | null = null;
  /** Per hex: which ground part and instance slot, its rotation, and the y of its top (`visual.height`). */
  private tilePart: Int16Array | null = null;
  private tileSlot: Int32Array | null = null;
  private tileRot: Float32Array | null = null;
  private tileTop: Float32Array | null = null;
  /** Highest and lowest tile top on the map, the band ground picking searches. */
  private tileTopMax = 0;
  private tileTopMin = 0;
  /** Per hex: instance slot in the plinth mesh (-1 none), and the plinth's bottom and height. */
  private plinthSlot: Int32Array | null = null;
  private plinthBase: Float32Array | null = null;
  private plinthHeight: Float32Array | null = null;
  private plinths: THREE.InstancedMesh | null = null;
  /** Fog of war: every fogged material samples it at its world position (render/fow.ts). */
  private fow = new FogOfWar();
  private raycaster = new THREE.Raycaster();
  private materials = new Map<string, THREE.MeshLambertMaterial>();
  private geometries = new Map<string, THREE.BufferGeometry>();
  private resize: ResizeObserver;
  private time = 0;

  private geo = {
    head: new THREE.BoxGeometry(0.3, 0.22, 0.3),
    carry: new THREE.BoxGeometry(0.28, 0.28, 0.28),
    cone: new THREE.ConeGeometry(0.45, 1.3, 7),
    rock: new THREE.DodecahedronGeometry(0.38, 0),
    ring: new THREE.RingGeometry(0.42, 0.52, 28),
    particle: new THREE.BoxGeometry(0.16, 0.16, 0.16),
    /** One ground tile: a flat hex puck, slightly smaller than the cell so the board shows its seams. */
    tile: new THREE.CylinderGeometry(HEX_R * 0.96, HEX_R * 0.96, 0.12, 6),
    /** A unit-height hex prism, scaled to footprint and height (ghost, building plates). */
    hex: new THREE.CylinderGeometry(HEX_R, HEX_R, 1, 6),
  };
  // Markers use the atlas too (ui/theme.css has the same values): gold for selection, grass and red
  // for the build ghost, slate behind the health bars.
  // Not tone mapped: they are UI, and AgX would wash the gold to beige.
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xfbd365, side: THREE.DoubleSide, toneMapped: false });
  private ghostOk = new THREE.MeshBasicMaterial({
    color: 0xaacd61,
    transparent: true,
    opacity: 0.45,
    toneMapped: false,
  });
  private ghostBad = new THREE.MeshBasicMaterial({
    color: 0xd83f35,
    transparent: true,
    opacity: 0.45,
    toneMapped: false,
  });
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private barBg = new THREE.MeshBasicMaterial({ color: 0x1c2428, depthTest: false, toneMapped: false });
  private barGreen = new THREE.MeshBasicMaterial({ color: 0x7cab48, depthTest: false, toneMapped: false });
  private barYellow = new THREE.MeshBasicMaterial({ color: 0xfbd365, depthTest: false, toneMapped: false });
  private barRed = new THREE.MeshBasicMaterial({ color: 0xd83f35, depthTest: false, toneMapped: false });

  constructor(canvas: HTMLCanvasElement, opts: { atlas?: HexAtlasSeason } = {}) {
    this.canvas = canvas;
    this.models = new ModelLibrary(opts.atlas, (m) => this.fow.apply(m));
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    // AgX is Blender's default view transform: the KayKit atlas reads the same here as in Blender
    // (soft, slightly desaturated highlights) instead of clipping to full-saturation lime and red.
    this.gl.toneMapping = THREE.AgXToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    // Same as unexplored fog, so the map edge stays invisible (until a skybox takes over). FOG_COLOR is
    // display bytes, so say so: three would otherwise take the components as linear and clear brighter.
    this.scene.background = new THREE.Color().setRGB(
      FOG_COLOR.r / 255,
      FOG_COLOR.g / 255,
      FOG_COLOR.b / 255,
      THREE.SRGBColorSpace,
    );
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3d5a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); // neutral: colour comes from the models, not the light
    sun.position.set(20, 40, 10);
    // One shadow map that follows the camera target (update()); its extent tracks the zoom so the
    // texels stay fine when close and the whole view is still covered when far.
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.fit();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas.parentElement ?? canvas);
  }

  private fit() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
  }

  /** Free GPU resources and listeners. The canvas element itself belongs to React. */
  dispose() {
    this.resize.disconnect();
    this.reset();
    this.gl.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.models.dispose();
    this.fow.dispose();
  }

  /** Remove every game object (new game / restart). Map is rebuilt by setMap. */
  reset() {
    for (const m of this.nodeMeshes.values()) this.scene.remove(m);
    for (const v of this.units.values()) this.scene.remove(v.group);
    for (const v of this.buildings.values()) this.scene.remove(v.group);
    for (const s of this.shots.values()) this.scene.remove(s.root);
    for (const r of this.rings.values()) this.scene.remove(r);
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.nodeMeshes.clear();
    this.units.clear();
    this.buildings.clear();
    this.shots.clear();
    this.rings.clear();
    this.particles = [];
    this.setGhost(null);
    this.setRallyMarker(null);
  }

  /**
   * Build the board for a map: one ground tile per hex, from the terrain's GLB tile (or its shore
   * variant along the coast) once loaded, a flat coloured hex puck until then. Tiles are hidden
   * (scale 0) and appear as the player explores (updateFog).
   */
  setMap(state: GameState) {
    const cols = state.width;
    const rows = state.height;
    this.cols = cols;
    this.rows = rows;
    this.mapState = state;
    const size = worldSize(cols, rows);
    this.mapW = size.x;
    this.mapH = size.y;
    this.fow.setMap(cols, rows, size);
    this.shown = new Uint8Array(cols * rows);
    this.buildGround(state);
    const files = new Set<string>();
    for (const t of state.tree.terrain) {
      if (t.visual.model) files.add(t.visual.model);
      for (const f of t.visual.shore ?? []) files.add(f);
    }
    if (files.size) {
      void Promise.all([...files].map((f) => this.models.load(f))).then(() => {
        if (this.mapState === state) this.buildGround(state);
      });
    }

    this.camTarget = { x: size.x / 2, y: size.y / 2 };
  }

  /**
   * (Re)build the ground meshes: one InstancedMesh per tile file (or per terrain for pucks). Hexes
   * already revealed stay revealed.
   */
  private buildGround(state: GameState) {
    for (const part of this.ground) this.scene.remove(part.mesh);
    this.ground = [];
    const cols = state.width;
    const rows = state.height;
    const n = cols * rows;
    const terrain = state.tree.terrain;
    const colors = terrain.map((t) => new THREE.Color(t.visual.color));
    this.tilePart = new Int16Array(n);
    this.tileSlot = new Int32Array(n);
    this.tileRot = new Float32Array(n);
    this.tileTop = new Float32Array(n);

    // Decide every hex's tile, grouping by file (or by terrain when the file is not loaded).
    const groups = new Map<string, { index: number; file?: string; terrainIdx: number; hexes: number[] }>();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const terrainIdx = state.terrain[i];
        const { model, rotation } = tileOf(state, x, y);
        const usable = model && this.models.geometryOf(model) ? model : undefined;
        const key = usable ? `m:${usable}` : `t:${terrainIdx}`;
        let g = groups.get(key);
        if (!g) {
          g = { index: groups.size, file: usable, terrainIdx, hexes: [] };
          groups.set(key, g);
        }
        this.tilePart[i] = g.index;
        this.tileSlot[i] = g.hexes.length;
        this.tileRot[i] = usable ? rotation : 0;
        this.tileTop[i] = terrain[terrainIdx].visual.height + (state.elevation[i] ?? 0) * HEIGHT_STEP;
        g.hexes.push(i);
      }
    }
    this.tileTopMax = 0;
    this.tileTopMin = 0;
    for (const h of this.tileTop) {
      if (h > this.tileTopMax) this.tileTopMax = h;
      if (h < this.tileTopMin) this.tileTopMin = h;
    }
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    for (const g of groups.values()) {
      const src = g.file ? this.models.geometryOf(g.file)! : null;
      const mesh = new THREE.InstancedMesh(
        src ? src.geometry : this.geo.tile,
        src ? src.material : this.material(0xffffff),
        g.hexes.length,
      );
      for (let k = 0; k < g.hexes.length; k++) {
        mesh.setMatrixAt(k, hidden);
        if (!src) {
          const i = g.hexes[k];
          const v = 0.92 + ((((i % cols) * 7 + Math.floor(i / cols) * 13) % 11) / 11) * 0.16; // stable variation
          mesh.setColorAt(k, col.copy(colors[g.terrainIdx]).multiplyScalar(v));
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Instances start hidden, so the bounding sphere three.js computes on first render would be empty
      // and the part culled for good once revealed; the board is always on screen anyway.
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.ground.push({ mesh });
    }

    // Plinths: a hex of rock from the lowest neighbour's top up to the underside of any tile whose own
    // wall cannot cover the drop, so cliffs at the sea (and tall steps) do not float.
    this.plinthSlot = new Int32Array(n).fill(-1);
    this.plinthBase = new Float32Array(n);
    this.plinthHeight = new Float32Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      let lowest = this.tileTop[i];
      for (const nb of hexNeighbours(i % cols, Math.floor(i / cols))) {
        if (nb.x < 0 || nb.y < 0 || nb.x >= cols || nb.y >= rows) continue;
        lowest = Math.min(lowest, this.tileTop[nb.y * cols + nb.x]);
      }
      const base = lowest - 0.05;
      const top = this.tileTop[i] - TILE_WALL + 0.05;
      if (top - base < 0.05) continue;
      this.plinthSlot[i] = count++;
      this.plinthBase[i] = base;
      this.plinthHeight[i] = top - base;
    }
    this.plinths = null;
    if (count) {
      const mesh = new THREE.InstancedMesh(this.geo.hex, this.material(PLINTH_COLOR), count);
      for (let k = 0; k < count; k++) mesh.setMatrixAt(k, hidden);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.ground.push({ mesh }); // shares the tiles' lifecycle and upload flagging
      this.plinths = mesh;
    }

    // Re-reveal what the player has already explored.
    if (this.shown) {
      for (let i = 0; i < n; i++) if (this.shown[i]) this.revealTile(i);
      for (const part of this.ground) part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Height of the ground under a world position: the top of that hex's tile. */
  groundY(x: number, y: number): number {
    if (!this.tileTop) return 0;
    const t = worldToHex({ x, y });
    if (t.x < 0 || t.y < 0 || t.x >= this.cols || t.y >= this.rows) return 0;
    return this.tileTop[t.y * this.cols + t.x];
  }

  /** Place hex `i`'s tile (it starts scaled to nothing). Caller flags the instance matrix for upload. */
  private revealTile(i: number) {
    if (!this.tilePart || !this.tileSlot || !this.tileRot || !this.tileTop) return;
    const part = this.ground[this.tilePart[i]];
    if (!part) return;
    const c = hexCentre(i % this.cols, Math.floor(i / this.cols));
    const isPuck = part.mesh.geometry === this.geo.tile;
    const m = new THREE.Matrix4().makeRotationY(this.tileRot[i]);
    m.setPosition(c.x, this.tileTop[i] - (isPuck ? 0.06 : 0), c.y);
    part.mesh.setMatrixAt(this.tileSlot[i], m);
    const slot = this.plinthSlot?.[i] ?? -1;
    if (slot >= 0 && this.plinths && this.plinthBase && this.plinthHeight) {
      const h = this.plinthHeight[i];
      const p = new THREE.Matrix4().makeScale(0.99, h, 0.99);
      p.setPosition(c.x, this.plinthBase[i] + h / 2, c.y);
      this.plinths.setMatrixAt(slot, p);
    }
  }

  /**
   * Fog of war from the player's vision (render/fow.ts), and ground tiles revealed as hexes become
   * charted (explored, or the whole map after Cartography) or join the fringe beyond. Called every
   * snapshot; does nothing while no hex changed level.
   */
  updateFog(vision: Uint8Array | null, charted: Uint8Array | null) {
    if (!this.fow.update(vision, charted) || !this.shown) return;
    const { level } = this.fow;
    let revealed = false;
    for (let i = 0; i < level.length; i++) {
      if (level[i] <= FogLevel.Fringe && !this.shown[i]) {
        this.revealTile(i);
        this.shown[i] = 1;
        revealed = true;
      }
    }
    if (revealed) for (const part of this.ground) part.mesh.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Shared resources
  // -------------------------------------------------------------------------

  private material(color: number | string): THREE.MeshLambertMaterial {
    const key = String(color);
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      this.fow.apply(m);
      this.materials.set(key, m);
    }
    return m;
  }

  private box(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `box:${w}:${h}:${d}`;
    let g = this.geometries.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.geometries.set(key, g);
    }
    return g;
  }

  private makeBar(width: number): HpBar {
    const group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.06, 0.14), this.barBg);
    bg.renderOrder = 20;
    const fgGeo = new THREE.PlaneGeometry(width, 0.09);
    fgGeo.translate(width / 2, 0, 0); // anchor at left edge so scale.x shrinks to the left
    const fg = new THREE.Mesh(fgGeo, this.barGreen);
    fg.position.set(-width / 2, 0, 0.01);
    fg.renderOrder = 21;
    group.add(bg, fg);
    group.visible = false;
    return { group, fg };
  }

  // -------------------------------------------------------------------------
  // Sync scene objects with game state
  // -------------------------------------------------------------------------

  /** Nodes are drawn where `explored` is set; pass null to show every node (a tech revealed them). */
  syncNodes(state: GameState, explored: Uint8Array | null) {
    const defs = idx(state.tree).nodes;
    const nodes = state.nodes;
    for (const [id, mesh] of this.nodeMeshes) {
      if (!nodes[id]) {
        this.scene.remove(mesh);
        this.nodeMeshes.delete(id);
      }
    }
    for (const id in nodes) {
      const n = nodes[id];
      const def = defs[n.type];
      let mesh = this.nodeMeshes.get(n.id);
      const file = def.visual.models?.[n.id % def.visual.models.length];
      if (mesh && mesh.userData.wantModel && this.models.ready(mesh.userData.wantModel as string)) {
        this.scene.remove(mesh);
        this.nodeMeshes.delete(n.id);
        mesh = undefined;
      }
      if (!mesh) {
        const inst = file ? this.models.instantiate(file, '#ffffff') : null;
        const c = hexCentre(n.x, n.y);
        const gy = this.groundY(c.x, c.y);
        if (inst) {
          mesh = inst.root;
          for (const m of inst.meshes) shadowed(m);
          mesh.position.set(c.x, gy, c.y);
          mesh.rotation.y = ((n.id * 137) % 360) * (Math.PI / 180); // varied but stable
          mesh.userData = { kind: 'node', id: n.id, unit: def.visual.scale ?? 1 };
        } else {
          if (file) void this.models.load(file);
          const isCone = def.visual.shape === 'cone';
          mesh = new THREE.Mesh(isCone ? this.geo.cone : this.geo.rock, this.material(def.visual.color));
          shadowed(mesh);
          mesh.position.set(c.x, gy + (isCone ? 0.65 : 0.3), c.y);
          if (!isCone) mesh.rotation.set(Math.random(), Math.random(), 0);
          mesh.userData = { kind: 'node', id: n.id, unit: 1, wantModel: file };
        }
        this.scene.add(mesh);
        this.nodeMeshes.set(n.id, mesh);
      }
      mesh.scale.setScalar((mesh.userData.unit as number) * (0.55 + 0.45 * (n.amount / def.amount)));
      mesh.visible = !explored || explored[n.y * this.cols + n.x] === 1;
    }
  }

  /** Kick off loading every model the tree refers to, so things appear as models from the first frame. */
  preloadModels(tree: TechTree) {
    for (const u of tree.units) {
      if (u.visual.model) void this.models.load(u.visual.model);
      if (u.projectile?.visual.model) void this.models.load(u.projectile.visual.model);
    }
    for (const b of tree.buildings) {
      if (b.visual.model)
        for (const c of b.visual.model.includes('{team}') ? TEAM_VARIANTS : [''])
          void this.models.load(b.visual.model.replace('{team}', c));
      if (b.attack?.projectile?.visual.model) void this.models.load(b.attack.projectile.visual.model);
    }
    for (const n of tree.nodes) for (const f of n.visual.models ?? []) void this.models.load(f);
    for (const t of tree.terrain)
      for (const f of [t.visual.model, ...(t.visual.shore ?? [])]) if (f) void this.models.load(f);
  }

  /** "{team}" in a building model name → the KayKit colour variant nearest to the owner's colour. */
  private teamVariant(file: string, color: string): string {
    if (!file.includes('{team}')) return file;
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(color).getHSL(hsl);
    const hue = hsl.h * 360;
    let best = TEAM_VARIANTS[0];
    let bestD = 999;
    for (const [name, h] of Object.entries(TEAM_HUES)) {
      const d = Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h));
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return file.replace('{team}', best);
  }

  /** Give a unit view its GLB body (owner-coloured), replacing whatever body it has. */
  private attachModel(v: EntityView, file: string, height: number) {
    const inst = this.models.instantiate(file, v.color);
    if (!inst) return false;
    v.group.remove(v.body);
    inst.root.scale.setScalar(height);
    inst.root.rotation.y = v.body.rotation.y;
    for (const m of inst.meshes) shadowed(m);
    v.group.add(inst.root);
    v.body = inst.root;
    v.meshes = inst.meshes;
    v.mats = inst.mats;
    v.wantModel = undefined;
    if (Object.keys(inst.clips).length) {
      v.mixer = new THREE.AnimationMixer(inst.root);
      v.clips = inst.clips;
      v.clip = undefined;
      this.playClip(v, v.workClip);
    }
    return true;
  }

  /** Crossfade to a named clip (falls back to idle). Walk speed follows the unit's speed. */
  private playClip(v: EntityView, name: string) {
    if (!v.mixer || !v.clips || v.clip === name) return;
    const clip = v.clips[name] ?? v.clips.idle;
    if (!clip) return;
    const next = v.mixer.clipAction(clip);
    next.reset();
    next.timeScale = name === 'walk' ? Math.max(0.6, v.speed / 1.4) : 1;
    next.fadeIn(0.15).play();
    v.action?.fadeOut(0.15);
    v.action = next;
    v.clip = name;
  }

  /** What a unit does with its hands while standing still, from its task. Walking is decided per frame. */
  private workClipFor(u: Unit, state: GameState): string {
    const t = u.task;
    switch (t.kind) {
      case 'harvest': {
        const shape = idx(state.tree).nodes[t.nodeType]?.visual.shape;
        return t.phase === 'gathering' ? (shape === 'rock' ? 'mine' : 'chop') : 'idle';
      }
      case 'build':
        return 'build';
      case 'attack':
        return 'attack';
      default:
        return 'idle';
    }
  }

  syncUnits(state: GameState) {
    const tree = state.tree;
    const defs = idx(tree);
    const units = state.units;
    for (const [id, v] of this.units) {
      if (!units[id]) {
        this.spawnBurst(v.group.position.x, v.group.position.z, v.color, 10, 0.8);
        this.scene.remove(v.group);
        this.units.delete(id);
      }
    }
    for (const id in units) {
      const u = units[id];
      const def = defs.units[u.type];
      const owner = state.players[u.owner];
      let v = this.units.get(u.id);
      if (!v) {
        const group = new THREE.Group();
        const color = owner?.color ?? '#ffffff';
        const { width, height, helmet, model } = def.visual;
        const mat = this.material(color);
        const body = new THREE.Mesh(this.box(width, height, width), mat);
        shadowed(body);
        body.position.y = height / 2;
        group.add(body);
        if (helmet && !model) {
          const head = new THREE.Mesh(this.geo.head, this.material(0x3a3a3a));
          head.scale.setScalar(height);
          head.position.y = height * 1.11;
          group.add(head);
        }
        // Carried load, HP bar and selection ring are sized from the unit's visual size (a person is
        // a fraction of a hex; the ring geometry is one hex across at scale 1).
        const carry = new THREE.Mesh(this.geo.carry, this.material(0xffffff));
        carry.scale.setScalar(Math.max(0.35, height));
        carry.position.y = height * 1.3;
        carry.visible = false;
        group.add(carry);
        const bar = this.makeBar(Math.max(0.3, width * 1.6));
        group.add(bar.group);
        group.userData = { kind: 'unit', id: u.id } satisfies Pick;
        group.position.set(u.x, this.groundY(u.x, u.y), u.y);
        this.scene.add(group);
        v = {
          group,
          body,
          meshes: [body],
          mats: [mat],
          wantModel: model,
          workClip: 'idle',
          speed: def.speed,
          bar,
          barHeight: height + 0.2,
          ringScale: Math.max(0.45, width * 2.4),
          maxHp: def.hp,
          lastHp: u.hp,
          flashUntil: 0,
          target: new THREE.Vector3(u.x, this.groundY(u.x, u.y), u.y),
          color,
          carry,
        };
        this.units.set(u.id, v);
        if (model) void this.models.load(model);
      }
      if (v.wantModel) this.attachModel(v, v.wantModel, def.visual.height);
      v.workClip = this.workClipFor(u, state);
      v.maxHp = owner ? unitMaxHp(tree, owner, u.type) : def.hp;
      v.target.set(u.x, this.groundY(u.x, u.y), u.y);
      if (u.hp < v.lastHp) v.flashUntil = this.time + FLASH_TIME;
      v.lastHp = u.hp;
      v.carry!.visible = !!u.carry;
      if (u.carry) {
        const node = tree.nodes.find((n) => n.resource === u.carry!.type);
        v.carry!.material = this.material(node?.visual.color ?? 0xffffff);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shots: ranged hits in flight (engine systems/projectiles.ts)
  // -------------------------------------------------------------------------

  /** The projectile a shot was fired as, from the def that fired it. */
  private projectileOf(state: GameState, s: Shot): ProjectileDef | undefined {
    const defs = idx(state.tree);
    return s.sourceKind === 'unit' ? defs.units[s.source]?.projectile : defs.buildings[s.source]?.attack?.projectile;
  }

  /**
   * A body for a projectile, authored to fly along +z: a thin box or a ball in the projectile's colour,
   * or the model turned so its longest axis points +z and scaled so that axis is `size` long.
   */
  private projectileBody(p: ProjectileDef, model: boolean): THREE.Object3D | null {
    const { shape, color, size } = p.visual;
    if (model && p.visual.model) {
      const inst = this.models.instantiate(p.visual.model, '#ffffff');
      if (!inst) return null;
      const box = new THREE.Box3().setFromObject(inst.root);
      const ext = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      inst.root.position.copy(centre).negate();
      const pivot = new THREE.Group();
      pivot.add(inst.root);
      if (ext.x >= ext.y && ext.x >= ext.z) pivot.rotation.y = -Math.PI / 2;
      else if (ext.y > ext.z) pivot.rotation.x = Math.PI / 2;
      pivot.scale.setScalar(size / Math.max(ext.x, ext.y, ext.z, 0.001));
      for (const m of inst.meshes) shadowed(m);
      wrap.add(pivot);
      return wrap;
    }
    const geo =
      shape === 'ball'
        ? new THREE.SphereGeometry(size / 2, 8, 6)
        : new THREE.BoxGeometry(size * 0.08, size * 0.08, size);
    const mesh = new THREE.Mesh(geo, this.material(color));
    shadowed(mesh);
    return mesh;
  }

  /** How tall a drawn building is (model or primitive), measured, so shots leave from a tower's top. */
  private heightOf(v: EntityView): number {
    const box = new THREE.Box3().setFromObject(v.body);
    return box.isEmpty() ? BUILDING_SHOT_HEIGHT : box.max.y - v.group.position.y;
  }

  /** Where a shot is aimed right now: the target's drawn position, or where it was last seen. */
  private shotTarget(v: ShotView): THREE.Vector3 {
    const view = v.targetKind === 'unit' ? this.units.get(v.targetId) : this.buildings.get(v.targetId);
    if (view) v.to.copy(view.group.position).setY(view.group.position.y + v.toLift);
    return v.to;
  }

  /** Point on the flight at progress `p` (0..1): a straight line lifted by a parabola of height arc × distance. */
  private shotPoint(v: ShotView, p: number, out: THREE.Vector3): THREE.Vector3 {
    const to = this.shotTarget(v);
    out.lerpVectors(v.from, to, p);
    out.y += v.arc * v.from.distanceTo(to) * 4 * p * (1 - p);
    return out;
  }

  syncShots(state: GameState) {
    const shots = state.shots;
    const tmp = new THREE.Vector3();
    for (const [id, v] of this.shots) {
      if (shots[id]) continue;
      // Landed (or its target is gone): a few chips where it was.
      const at = this.shotPoint(v, Math.min(1, (v.t + v.elapsed) / v.duration), tmp);
      this.spawnBurst(at.x, at.z, v.color, 3, 0.25);
      this.scene.remove(v.root);
      this.shots.delete(id);
    }
    for (const id in shots) {
      const s = shots[id];
      let v = this.shots.get(s.id);
      if (v?.wantModel && this.models.ready(v.wantModel)) {
        this.scene.remove(v.root);
        this.shots.delete(s.id);
        v = undefined;
      }
      if (!v) {
        const p = this.projectileOf(state, s) ?? {
          speed: 1,
          arc: 0,
          visual: { shape: 'bolt' as const, color: '#ffffff', size: 0.2 },
        };
        const model = !!p.visual.model && this.models.ready(p.visual.model);
        const root = this.projectileBody(p, model);
        if (!root) continue;
        if (p.visual.model && !model) void this.models.load(p.visual.model);
        // A tower fires from its top (measured from the drawn model); a person from chest height.
        // Shots at a building aim halfway up it: anywhere on the wall is a hit.
        const shooter = s.sourceKind === 'building' ? this.buildings.get(s.sourceId) : undefined;
        const launch =
          s.sourceKind === 'unit' ? UNIT_SHOT_HEIGHT : shooter ? this.heightOf(shooter) : BUILDING_SHOT_HEIGHT;
        const target = s.targetKind === 'building' ? this.buildings.get(s.targetId) : undefined;
        const toLift =
          s.targetKind === 'unit' ? UNIT_SHOT_HEIGHT : (target ? this.heightOf(target) : BUILDING_SHOT_HEIGHT) / 2;
        const from = new THREE.Vector3(s.from.x, this.groundY(s.from.x, s.from.y) + launch, s.from.y);
        v = {
          root,
          from,
          to: from.clone(),
          targetId: s.targetId,
          targetKind: s.targetKind,
          toLift,
          t: s.t,
          duration: s.duration,
          elapsed: 0,
          arc: p.arc,
          color: p.visual.color,
          size: p.visual.size,
          wantModel: p.visual.model && !model ? p.visual.model : undefined,
        };
        this.scene.add(root);
        this.shots.set(s.id, v);
      }
      v.t = s.t;
      v.duration = s.duration;
      v.elapsed = 0;
    }
  }

  private updateShots(dt: number) {
    const at = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    for (const v of this.shots.values()) {
      v.elapsed += dt;
      const p = Math.min(1, (v.t + v.elapsed) / v.duration);
      this.shotPoint(v, p, at);
      this.shotPoint(v, Math.min(1, p + 0.02), ahead);
      v.root.position.copy(at);
      if (ahead.distanceToSquared(at) > 1e-8) v.root.lookAt(ahead);
    }
  }

  syncBuildings(state: GameState, buildings: Record<number, Building>, ghostIds: Set<number>) {
    const defs = idx(state.tree).buildings;
    for (const [id, v] of this.buildings) {
      const b = buildings[id];
      if (!b || !!v.ghost !== ghostIds.has(Number(id))) {
        if (!b && !v.ghost) this.spawnBurst(v.group.position.x, v.group.position.z, v.color, 24, 1.6);
        this.scene.remove(v.group);
        this.buildings.delete(id);
      }
    }
    for (const id in buildings) {
      const b = buildings[id];
      const def = defs[b.type];
      const isGhost = ghostIds.has(b.id);
      let v = this.buildings.get(b.id);
      if (!v) {
        const group = new THREE.Group();
        const color = state.players[b.owner]?.color ?? '#ffffff';
        const width = footprintWidth(b.r);
        const { shape, color: bodyColor, height, glow, model } = def.visual;
        // Owner-coloured hex plate only where nothing else shows the owner: primitives and remembered
        // enemy ghosts. Pack models carry their team colour and the plate just cluttered the board.
        if (!model || isGhost) {
          const plateMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isGhost ? 0.25 : 0.55 });
          this.fow.apply(plateMat);
          const plate = new THREE.Mesh(this.geo.hex, plateMat);
          plate.scale.set(width * 1.08, 0.02, width * 1.08);
          plate.position.set(0, 0.015, 0);
          group.add(plate);
        }

        const mat: THREE.Material = new THREE.MeshLambertMaterial({
          color: bodyColor,
          emissive: glow ?? 0x000000,
          emissiveIntensity: glow ? 0.6 : 0,
          transparent: isGhost,
          opacity: isGhost ? 0.4 : 1,
        });
        this.fow.apply(mat);
        const geometry =
          shape === 'cone'
            ? new THREE.ConeGeometry(width * 0.4, height, 8)
            : this.box(width * 0.8, height, width * 0.8);
        const body = new THREE.Mesh(geometry, mat);
        if (glow && !isGhost) {
          const light = new THREE.PointLight(glow, 12, 8);
          light.position.set(0, height + 0.4, 0);
          body.add(light);
        }
        shadowed(body);
        group.add(body);
        const bar = this.makeBar(width * 0.9);
        group.add(bar.group);
        group.userData = { kind: 'building', id: b.id } satisfies Pick;
        const centre = hexCentre(b.x, b.y);
        group.position.set(centre.x, this.groundY(centre.x, centre.y), centre.y);
        this.scene.add(group);
        v = {
          group,
          body,
          meshes: [body],
          mats: [mat],
          wantModel: model && !isGhost ? this.teamVariant(model, color) : undefined,
          modelScale: width,
          workClip: 'idle',
          speed: 0,
          bar,
          barHeight: height + 0.45,
          maxHp: buildingMaxHp(state.tree, state.players[b.owner], b.type),
          lastHp: b.hp,
          flashUntil: 0,
          target: group.position.clone(),
          color,
          ghost: isGhost,
        };
        this.buildings.set(b.id, v);
      }
      v.body.rotation.y = -b.rot * (Math.PI / 3); // clockwise seen from above
      if (v.wantModel) this.attachModel(v, v.wantModel, v.modelScale ?? 1);
      const s = Math.max(0.08, b.progress);
      if (v.modelScale !== undefined && !v.wantModel && v.body.type !== 'Mesh') {
        // A model grows out of the ground during construction; its base is already at y=0.
        v.body.scale.set(v.modelScale, v.modelScale * s, v.modelScale);
        v.body.position.y = 0;
      } else {
        v.body.scale.y = s;
        v.body.position.y = (def.visual.height * s) / 2;
      }
      if (b.hp < v.lastHp) v.flashUntil = this.time + FLASH_TIME;
      v.lastHp = b.hp;
    }
  }

  // -------------------------------------------------------------------------
  // Selection rings, rally marker, build ghost, effects
  // -------------------------------------------------------------------------

  setSelection(
    unitIds: number[],
    buildingId: number | null,
    buildings: Record<number, Building>,
    node: ResourceNode | null = null,
  ) {
    this.selectedUnits = new Set(unitIds);
    this.selectedBuilding = buildingId;
    const wanted = new Set<string>();
    for (const id of unitIds) wanted.add(`u${id}`);
    if (buildingId !== null) wanted.add(`b${buildingId}`);
    if (node) wanted.add(`n${node.id}`);
    for (const [key, ring] of this.rings) {
      if (!wanted.has(key)) {
        this.scene.remove(ring);
        this.rings.delete(key);
      }
    }
    for (const key of wanted) {
      let ring = this.rings.get(key);
      if (!ring) {
        ring = new THREE.Mesh(this.geo.ring, this.ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        this.scene.add(ring);
        this.rings.set(key, ring);
      }
      if (key[0] === 'b') {
        const b = buildings[buildingId!];
        if (b) {
          const c = hexCentre(b.x, b.y);
          ring.position.set(c.x, this.groundY(c.x, c.y) + 0.03, c.y);
          ring.scale.setScalar(footprintWidth(b.r) * 1.4);
        }
      } else if (key[0] === 'n' && node) {
        const c = hexCentre(node.x, node.y);
        ring.position.set(c.x, this.groundY(c.x, c.y) + 0.03, c.y);
        ring.scale.setScalar(1.3);
      } else if (key[0] === 'u') {
        const v = this.units.get(Number(key.slice(1)));
        if (v) ring.scale.setScalar(v.ringScale ?? 1);
      }
    }
  }

  setRallyMarker(rally: RallyPoint | null) {
    if (!rally) {
      if (this.rallyMarker) this.rallyMarker.visible = false;
      return;
    }
    if (!this.rallyMarker) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), this.material(0xdddddd));
      pole.position.y = 0.65;
      const flag = new THREE.Mesh(this.box(0.45, 0.28, 0.04), this.material(0xfbd365));
      flag.position.set(0.24, 1.14, 0);
      g.add(pole, flag);
      this.scene.add(g);
      this.rallyMarker = g;
    }
    this.rallyMarker.visible = true;
    this.rallyMarker.position.set(rally.x, this.groundY(rally.x, rally.y), rally.y);
  }

  private ghostHeight = 1;

  /** A translucent hex prism the size of the building's footprint, following the mouse in build mode. */
  setGhost(building: string | null, state?: GameState) {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    if (!building || !state) return;
    const def = idx(state.tree).buildings[building];
    if (!def) return;
    const width = footprintWidth(def.size.radius);
    this.ghostHeight = def.visual.height;
    this.ghost = new THREE.Mesh(this.geo.hex, this.ghostOk);
    this.ghost.scale.set(width, def.visual.height, width);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /** Show the ghost centred on hex (tx, ty). */
  updateGhost(tx: number, ty: number, valid: boolean) {
    if (!this.ghost) return;
    const c = hexCentre(tx, ty);
    this.ghost.visible = true;
    this.ghost.position.set(c.x, this.groundY(c.x, c.y) + this.ghostHeight / 2, c.y);
    this.ghost.material = valid ? this.ghostOk : this.ghostBad;
  }

  spawnBurst(x: number, y: number, color: string | number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(this.geo.particle, mat);
      mesh.position.set(x + (Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 0.6, y + (Math.random() - 0.5) * 0.4);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4 * spread,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 4 * spread,
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, mat, vel, life: PARTICLE_LIFE });
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 14);
    for (const v of this.units.values()) {
      // Face the way we are going (models are authored facing +z). Boxes rotate too; it is invisible.
      const dx = v.target.x - v.group.position.x;
      const dz = v.target.z - v.group.position.z;
      const moving = dx * dx + dz * dz > 0.0004;
      if (moving) {
        const d = Math.atan2(dx, dz) - v.body.rotation.y;
        v.body.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 10);
      }
      if (v.group.position.distanceTo(v.target) > 3) v.group.position.copy(v.target);
      else v.group.position.lerp(v.target, k);
      if (v.mixer) {
        this.playClip(v, moving ? 'walk' : v.workClip);
        v.mixer.update(dt);
      }
    }
    for (const [key, ring] of this.rings) {
      if (key[0] !== 'u') continue;
      const v = this.units.get(Number(key.slice(1)));
      if (v) ring.position.set(v.group.position.x, v.group.position.y + 0.03, v.group.position.z);
    }

    for (const [id, v] of this.units) this.updateView(v, this.selectedUnits.has(id));
    for (const [id, v] of this.buildings) this.updateView(v, this.selectedBuilding === id);
    this.updateShots(dt);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.08) {
        p.mesh.position.y = 0.08;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      p.mat.opacity = p.life / PARTICLE_LIFE;
    }

    const dist = 26 * this.zoom;
    this.sun.position.set(this.camTarget.x + 20, 40, this.camTarget.y + 10);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.y);
    const half = Math.min(40, Math.max(4, 14 * this.zoom + 3));
    if (half !== this.shadowHalf) {
      this.shadowHalf = half;
      const sc = this.sun.shadow.camera;
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    const flat = Math.cos(this.pitch) * dist;
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.yaw) * flat,
      Math.sin(this.pitch) * dist,
      this.camTarget.y + Math.cos(this.yaw) * flat,
    );
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.y);
  }

  /** World movement for a screen-space push (right, down), so panning follows the camera's yaw. */
  panVector(sx: number, sy: number): Vec2 {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // Screen right is (cos, -sin) on the ground, screen up is the camera's forward (-sin, -cos).
    return { x: c * sx + s * sy, y: -s * sx + c * sy };
  }

  private updateView(v: EntityView, selected: boolean) {
    const flashing = this.time < v.flashUntil;
    for (let i = 0; i < v.meshes.length; i++) v.meshes[i].material = flashing ? this.flashMat : v.mats[i];
    const ratio = Math.max(0, Math.min(1, v.lastHp / v.maxHp));
    const show = !v.ghost && (selected || ratio < 0.999);
    v.bar.group.visible = show;
    if (!show) return;
    v.bar.group.position.set(0, v.barHeight, 0);
    v.bar.group.quaternion.copy(this.camera.quaternion);
    v.bar.fg.scale.x = Math.max(0.001, ratio);
    v.bar.fg.material = ratio > 0.5 ? this.barGreen : ratio > 0.25 ? this.barYellow : this.barRed;
  }

  render() {
    this.gl.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Picking and projection (screen coordinates are relative to the canvas)
  // -------------------------------------------------------------------------

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /**
   * The ground point under a screen position, on the stepped tiles (render/pick.ts): a flat plane
   * would land far behind a raised tile at a low camera tilt.
   */
  pickGround(clientX: number, clientY: number): Vec2 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    const p = marchGround(
      { ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z },
      (x, z) => this.groundY(x, z),
      this.tileTopMax,
      this.tileTopMin,
    );
    if (!p) return null;
    return { x: Math.max(0, Math.min(this.mapW - 0.001, p.x)), y: Math.max(0, Math.min(this.mapH - 0.001, p.z)) };
  }

  pickEntity(clientX: number, clientY: number): Pick | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const objects: THREE.Object3D[] = [];
    for (const v of this.units.values()) objects.push(v.body);
    for (const v of this.buildings.values()) objects.push(v.group);
    for (const m of this.nodeMeshes.values()) if (m.visible) objects.push(m);
    const hits = this.raycaster.intersectObjects(objects, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.kind) o = o.parent;
      if (o) return o.userData as Pick;
    }
    return null;
  }

  /** Screen position (client px) of a world point. */
  project(x: number, y: number, height = 0.5): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
}
