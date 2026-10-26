import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EMBED } from './env.js';
import { P, spring } from './mood.js';
import { blobScreen } from './scene.js';

// Blob surface: a unit sphere displaced by 4D noise, squashed into a gummy
// shape with a soft flat bottom.
export const SHAPE = { sx: 1.0, sy: 1.0, sz: 0.92, floor: -0.85, peak: 0 };
const noise = new SimplexNoise();
// Driven by the frame loop. morph peaks at 1 halfway through a blob <-> star
// transformation.
export const skin = { phase: 0, squash: 0, morph: 0, hemPhase: 0 };

// Jello poke: a ripple runs out from the poke point while the whole body
// rocks, both dying away. freq is the ripple's speed, spread how tight it is.
export const JIGGLE = { amp: 0.09, decay: 2.6, freq: 16, spread: 7 };
export const jiggle = { amp: 0, t: 10, now: 0, origin: new THREE.Vector3(0, 0, 1) };

// Pokes stack up to a point, so tapping repeatedly gets him really wobbling.
export function poke(x, y) {
  const r = blobScreen.r || 1;
  // Rough spot on his body from the click's offset from his center.
  jiggle.origin.set((x - blobScreen.x) / r, -(y - blobScreen.y) / r, 0.8).normalize();
  jiggle.amp = Math.min(jiggle.now + JIGGLE.amp, JIGGLE.amp * 1.8);
  jiggle.t = 0;
  spring.v -= 1.5;
}

// soft: half-width (radians) of the arc averaged to round the corners
// core/dome: radius of the round face, and how quickly the star outline takes
// over from it toward the edges (higher = later)
const STAR = { outer: 1.58, inner: 0.7, soft: 0.13, core: 1.05, dome: 1.5, depth: 0.95, cy: -0.05 };

// Radius of a straight-edged five-pointed star at angle a (tip pointing up):
// the polar form of the line between the nearest tip and inner corner.
function starEdge(a) {
  const seg = (Math.PI * 2) / 5;
  const half = seg / 2;
  let u = (((a - Math.PI / 2) % seg) + seg) % seg;
  u = Math.min(u, seg - u);
  return (STAR.outer * STAR.inner * Math.sin(half)) / (STAR.outer * Math.sin(u) + STAR.inner * Math.sin(half - u));
}
// Pac-Man ghost body: the sphere's upper half stays a dome, the lower half is
// unrolled into straight walls ending in a scalloped hem of doughy feet, and
// the last bit tucks under as a hidden underside.
// wallDy: how far down the sphere (in dy) the straight wall runs before the
// underside. Higher puts the hem on a narrower ring of the sphere, with fewer
// vertices around it; the points between feet then jump from vertex to vertex
// as the feet roll, and flicker.
// n/scallop: how many feet, and how deep the notches between them go.
// arc: each foot is a rounded arc butting into the next at a point; lower is
// rounder, with a sharper point. tip rounds off the very point, so the mesh
// doesn't fold there.
// bulge/rise: how much each foot puffs out, and how low on the wall the
// puffing starts (higher = only near the hem). puffTip rounds the puff's
// notch far wider than the hem's, or it creases the wall above each notch.
// roll: the radius of the thick, rounded lip the hem curls under around,
// which takes up rollShare of the underside's mesh. cap: how high the middle
// of the underside sits.
const GHOST = {
  n: 5, box: 2.2, taper: 0.16, wallDy: 0.82, bulge: 0.07, rise: 2,
  scallop: 0.3, arc: 0.45, tip: 0.07, puffTip: 0.45, roll: 0.12, rollShare: 0.4, cap: 0.24,
};

// How far down the hem reaches at a point x (radians) along its run of feet:
// 1 at the bottom of a foot, 0 at the top of the notch between two.
function hemLobe(x, t = GHOST.tip) {
  const s = (((x / (Math.PI * 2)) % 1) + 1) % 1;
  const q = 1 - (2 * s - 1) ** 2;
  // Round the notch before the power: after it, the arc's vertical end
  // survives as a cusp.
  const k = GHOST.arc / 2;
  const lo = (t * t) ** k;
  return ((q * q + t * t) ** k - lo) / ((1 + t * t) ** k - lo);
}
const CAP_HL = Math.sqrt(1 - GHOST.wallDy ** 2); // sphere width where the wall ends
// The most the skirt's wobble can reach, whatever the state asks for: amp is
// how far it bulges, freq how small and lumpy the bulges get. hemFade: how
// much of it dies away toward the hem.
const WOBBLE = { amp: 0.065, freq: 1.3, hemFade: 0.85 };

