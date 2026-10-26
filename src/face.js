import * as THREE from 'three';
import { P } from './mood.js';
import { body } from './scene.js';
import { skin, surface } from './surface.js';
import { eyeMat, sparkleMat } from './materials.js';

// Eyes: black ovals with two white catch-lights
export const eyes = [-1, 1].map((side) => {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), eyeMat);
  ball.scale.set(0.12, 0.2, 0.05);
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sparkleMat);
  s1.scale.set(0.034, 0.04, 0.01);
  s1.position.set(-0.03, 0.065, 0.046);
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sparkleMat);
  s2.scale.setScalar(0.016);
  s2.position.set(0.035, -0.02, 0.046);
  g.add(ball, s1, s2);
  g.userData = { base: new THREE.Vector3(side * 0.36, 0.16, 0.92).normalize() };
  body.add(g);
  return g;
});

// Surface decals that ride along the wobbling skin: a soft specular glint on
// the top-left and a few freckles on the orange cheek.
function glintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const decals = [];
function addDecal(mesh, dir, spin = 0) {
  mesh.userData = { dir: dir.normalize(), spin };
  body.add(mesh);
  decals.push(mesh);
}

const glint = new THREE.Mesh(
  new THREE.CircleGeometry(1, 32),
  new THREE.MeshBasicMaterial({ map: glintTexture(), transparent: true, depthWrite: false }),
);
glint.scale.set(0.3, 0.2, 1);
addDecal(glint, new THREE.Vector3(-0.5, 0.62, 0.6), 0.6);

const freckleMat = new THREE.MeshBasicMaterial({ color: '#d4572a', transparent: true, opacity: 0.75, depthWrite: false });
for (const [x, y] of [[0.42, -0.2], [0.49, -0.15], [0.48, -0.25], [0.55, -0.2]].flatMap(([x, y]) => [[x, y], [-x, y]])) {
  const f = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), freckleMat);
  addDecal(f, new THREE.Vector3(x, y, 0.72));
}

const Z = new THREE.Vector3(0, 0, 1);
const dir = new THREE.Vector3();
const at = new THREE.Vector3();

// Eyes and decals sit on the deformed skin, so place them after it moves.
// look: where he's looking; woozy: the dizzy roll's angle; open: 0..1.
export function updateFace(look, woozy, open) {
  for (const eye of eyes) {
    dir.copy(eye.userData.base);
    dir.x *= 1 - P.star * 0.2; // a touch closer together on the star's face
    dir.x += look.x * 0.16;
    dir.y += look.y * 0.1;
    // Dizzy: each eye rolls in its own circle, out of step with the other.
    const roll = woozy * 8 + (eye.userData.base.x > 0 ? Math.PI : 0);
    dir.x += Math.cos(roll) * 0.1 * P.dizzy;
    dir.y += Math.sin(roll) * 0.07 * P.dizzy;
    dir.normalize();
    surface(dir.x, dir.y, dir.z, at).multiplyScalar(0.995);
    eye.position.copy(at);
    eye.quaternion.setFromUnitVectors(Z, dir);
    eye.scale.set((1 + P.glow * 0.12) * (1 - skin.morph * 0.2), open * (1 + P.glow * 0.12) * (1 + skin.morph * 1.6), 1);
  }

  for (const d of decals) {
    const { dir: n, spin } = d.userData;
    surface(n.x, n.y, n.z, at).multiplyScalar(1.004);
    d.position.copy(at);
    d.quaternion.setFromUnitVectors(Z, n);
    if (spin) d.rotateZ(spin);
  }
}
