import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { api, params } from './env.js';

const canvas = document.getElementById('scene');
export const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;

export const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

export const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(0, 0.55, 7);
camera.lookAt(0, -0.35, 0);

// Light angle presets: key is where the scene's key light (and so the glossy
// highlights) sits, cel is the direction of the raking light behind the
// cream/orange split and the halftone. ?light=<name> picks one.
const LIGHTS = {
  'upper-left': { key: [-3, 4, 4], cel: [-1, 0.8, 0.35] },
  'upper-right': { key: [3, 4, 4], cel: [1, 0.8, 0.35] },
  top: { key: [0, 5, 2], cel: [0, 1, 0.25] },
  front: { key: [-2, 1.5, 5], cel: [-0.6, 0.35, 0.8] },
  side: { key: [-5, 1, 0.5], cel: [-1, 0.25, -0.1] },
};
const LIGHT = LIGHTS[params.get('light')] ?? LIGHTS['upper-left'];

const keyLight = new THREE.DirectionalLight(0xfff1e0, 1.6);
keyLight.position.set(...LIGHT.key);
// Fill from behind, on the far side from the key.
const rimLight = new THREE.DirectionalLight(0xffb27a, 0.8);
rimLight.position.set(-LIGHT.key[0], 1, -3);
scene.add(keyLight, rimLight, new THREE.HemisphereLight(0xfff4e8, 0x6b3b22, 0.5));

export const ROOT_Y = -0.76;
export const ROOT_SCALE = 0.78;
export const root = new THREE.Group();
root.position.y = ROOT_Y;
root.scale.setScalar(ROOT_SCALE);
scene.add(root);

export const body = new THREE.Group();
root.add(body);

// Cel band: the cream/orange split comes from the key light, so it slides
// around naturally as the ghost wobbles, bobs and turns.
camera.updateMatrixWorld();
export const cel = {
  // A raking light from the upper left, separate from the scene lights.
  uLightDir: { value: new THREE.Vector3(...LIGHT.cel).normalize().transformDirection(camera.matrixWorldInverse) },
  uLitColor: { value: new THREE.Color('#ffdc9c') },
  uShadeColor: { value: new THREE.Color('#ff8642') },
  uBand: { value: 0.3 },
};

// The light can change while he runs (the Light menu, or Auto following him
// around the monitor), so the lights ease toward these targets.
const keyTarget = new THREE.Vector3(...LIGHT.key);
const celTarget = cel.uLightDir.value.clone();
function aimLight({ key, cel: dir }) {
  keyTarget.set(...key);
  celTarget.set(...dir).normalize().transformDirection(camera.matrixWorldInverse);
}
api.onLight(({ mode, x, y }) => {
  if (params.has('light')) return; // a ?light= preview wins
  if (LIGHTS[mode]) return aimLight(LIGHTS[mode]);
  // Auto: lit from the middle of his monitor, so from the upper left in the
  // bottom-right corner, and from the right when he's over on the left.
  const dir = [-x * 1.1, 0.55 + 0.45 * y, 0.45];
  aimLight({ cel: dir, key: [dir[0] * 3, 1.5 + dir[1] * 3, 4] });
});

export function updateLights(k) {
  keyLight.position.lerp(keyTarget, k);
  rimLight.position.set(-keyLight.position.x, 1, -3);
  cel.uLightDir.value.lerp(celTarget, k).normalize();
}

export const view = { W: 1, H: 1 };

function resize() {
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  renderer.setSize(view.W, view.H, false);
  camera.aspect = view.W / view.H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

export function toScreen(v) {
  v.project(camera);
  return { x: (v.x + 1) / 2 * view.W, y: (1 - v.y) / 2 * view.H };
}

// Where he and his eyes are on screen, refreshed each frame for hit testing.
export const blobScreen = { x: 0, y: 0, r: 0 };
export const eyesScreen = { x: 0, y: 0 };