// radius: size of the skin patch each arm grows from
// cap: fraction of the patch that blends; the rest moves out together as the tip
// reach: how much farther an arm stretches when he reaches out to make or catch a helper
// bendMax: the most lift that still bends the tip further up; past it a raised
// arm would taper to a point
export const ARMS = { len: 0.2, radius: 0.3, cap: 0.5, tip: 0.6, droop: 0.04, bend: 0.22, reach: 0.38, y: -0.3, z: 0.2, under: 1.5, bendMax: 0.35 };
// Shoulders stay put on the body; only the direction the arm reaches in moves,
// so the arm pivots at the shoulder and the tip does the waving.
export const armRest = [-1, 1].map((side) => new THREE.Vector3(side, ARMS.y, ARMS.z).normalize());
export const armDirs = armRest.map((a) => a.clone());
const armAnchors = [new THREE.Vector3(), new THREE.Vector3()];
// reach: how far each arm is stretched out, 0..1, easing toward reachTarget
export const arms = { len: ARMS.len, lift: [0, 0], reach: [0, 0], reachTarget: [0, 0] };
let armsOn = true;

// Shoulder points: where the resting arm directions meet the armless body.
export function updateArmAnchors() {
  armsOn = false;
  armRest.forEach((a, i) => surface(a.x, a.y, a.z, armAnchors[i]));
  armsOn = true;
}

