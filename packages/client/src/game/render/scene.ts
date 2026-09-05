import * as THREE from 'three';
import { buildingMaxHp, idx, unitMaxHp } from '@odal/engine';
import type { Building, GameState, RallyPoint, ResourceNode, TechTree, Unit, Vec2 } from '@odal/engine';
import { ModelLibrary } from './models';

// ---------------------------------------------------------------------------
// The 3D scene. Everything in world coordinates is drawn here and nowhere
// else. Looks come from the tech tree's `visual` blocks, so new content
// renders without code changes. Game y maps to Three.js z.
// ---------------------------------------------------------------------------

export interface Pick {
  kind: 'unit' | 'building' | 'node';
  id: number;
}

const FLASH_TIME = 0.15;
const PARTICLE_LIFE = 0.7;
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
  /** Buildings: uniform scale applied to a footprint-normalised model (min of w, h). */
  modelScale?: number;
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

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  camTarget: Vec2 = { x: 32, y: 32 };
  zoom = 1;
  mapW = 64;
  mapH = 64;

  private models = new ModelLibrary();
  private nodeMeshes = new Map<number, THREE.Object3D>();
  private units = new Map<number, EntityView>();
  private buildings = new Map<number, EntityView>();
  private rings = new Map<string, THREE.Mesh>();
  private particles: Particle[] = [];
  private selectedUnits = new Set<number>();
  private selectedBuilding: number | null = null;
  private ghost: THREE.Mesh | null = null;
  private rallyMarker: THREE.Group | null = null;
  private ground: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  private fog: { mesh: THREE.Mesh; tex: THREE.DataTexture; data: Uint8Array } | null = null;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
  };
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x9cff9c, side: THREE.DoubleSide });
  private ghostOk = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.45 });
  private ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.45 });
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private barBg = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false });
  private barGreen = new THREE.MeshBasicMaterial({ color: 0x6fd44a, depthTest: false });
  private barYellow = new THREE.MeshBasicMaterial({ color: 0xe6c02e, depthTest: false });
  private barRed = new THREE.MeshBasicMaterial({ color: 0xe04a2e, depthTest: false });

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color(0x141c12);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3d5a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

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
  }

  /** Remove every game object (new game / restart). Map is rebuilt by setMap. */
  reset() {
    for (const m of this.nodeMeshes.values()) this.scene.remove(m);
    for (const v of this.units.values()) this.scene.remove(v.group);
    for (const v of this.buildings.values()) this.scene.remove(v.group);
    for (const r of this.rings.values()) this.scene.remove(r);
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.nodeMeshes.clear();
    this.units.clear();
    this.buildings.clear();
    this.rings.clear();
    this.particles = [];
    this.setGhost(null);
    this.setRallyMarker(null);
  }

  setMap(w: number, h: number) {
    this.mapW = w;
    this.mapH = h;
    if (this.ground) this.scene.remove(this.ground);
    if (this.grid) this.scene.remove(this.grid);
    if (this.fog) this.scene.remove(this.fog.mesh);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: 0x5b8a3c }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(w / 2, 0, h / 2);
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(Math.max(w, h), Math.max(w, h), 0x4d7a32, 0x4d7a32);
    this.grid.position.set(w / 2, 0.01, h / 2);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(this.grid);

    // Fog of war: a dark translucent sheet above everything, alpha from a w×h texture.
    const data = new Uint8Array(w * h * 4);
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(w / 2, 2.6, h / 2);
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.fog = { mesh, tex, data };
    this.camTarget = { x: w / 2, y: h / 2 };
  }

  updateFog(vision: Uint8Array | null, explored: Uint8Array | null) {
    if (!this.fog) return;
    const { data, tex } = this.fog;
    const w = this.mapW;
    const h = this.mapH;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = ((h - 1 - y) * w + x) * 4; // texture rows run bottom-up
        const alpha = !vision || !explored ? 235 : vision[i] ? 0 : explored[i] ? 120 : 235;
        data[o] = 6;
        data[o + 1] = 10;
        data[o + 2] = 6;
        data[o + 3] = alpha;
      }
    }
    tex.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Shared resources
  // -------------------------------------------------------------------------

  private material(color: number | string): THREE.MeshLambertMaterial {
    const key = String(color);
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
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
        if (inst) {
          mesh = inst.root;
          mesh.position.set(n.x + 0.5, 0, n.y + 0.5);
          mesh.rotation.y = ((n.id * 137) % 360) * (Math.PI / 180); // varied but stable
          mesh.userData = { kind: 'node', id: n.id, unit: def.visual.scale ?? 1 };
        } else {
          if (file) void this.models.load(file);
          const isCone = def.visual.shape === 'cone';
          mesh = new THREE.Mesh(isCone ? this.geo.cone : this.geo.rock, this.material(def.visual.color));
          mesh.position.set(n.x + 0.5, isCone ? 0.65 : 0.3, n.y + 0.5);
          if (!isCone) mesh.rotation.set(Math.random(), Math.random(), 0);
          mesh.userData = { kind: 'node', id: n.id, unit: 1, wantModel: file };
        }
        this.scene.add(mesh);
        this.nodeMeshes.set(n.id, mesh);
      }
      mesh.scale.setScalar((mesh.userData.unit as number) * (0.55 + 0.45 * (n.amount / def.amount)));
      mesh.visible = !explored || explored[n.y * this.mapW + n.x] === 1;
    }
  }

  /** Kick off loading every model the tree refers to, so things appear as models from the first frame. */
  preloadModels(tree: TechTree) {
    for (const u of tree.units) if (u.visual.model) void this.models.load(u.visual.model);
    for (const b of tree.buildings)
      if (b.visual.model)
        for (const c of b.visual.model.includes('{team}') ? TEAM_VARIANTS : [''])
          void this.models.load(b.visual.model.replace('{team}', c));
    for (const n of tree.nodes) for (const f of n.visual.models ?? []) void this.models.load(f);
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
        body.position.y = height / 2;
        group.add(body);
        if (helmet && !model) {
          const head = new THREE.Mesh(this.geo.head, this.material(0x3a3a3a));
          head.position.y = height + 0.11;
          group.add(head);
        }
        const carry = new THREE.Mesh(this.geo.carry, this.material(0xffffff));
        carry.position.y = height + 0.3;
        carry.visible = false;
        group.add(carry);
        const bar = this.makeBar(0.8);
        group.add(bar.group);
        group.userData = { kind: 'unit', id: u.id } satisfies Pick;
        group.position.set(u.x, 0, u.y);
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
          barHeight: height + 0.55,
          maxHp: def.hp,
          lastHp: u.hp,
          flashUntil: 0,
          target: new THREE.Vector3(u.x, 0, u.y),
          color,
          carry,
        };
        this.units.set(u.id, v);
        if (model) void this.models.load(model);
      }
      if (v.wantModel) this.attachModel(v, v.wantModel, def.visual.height);
      v.workClip = this.workClipFor(u, state);
      v.maxHp = owner ? unitMaxHp(tree, owner, u.type) : def.hp;
      v.target.set(u.x, 0, u.y);
      if (u.hp < v.lastHp) v.flashUntil = this.time + FLASH_TIME;
      v.lastHp = u.hp;
      v.carry!.visible = !!u.carry;
      if (u.carry) {
        const node = tree.nodes.find((n) => n.resource === u.carry!.type);
        v.carry!.material = this.material(node?.visual.color ?? 0xffffff);
      }
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
        const plate = new THREE.Mesh(
          new THREE.PlaneGeometry(b.w + 0.3, b.h + 0.3),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isGhost ? 0.25 : 0.55 }),
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(0, 0.02, 0);
        group.add(plate);

        const { shape, color: bodyColor, height, glow, model } = def.visual;
        const mat: THREE.Material = new THREE.MeshLambertMaterial({
          color: bodyColor,
          emissive: glow ?? 0x000000,
          emissiveIntensity: glow ? 0.6 : 0,
          transparent: isGhost,
          opacity: isGhost ? 0.4 : 1,
        });
        const geometry =
          shape === 'cone'
            ? new THREE.ConeGeometry(Math.min(b.w, b.h) * 0.4, height, 8)
            : this.box(b.w * 0.9, height, b.h * 0.9);
        const body = new THREE.Mesh(geometry, mat);
        if (glow && !isGhost) {
          const light = new THREE.PointLight(glow, 12, 8);
          light.position.set(0, height + 0.4, 0);
          body.add(light);
        }
        group.add(body);
        const bar = this.makeBar(Math.max(b.w, b.h) * 0.9);
        group.add(bar.group);
        group.userData = { kind: 'building', id: b.id } satisfies Pick;
        group.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
        this.scene.add(group);
        v = {
          group,
          body,
          meshes: [body],
          mats: [mat],
          wantModel: model && !isGhost ? this.teamVariant(model, color) : undefined,
          modelScale: Math.min(b.w, b.h),
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
          ring.position.set(b.x + b.w / 2, 0.03, b.y + b.h / 2);
          ring.scale.setScalar(Math.max(b.w, b.h) * 1.4);
        }
      } else if (key[0] === 'n' && node) {
        ring.position.set(node.x + 0.5, 0.03, node.y + 0.5);
        ring.scale.setScalar(1.3);
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
      const flag = new THREE.Mesh(this.box(0.45, 0.28, 0.04), this.material(0x9cff9c));
      flag.position.set(0.24, 1.14, 0);
      g.add(pole, flag);
      this.scene.add(g);
      this.rallyMarker = g;
    }
    this.rallyMarker.visible = true;
    this.rallyMarker.position.set(rally.x, 0, rally.y);
  }

  private ghostDef: { w: number; h: number; height: number } | null = null;

  setGhost(building: string | null, state?: GameState) {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostDef = null;
    }
    if (!building || !state) return;
    const def = idx(state.tree).buildings[building];
    if (!def) return;
    this.ghostDef = { w: def.size.w, h: def.size.h, height: def.visual.height };
    this.ghost = new THREE.Mesh(this.box(def.size.w * 0.9, def.visual.height, def.size.h * 0.9), this.ghostOk);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  updateGhost(tx: number, ty: number, valid: boolean) {
    if (!this.ghost || !this.ghostDef) return;
    const { w, h, height } = this.ghostDef;
    this.ghost.visible = true;
    this.ghost.position.set(tx + w / 2, height / 2, ty + h / 2);
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
      if (v) ring.position.set(v.group.position.x, 0.03, v.group.position.z);
    }

    for (const [id, v] of this.units) this.updateView(v, this.selectedUnits.has(id));
    for (const [id, v] of this.buildings) this.updateView(v, this.selectedBuilding === id);

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
    this.camera.position.set(this.camTarget.x, dist * 0.85, this.camTarget.y + dist * 0.6);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.y);
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

  pickGround(clientX: number, clientY: number): Vec2 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
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
