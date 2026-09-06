import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HEX_ATLAS_MATERIAL, hexAtlasSeason, loadHexAtlas } from '../game/render/models';

// ---------------------------------------------------------------------------
// Model viewer (models.html): loads a GLB from /models/, lights it roughly
// like the game scene, shows the triangle count, plays its animation clips
// and previews the team-colour swap. Dev tool only; nothing here is imported
// by the game.
// ---------------------------------------------------------------------------

const TEAM_COLOURS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa'];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.AgXToneMapping; // same as the game (render/scene.ts) and Blender's default view
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c2a1a');
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
camera.position.set(1.6, 1.3, 2.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a2a, 0.9));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
sun.position.set(2, 4, 3);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshLambertMaterial({ color: '#4c7a2f' }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(2, 2, 0x88aa66, 0x557744));

// A reference box the size of today's primitive worker (visual width 0.4, height 1).
const ref = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 1, 0.4),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.15 }),
);
ref.position.set(-0.9, 0.5, 0);
scene.add(ref);

let model: THREE.Group | null = null;
let mixer: THREE.AnimationMixer | null = null;
let action: THREE.AnimationAction | null = null;
let team = 0;
let wire = false;
const stats = document.getElementById('stats')!;
const urlInput = document.getElementById('url') as HTMLInputElement;
const clipSelect = document.getElementById('clips') as HTMLSelectElement;

function applyTeam() {
  model?.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.wireframe = wire;
          if (m.name === 'Team') m.color.set(TEAM_COLOURS[team]);
        }
      }
    }
  });
}

function play(clip: THREE.AnimationClip | undefined) {
  if (!mixer || !clip) return;
  const next = mixer.clipAction(clip);
  next.reset().fadeIn(0.15).play();
  action?.fadeOut(0.15);
  action = next;
}

const atlasSeason = hexAtlasSeason(new URLSearchParams(location.search).get('atlas'));
const atlas = atlasSeason ? loadHexAtlas(atlasSeason) : null;

function load(url: string) {
  new GLTFLoader().load(
    url,
    (gltf) => {
      if (model) scene.remove(model);
      model = gltf.scene;
      let tris = 0;
      const materials = new Set<string>();
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const g = o.geometry as THREE.BufferGeometry;
          tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            materials.add(m.name);
            // ?atlas=summer|fall|winter: the Hexagon pack's seasonal recolour, as in the game.
            if (atlas && m.name.startsWith(HEX_ATLAS_MATERIAL) && 'map' in m) (m as THREE.MeshStandardMaterial).map = atlas;
          }
          if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
        }
      });
      // Skinned meshes need their skinning-aware bounds; Box3.setFromObject would use the bind pose.
      scene.add(model);
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      model.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) {
          o.computeBoundingBox();
          box.union(o.boundingBox!.clone().applyMatrix4(o.matrixWorld));
        } else if (o instanceof THREE.Mesh) {
          box.union(new THREE.Box3().setFromObject(o));
        }
      });
      const size = box.getSize(new THREE.Vector3());
      stats.textContent = `${tris} triangles · ${materials.size} materials (${[...materials].join(', ')}) · size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} (feet at y=${box.min.y.toFixed(2)}) · ${gltf.animations.length} clips`;
      applyTeam();

      mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
      action = null;
      clipSelect.innerHTML = '';
      for (const c of gltf.animations) {
        const o = document.createElement('option');
        o.value = c.name;
        o.textContent = `${c.name} (${c.duration.toFixed(2)}s)`;
        clipSelect.appendChild(o);
      }
      clipSelect.hidden = !gltf.animations.length;
      const idle = gltf.animations.find((c) => c.name === 'idle') ?? gltf.animations[0];
      if (idle) {
        clipSelect.value = idle.name;
        play(idle);
      }
      clipSelect.onchange = () => play(gltf.animations.find((c) => c.name === clipSelect.value));
    },
    undefined,
    (err) => {
      stats.textContent = `Failed to load ${url}: ${(err as Error).message ?? err}`;
    },
  );
}

document.getElementById('load')!.addEventListener('click', () => load(urlInput.value));
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  if (e.key === 't') {
    team = (team + 1) % TEAM_COLOURS.length;
    applyTeam();
  }
  if (e.key === 'w') {
    wire = !wire;
    applyTeam();
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const params = new URLSearchParams(location.search);
const url = params.get('m');
if (url) urlInput.value = url.startsWith('/') ? url : `/models/${url}`;
load(urlInput.value);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