export function surface(dx, dy, dz, out) {
  const hl = Math.hypot(dx, dz);
  // Feet roll clockwise around the hem (seen from above), faster when busy.
  let puff = 0, hem = -SHAPE.floor, ny = dy;
  if (dy < 0) {
    const around = GHOST.n * Math.atan2(dz, dx) + Math.PI - skin.hemPhase;
    hem = -SHAPE.floor - GHOST.scallop * (1 - hemLobe(around)); // feet reach the floor
    puff = GHOST.bulge * hemLobe(around, GHOST.puffTip);
    // The skin's wobble and puff go by true height, not by the share of each
    // foot's own wall: the notch's shorter wall would crease the whole wall.
    ny = dy * (hem - GHOST.roll) / (-SHAPE.floor - GHOST.roll);
  }
  const w = ny < 0 ? 1 - Math.sqrt(1 - ny * ny) : 0; // 0 at the equator, 1 at the bottom pole
  // Smooth dome on top; the wobble lives in the skirt.
  const skirt = THREE.MathUtils.smoothstep(w, 0, 0.45);
  // Busy states wobble faster, but no bigger or lumpier than WOBBLE allows, so
  // the feet stay tucked in. The wobble also fades out toward the hem: a bump
  // right at the edge where the wall turns under makes a little ledge that
  // catches the light.
  const freq = Math.min(P.freq, WOBBLE.freq);
  const calm = 1 - WOBBLE.hemFade * THREE.MathUtils.smoothstep(-ny / GHOST.wallDy, 0.4, 1);
  let r = 1 + noise.noise4d(dx * freq, ny * freq, dz * freq, skin.phase) * Math.min(P.amp, WOBBLE.amp) * (0.12 + 0.88 * skirt) * calm;
  // Jello ripple spreading out from where he was poked.
  if (jiggle.now > 0.001) {
    const dist = 1 - (dx * jiggle.origin.x + ny * jiggle.origin.y + dz * jiggle.origin.z);
    r += jiggle.now * Math.sin(JIGGLE.freq * jiggle.t - JIGGLE.spread * dist) * Math.exp(-dist * 0.6);
  }

  let x, y, z;
  if (dy >= 0) {
    // Superellipse dome: squarer shoulders, flatter top.
    // Gumdrop taper: narrower toward the top.
    const s = r / (hl ** GHOST.box + dy ** GHOST.box) ** (1 / GHOST.box);
    const taper = 1 - GHOST.taper * dy * dy;
    x = dx * s * taper;
    y = dy * s * SHAPE.sy + SHAPE.peak * dy ** 6;
    z = dz * s * taper;
  } else {
    const ux = hl > 1e-6 ? dx / hl : 0;
    const uz = hl > 1e-6 ? dz / hl : 0;
    // Height down the wall follows dy itself, the same measure the dome uses,
    // so rows of the mesh stay evenly spaced across the seam (measuring it from
    // the width bunched them up just under it and left a crease).
    let rad;
    // The wall stops short of the hem by the roll's radius, and curls under
    // around it instead.
    const roll = GHOST.roll;
    if (-dy < GHOST.wallDy) {
      const f = -dy / GHOST.wallDy;
      rad = (1 + puff * (-ny / GHOST.wallDy) ** GHOST.rise) * r; // doughy feet
      y = -f * (hem - roll);
    } else {
      // The underside: tucks in from the hem to the bottom pole. It rises to
      // the same height in the middle all the way round; rising a fixed amount
      // from each point of the hem left steep fins inside the notches, which
      // caught the light.
      const c = 1 - hl / CAP_HL;
      const edge = (1 + puff * ((hem - roll) / (-SHAPE.floor - roll)) ** GHOST.rise) * r;
      const middle = SHAPE.floor + GHOST.scallop + GHOST.cap;
      if (c < GHOST.rollShare) {
        // A doughy lip: the wall curls round a quarter circle to a flat bottom...
        const a = (c / GHOST.rollShare) * Math.PI / 2;
        rad = edge - roll + roll * Math.cos(a);
        y = -(hem - roll) - roll * Math.sin(a);
      } else {
        // ...then the underside runs on inward and curves gently up to the middle.
        const u = (c - GHOST.rollShare) / (1 - GHOST.rollShare);
        rad = (edge - roll) * (1 - u);
        y = -hem + (middle + hem) * u * u;
      }
    }
    x = ux * rad;
    z = uz * rad;
  }

  x *= SHAPE.sx;
  z *= SHAPE.sz;

  // Squash and stretch around the floor so the ghost stays grounded.
  const stretch = 1 + skin.squash * 0.55;
  y = SHAPE.floor + (y - SHAPE.floor) * (1 - skin.squash);
  x *= stretch;
  z *= stretch;

  // Arms are part of the skin: a round patch of the body around each shoulder
  // is drawn outward, so the arm blends seamlessly into the body.
  if (armsOn) {
    for (let i = 0; i < 2; i++) {
      const s = armAnchors[i];
      // The patch reaches less far down, so it can't drag a passing foot out
      // with it.
      const below = y < s.y ? ARMS.under : 1;
      const d = Math.hypot(x - s.x, (y - s.y) * below, z - s.z);
      if (d >= ARMS.radius) continue;
      // The middle of the patch moves out as a whole, so the arm has a body
      // rather than pinching to a point...
      const u = 1 - d / ARMS.radius;
      const t = Math.min(1, u / ARMS.cap);
      const b = t * t * (3 - 2 * t);
      // ...and a quarter-circle dome rounds off the tip.
      const v = Math.max(0, (u - ARMS.cap) / (1 - ARMS.cap));
      const dome = Math.sqrt(1 - (1 - v) * (1 - v));
      const L = (arms.len + arms.reach[i] * ARMS.reach * Math.max(0, 1 - P.star)) * (b + ARMS.tip * dome);
      // Reaching along the lifted direction tilts the arm; the extra rise grows
      // toward the tip, bending it like a wave from the shoulder.
      const a = armDirs[i];
      const bend = Math.min(arms.lift[i], ARMS.bendMax) * ARMS.bend * b * b * (arms.len / ARMS.len);
      x += a.x * L;
      y += a.y * L - ARMS.droop * b * b + bend;
      z += a.z * L;
    }
  }
  if (P.star < 0.001) return out.set(x, y, z);

  // Star form: an inflated Power Star. The outline is a true straight-edged
  // star, averaged over a small arc to round off the tips and inner corners.
  // It's thickest in the middle and thinner out toward the points.
  const theta = Math.atan2(dy, dx);
  let Rs = 0;
  for (let k = -3; k <= 3; k++) Rs += starEdge(theta + (k / 3) * STAR.soft);
  Rs /= 7;
  // Toward the middle of the face the outline fades to a circle, so the points
  // swell out of a smooth dome instead of running creases into the center.
  const away = dx * dx + dy * dy;
  Rs = STAR.core + (Rs - STAR.core) * away ** STAR.dome;
  const R = Rs * r;
  // Thinning only applies away from the middle of the face, too.
  const thick = STAR.depth * (1 - away * 0.45 * (1 - STAR.inner / Rs)) * r;
  const t = P.star;
  x += (dx * R - x) * t;
  y += (dy * R + STAR.cy - y) * t;
  z += (dz * thick - z) * t;
  // Mid-morph the blob stretches tall and narrow, like gooey taffy.
  y = STAR.cy + (y - STAR.cy) * (1 + skin.morph * 0.55);
  x *= 1 - skin.morph * 0.3;
  return out.set(x, y, z);
}

const sphere = new THREE.IcosahedronGeometry(1, EMBED ? 26 : 48);
sphere.deleteAttribute('normal');
sphere.deleteAttribute('uv');
export const geo = mergeVertices(sphere);
const posAttr = geo.attributes.position;
const dirs = Float32Array.from(posAttr.array);
const out = new THREE.Vector3();

export function deform() {
  const arr = posAttr.array;
  for (let i = 0; i < arr.length; i += 3) {
    surface(dirs[i], dirs[i + 1], dirs[i + 2], out);
    arr[i] = out.x; arr[i + 1] = out.y; arr[i + 2] = out.z;
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
}
