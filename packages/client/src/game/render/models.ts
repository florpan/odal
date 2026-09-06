import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// GLB models referenced by a `visual.model` in the tree. Files live under
// /models/ (packages/client/public/models; see tools/models). Each is loaded
// once; instantiate() stamps out a copy whose "Team" material carries the
// owner's colour, while every other material is shared between copies.
// Materials are converted to the scene's Lambert look (textures kept) so
// models and primitives light the same way. Skinned models keep their
// skeleton per copy and expose their animation clips by name; the clip
// names are Odal's task names (idle, walk, chop, mine, build, attack, hit,
// death), assigned when the model is assembled (tools/models/kaykit_character.py).
// ---------------------------------------------------------------------------

export interface ModelInstance {
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  mats: THREE.Material[];
  /** Animation clips by name; empty for static models. */
  clips: Record<string, THREE.AnimationClip>;
}

interface Template {
  scene: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

export class ModelLibrary {
  private loader = new GLTFLoader();
  private templates = new Map<string, Template>();
  private pending = new Map<string, Promise<void>>();
  private teamMats = new Map<string, THREE.MeshLambertMaterial>();
  private plainMats = new Map<string, THREE.MeshLambertMaterial>();
  private geometries = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }>();

  /** Start loading; resolves (never rejects) when the file is usable or has failed. */
  load(file: string): Promise<void> {
    let p = this.pending.get(file);
    if (!p) {
      p = new Promise<void>((resolve) => {
        this.loader.load(
          `/models/${file}`,
          (gltf) => {
            let skinned = false;
            gltf.scene.traverse((o) => {
              if (!(o instanceof THREE.Mesh)) return;
              // tools/models writes no normals (every face has its own vertices); compute flat ones here.
              if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
              if (o instanceof THREE.SkinnedMesh) {
                skinned = true;
                o.frustumCulled = false; // bounds are the rest pose; animated limbs would pop
              }
            });
            const clips: Record<string, THREE.AnimationClip> = {};
            for (const c of gltf.animations) clips[c.name] = c;
            this.templates.set(file, { scene: gltf.scene, clips, skinned });
            resolve();
          },
          undefined,
          (err) => {
            console.warn(`[models] ${file} failed to load, using primitives`, err);
            resolve();
          },
        );
      });
      this.pending.set(file, p);
    }
    return p;
  }

  ready(file: string): boolean {
    return this.templates.has(file);
  }

  /** A copy of the loaded model coloured for `teamColor`, or null while it is still loading. */
  instantiate(file: string, teamColor: string): ModelInstance | null {
    const t = this.templates.get(file);
    if (!t) return null;
    const root = t.skinned ? cloneSkeleton(t.scene) : t.scene.clone(true);
    const meshes: THREE.Mesh[] = [];
    const mats: THREE.Material[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const src = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
      let m: THREE.MeshLambertMaterial | undefined;
      if (src.name === 'Team') {
        const key = `${file}:${teamColor}`;
        m = this.teamMats.get(key);
        if (!m) {
          m = new THREE.MeshLambertMaterial({ color: teamColor });
          this.teamMats.set(key, m);
        }
      } else {
        const key = `${file}:${src.name}`;
        m = this.plainMats.get(key);
        if (!m) {
          m = new THREE.MeshLambertMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null });
          this.plainMats.set(key, m);
        }
      }
      o.material = m;
      meshes.push(o);
      mats.push(m);
    });
    return { root, meshes, mats, clips: t.clips };
  }

  /**
   * A loaded static model as one geometry (every mesh merged, transforms baked in) and one shared
   * Lambert material (the first mesh's; ground tiles share a single texture), for InstancedMesh use.
   * Null while loading.
   */
  geometryOf(file: string): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
    const cached = this.geometries.get(file);
    if (cached) return cached;
    const t = this.templates.get(file);
    if (!t) return null;
    const parts: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;
    t.scene.updateMatrixWorld(true);
    t.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      // Merging needs identical attribute sets; drop what the first part does not have.
      if (parts.length) for (const k of Object.keys(g.attributes)) if (!parts[0].attributes[k]) g.deleteAttribute(k);
      parts.push(g);
      if (!material) {
        const src = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
        const key = `${file}:${src.name}`;
        let m = this.plainMats.get(key);
        if (!m) {
          m = new THREE.MeshLambertMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null });
          this.plainMats.set(key, m);
        }
        material = m;
      }
    });
    if (!parts.length || !material) return null;
    const geometry = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) ?? parts[0]);
    const found = { geometry, material };
    this.geometries.set(file, found);
    return found;
  }

  dispose() {
    for (const g of this.geometries.values()) g.geometry.dispose();
    this.geometries.clear();
    for (const t of this.templates.values())
      t.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    for (const m of this.teamMats.values()) m.dispose();
    for (const m of this.plainMats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.templates.clear();
    this.pending.clear();
    this.teamMats.clear();
    this.plainMats.clear();
  }
}
