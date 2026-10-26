import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Falls back to no-ops so the page can be previewed in a plain browser.
const api = window.blob ?? {
  onEvent() {}, onCursor() {}, onLight() {}, setIgnore() {}, dragStart() {}, dragEnd() {}, contextMenu() {},
};

// Gallery mode: ?state=<name> holds one animation on a loop, ?embed hides the
// bubble and status chip and uses a lighter mesh so many can run at once.
const params = new URLSearchParams(location.search);
const LOCKED = params.get('state');
const EMBED = params.has('embed');
if (EMBED) document.body.classList.add('embed');

// ---------------------------------------------------------------------------
// Animation states. Every numeric param is eased toward its target each frame,
// so switching states always blends smoothly.
// ---------------------------------------------------------------------------
const DEFAULTS = {
  speed: 0.35, amp: 0.06, freq: 1.1,    // surface wobble (lower half)
  hop: 0, hopHz: 1, jitter: 0,          // bouncing
  sway: 0, wave: 0,                     // body/arm motions
  scan: 0, ponder: 0,                   // eye behaviors
  glow: 0, breath: 1, eyesClosed: 0,
  star: 0,                              // 0 = blob, 1 = star
  dizzy: 0,                             // woozy eye-rolling and swaying
  paddle: 0,                            // feet shuffling
  hover: 1,                             // floating off the desk
  lean: 0,                              // leaning over to reach an arm up high
  slump: 0,                             // arms hanging limp, asleep
  sheets: 0,                            // code sheets whizzing past to read
  write: 0,                             // conjuring code onto blank sheets
  term: 0,                              // a terminal running a command
  web: 0,                               // a browser window searching the web
};

const STATES = {
  idle: {},
  thinking: { speed: 1.0, amp: 0.08, freq: 1.5, ponder: 1, breath: 0.6 },
  running: { speed: 2.4, amp: 0.08, freq: 2.4, hop: 0.05, hopHz: 2.8, jitter: 0.008, paddle: 1, term: 1 },
  building: { speed: 1.2, amp: 0.08, freq: 1.8, write: 1, paddle: 0.5 },
  reading: { speed: 0.6, amp: 0.05, scan: 1, sheets: 1 },
  searching: { speed: 0.9, amp: 0.06, web: 1 },
  delegating: { speed: 1.6, amp: 0.12, freq: 2.0, hop: 0.06, hopHz: 1.3, paddle: 0.7 },
  attention: { speed: 1.4, amp: 0.08, hopHz: 1.7, wave: 1, lean: 1, paddle: 0.5 },
  done: { speed: 0.7, amp: 0.03, star: 1 },
  sleeping: { speed: 0.15, amp: 0.025, breath: 2.2, eyesClosed: 1, hover: 0, slump: 1 },
  dizzy: { speed: 1.0, amp: 0.1, freq: 1.6, dizzy: 1 },
};

const LABELS = {
  thinking: 'thinking…',
  running: 'running a command',
  building: 'editing files',
  reading: 'reading',
  searching: 'searching the web',
  delegating: 'delegating to an agent',
  attention: 'needs you!',
  done: 'done',
  sleeping: 'zzz',
  dizzy: 'dizzy…',
};

const TINTS = { sleeping: '#bdb6dc' };

const TOOL_STATES = {
  Bash: 'running', PowerShell: 'running', BashOutput: 'running',
  Edit: 'building', MultiEdit: 'building', Write: 'building', NotebookEdit: 'building',
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading',
  WebSearch: 'searching', WebFetch: 'searching',
  Task: 'delegating', Agent: 'delegating',
};

const SLEEP_AFTER_MS = 5 * 60 * 1000;
const DONE_HOLD_MS = 4500;
const DIZZY_MS = 3200; // spin plus the woozy part
// Needs you: he leans away from his waving arm, stretching tall to reach it up
// as high as he can without jumping. If nobody answers
// he gets louder: after calm seconds both arms wave, bigger, and he starts to
// hop, reaching full volume ramp seconds later; from glowAt he glows with
// ripples too. The gallery replays it every loop seconds, or holds one stage
// with ?attn=calm|loud|glow (at the times in ATTN_STAGES).
// tilt: how far he leans over; stretch: how much taller he gets; reach: how
// much higher the waving arm goes
const ATTN = { calm: 3, ramp: 3, glowAt: 7, loop: 11, hop: 0.32, tilt: 0.2, stretch: 0.06, reach: 0.08 };
let attnLoud = 0; // 0 polite .. 1 full volume
// Falling asleep: a big yawn (stretching tall, arms up, eyes squeezed shut), a
// squish as it ends, then his eyes drift slowly closed and his arms go limp
// (slump, shortened by shrink so they hang rather than stretch) as he
// settles. Times are seconds from when he gets sleepy. The gallery replays it
// every loop seconds with ?doze=1; without it, he's shown already asleep.
const DOZE = { yawn: 1.3, end: 3.2, loop: 7, stretch: 0.13, arms: 0.85, slump: 0.32, shrink: 0.35 };
const DOZE_LOOP = params.get('doze') === '1';
const doze = { squash: 0, pitch: 0, arms: 0, closed: null, done: true, settle: 1 }; // settle: 0..1 into the slump
const ATTN_STAGES = { calm: 1, loud: ATTN.calm + ATTN.ramp, glow: ATTN.glowAt + 2 };
const ATTN_STAGE = ATTN_STAGES[params.get('attn')];
// Thinking: glance is how long he looks to each side; squish the "hmm" when he
// switches; tilt how far his head leans toward where he's looking
const THINK = { glance: 1.4, squish: 0.05, tilt: 0.08 };
let ponderSide = -1; // -1 looking up-left, 1 up-right, eased between

// Jello poke: a ripple runs out from the poke point while the whole body
// rocks, both dying away. freq is the ripple's speed, spread how tight it is.
const JIGGLE = { amp: 0.09, decay: 2.6, freq: 16, spread: 7 };
const jiggle = { amp: 0, t: 10, origin: new THREE.Vector3(0, 0, 1) };
let jiggleNow = 0;
const STAR_TWEEN_S = 1.1; // length of a blob <-> star transformation

// Standard "back" in-out curve: dips slightly before starting, overshoots past
// the end, then settles.
function easeInOutBack(x) {
  const c = 1.70158 * 1.525;
  return x < 0.5
    ? ((2 * x) ** 2 * ((c + 1) * 2 * x - c)) / 2
    : ((2 * x - 2) ** 2 * ((c + 1) * (2 * x - 2) + c) + 2) / 2;
}
const starTween = { from: 0, to: 0, t: 1 };

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
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

const ROOT_Y = -0.76;
const ROOT_SCALE = 0.78;
const root = new THREE.Group();
root.position.y = ROOT_Y;
root.scale.setScalar(ROOT_SCALE);
scene.add(root);

const body = new THREE.Group();
root.add(body);

// ---------------------------------------------------------------------------
// Blob surface: a unit sphere displaced by 4D noise, squashed into a gummy
// shape with a soft flat bottom.
// ---------------------------------------------------------------------------
const SHAPE = { sx: 1.0, sy: 1.0, sz: 0.92, floor: -0.85, peak: 0 };
const noise = new SimplexNoise();
const P = { ...DEFAULTS };
let target = { ...DEFAULTS };
let phase = 0;
let squash = 0;
let morph = 0; // peaks at 1 halfway through a blob <-> star transformation
let starMode = false; // toggled by double-click
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
// puffing starts (higher = only near the hem).
// roll: the radius of the thick, rounded lip the hem curls under around,
// which takes up rollShare of the underside's mesh. cap: how high the middle
// of the underside sits.
const GHOST = {
  n: 5, box: 2.2, taper: 0.16, wallDy: 0.82, bulge: 0.07, rise: 2,
  scallop: 0.3, arc: 0.45, tip: 0.3, roll: 0.12, rollShare: 0.4, cap: 0.24,
};

// How far down the hem reaches at a point x (radians) along its run of feet:
// 1 at the bottom of a foot, 0 at the top of the notch between two.
function hemLobe(x) {
  const s = (((x / (Math.PI * 2)) % 1) + 1) % 1;
  const f = (1 - (2 * s - 1) ** 2) ** GHOST.arc;
  // A smooth corner instead of a hard V where two feet meet.
  const t = GHOST.tip;
  return (Math.sqrt(f * f + t * t) - t) / (Math.sqrt(1 + t * t) - t);
}
const CAP_HL = Math.sqrt(1 - GHOST.wallDy ** 2); // sphere width where the wall ends
let hemPhase = 0; // rolls the feet around the hem
// The most the skirt's wobble can reach, whatever the state asks for: amp is
// how far it bulges, freq how small and lumpy the bulges get. hemFade: how
// much of it dies away toward the hem.
const WOBBLE = { amp: 0.065, freq: 1.3, hemFade: 0.85 };

// radius: size of the skin patch each arm grows from
// cap: fraction of the patch that blends; the rest moves out together as the tip
// reach: how much farther an arm stretches when he reaches out to make or catch a helper
// bendMax: the most lift that still bends the tip further up; past it a raised
// arm would taper to a point
const ARMS = { len: 0.2, radius: 0.3, cap: 0.5, tip: 0.6, droop: 0.04, bend: 0.22, reach: 0.38, y: -0.3, z: 0.2, under: 1.5, bendMax: 0.35 };
// Shoulders stay put on the body; only the direction the arm reaches in moves,
// so the arm pivots at the shoulder and the tip does the waving.
const armRest = [-1, 1].map((side) => new THREE.Vector3(side, ARMS.y, ARMS.z).normalize());
const armDirs = armRest.map((a) => a.clone());
const armAnchors = [new THREE.Vector3(), new THREE.Vector3()];
const armLift = [0, 0];
let armLen = ARMS.len;
let armsOn = true;

// Shoulder points: where the resting arm directions meet the armless body.
function updateArmAnchors() {
  armsOn = false;
  armRest.forEach((a, i) => surface(a.x, a.y, a.z, armAnchors[i]));
  armsOn = true;
}

function surface(dx, dy, dz, out) {
  const hl = Math.hypot(dx, dz);
  const w = dy < 0 ? 1 - hl : 0; // 0 at the equator, 1 at the bottom pole
  // Smooth dome on top; the wobble lives in the skirt.
  const skirt = THREE.MathUtils.smoothstep(w, 0, 0.45);
  // Busy states wobble faster, but no bigger or lumpier than WOBBLE allows, so
  // the feet stay tucked in. The wobble also fades out toward the hem: a bump
  // right at the edge where the wall turns under makes a little ledge that
  // catches the light.
  const freq = Math.min(P.freq, WOBBLE.freq);
  const calm = 1 - WOBBLE.hemFade * THREE.MathUtils.smoothstep(-dy / GHOST.wallDy, 0.4, 1);
  let r = 1 + noise.noise4d(dx * freq, dy * freq, dz * freq, phase) * Math.min(P.amp, WOBBLE.amp) * (0.12 + 0.88 * skirt) * calm;
  // Jello ripple spreading out from where he was poked.
  if (jiggleNow > 0.001) {
    const dist = 1 - (dx * jiggle.origin.x + dy * jiggle.origin.y + dz * jiggle.origin.z);
    r += jiggleNow * Math.sin(JIGGLE.freq * jiggle.t - JIGGLE.spread * dist) * Math.exp(-dist * 0.6);
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
    // Feet roll clockwise around the hem (seen from above), faster when busy.
    const ang = Math.atan2(dz, dx);
    const lobe = hemLobe(GHOST.n * ang + Math.PI - hemPhase);
    const hem = -SHAPE.floor - GHOST.scallop * (1 - lobe); // feet reach the floor
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
      rad = (1 + GHOST.bulge * lobe * f ** GHOST.rise) * r; // doughy feet
      y = -f * (hem - roll);
    } else {
      // The underside: tucks in from the hem to the bottom pole. It rises to
      // the same height in the middle all the way round; rising a fixed amount
      // from each point of the hem left steep fins inside the notches, which
      // caught the light.
      const c = 1 - hl / CAP_HL;
      const edge = (1 + GHOST.bulge * lobe) * r;
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
  const stretch = 1 + squash * 0.55;
  y = SHAPE.floor + (y - SHAPE.floor) * (1 - squash);
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
      const L = (armLen + reach[i] * ARMS.reach * Math.max(0, 1 - P.star)) * (b + ARMS.tip * dome);
      // Reaching along the lifted direction tilts the arm; the extra rise grows
      // toward the tip, bending it like a wave from the shoulder.
      const a = armDirs[i];
      const bend = Math.min(armLift[i], ARMS.bendMax) * ARMS.bend * b * b * (armLen / ARMS.len);
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
  y = STAR.cy + (y - STAR.cy) * (1 + morph * 0.55);
  x *= 1 - morph * 0.3;
  return out.set(x, y, z);
}

let geo = new THREE.IcosahedronGeometry(1, EMBED ? 26 : 48);
geo.deleteAttribute('normal');
geo.deleteAttribute('uv');
geo = mergeVertices(geo);
const posAttr = geo.attributes.position;
const dirs = Float32Array.from(posAttr.array);

// Cel band: the cream/orange split comes from the key light, so it slides
// around naturally as the ghost wobbles, bobs and turns.
camera.updateMatrixWorld();
const cel = {
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

function celShade(shader) {
  Object.assign(shader.uniforms, cel);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uLightDir;
      uniform vec3 uLitColor;
      uniform vec3 uShadeColor;
      uniform float uBand;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float lit = dot(normalize(vNormal), uLightDir);
        diffuseColor.rgb *= mix(uShadeColor, uLitColor, smoothstep(uBand - 0.06, uBand + 0.06, lit));
      }`);
}

const bodyMat = new THREE.MeshPhysicalMaterial({
  roughness: 0.38,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  sheen: 0.35,
  sheenColor: new THREE.Color('#ffd6b8'),
  sheenRoughness: 0.45,
  emissive: new THREE.Color('#ff6a20'),
  emissiveIntensity: 0.06,
});
// Comic halftone: pale dots growing toward the shadowed side and the
// silhouette. The grid lives in screen space, centered on the blob and sized to
// it, so it follows the blob around but never stretches with its shape.
const HALFTONE_DOTS_PER_UNIT = 15;
// width stretches the wave's crests apart, speed is how fast they sweep across
// the screen; both relative to the original wave (?wave=old).
const HALFTONE_WAVE = params.get('wave') === 'old' ? { width: 1, speed: 1 } : { width: 1.6, speed: 1.8 };
// Edge light: a thin warm sheen along the silhouette, strongest on the side
// away from the key light. ?rim=0 turns it off.
const RIM = params.get('rim') === '0' ? 0 : 1;
const halftone = {
  uHalftone: { value: 1 },
  uWaveK: { value: new THREE.Vector2(0.38, -0.26).divideScalar(HALFTONE_WAVE.width) },
  uRim: { value: RIM },
  uCenter: { value: new THREE.Vector2() }, // blob center, in drawing-buffer pixels
  uCell: { value: 6 },                     // dot spacing, in drawing-buffer pixels
  uTime: { value: 0 },
};
bodyMat.onBeforeCompile = (shader) => {
  celShade(shader);
  Object.assign(shader.uniforms, halftone);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uHalftone;
      uniform vec2 uCenter;
      uniform float uCell;
      uniform float uTime;
      uniform vec2 uWaveK;
      uniform float uRim;`)
    .replace('#include <opaque_fragment>', `
      {
        vec2 p = (gl_FragCoord.xy - uCenter) / uCell;
        float d = length(fract(p) - 0.5);
        vec3 n = normalize(normal);
        float shade = 0.5 - 0.5 * dot(n, uLightDir);
        float rim = 1.0 - abs(dot(n, normalize(vViewPosition)));
        float amt = clamp(0.12 + shade * 0.85 + rim * 0.4, 0.0, 1.0) * uHalftone;
        // A wave washes diagonally over the grid; each dot swells as it passes.
        float wave = 0.5 + 0.5 * sin(dot(floor(p) + 0.5, uWaveK) - uTime);
        amt = clamp(amt * (0.3 + 1.1 * wave * wave), 0.0, 1.0);
        float r = 0.44 * sqrt(amt);
        float aa = fwidth(d);
        float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
        outgoingLight = mix(outgoingLight, vec3(0.95, 0.8, 0.6), dotMask * 0.8);
        float edge = smoothstep(0.5, 0.8, rim);
        float away = 0.5 - 0.5 * dot(normalize(n.xy + 1e-4), normalize(uLightDir.xy + 1e-4));
        outgoingLight = mix(outgoingLight, vec3(1.0, 0.95, 0.86), edge * mix(0.35, 1.0, away) * uRim);
      }
      #include <opaque_fragment>`);
};
const blobMesh = new THREE.Mesh(geo, bodyMat);
body.add(blobMesh);


// Eyes: black ovals with two white catch-lights
// Matte, with no reflections of the room, so the only shine is the two painted
// catch-lights; glossy eyes picked up extra glints that cluttered them.
const eyeMat = new THREE.MeshStandardMaterial({ color: '#0d0705', roughness: 0.9, envMapIntensity: 0 });
const sparkleMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const eyes = [-1, 1].map((side) => {
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

// ---------------------------------------------------------------------------
// Props: small objects he works with. Each one appears as the matching
// state's param (P.sheets, ...) eases up, and shrinks away as it eases back
// down.
// ---------------------------------------------------------------------------

// Reading, editing and running commands: sheets of code (or a terminal) whizz
// in from the side one after another and hang in front of him. Reading, he
// reads down each one. Editing, it arrives blank and his arm passes down over
// it from top to bottom, the code filling in behind his hand. Running a
// command, a terminal types the command and prints its output while he taps
// away. Searching the web, a browser window types a query, thinks, and shows
// results that he skims. Then he flicks it away and the next arrives.
// in/read/write/run/web/out: seconds for each part of one sheet's visit
// at: where a sheet hangs in front of him; from: how far off to the side it
// flies in from and out to
const SHEET = { w: 0.62, h: 0.74, in: 0.45, read: 2.3, write: 2.4, run: 2.6, web: 2.8, out: 0.35, at: [0.05, -0.3, 1.3], tilt: -0.25, from: 3.2, lines: 7 };
const SHEET_PX = { w: 124, h: 148, fold: 26 };
// The writing pass: his arm winds up above the page (top), sweeps down to the
// bottom of it over the middle of the visit, then drops back to rest.
// windup/start/end: fractions of the writing time
const SWEEP = { top: 0.7, bottom: -0.1, windup: 0.12, start: 0.18, end: 0.85 };

// The code on a page: indented runs of colored "words", the same every time
// for a given seed.
const CODE_COLORS = ['#e0703c', '#3e7486', '#9a6bb0', '#c9a888', '#c9a888'];
function codeWords(seed) {
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const words = [];
  let indent = 0;
  for (let k = 0; k < SHEET.lines; k++) {
    const y = 18 + k * 18;
    indent = Math.max(0, Math.min(2, indent + Math.floor(rand() * 3) - 1));
    let x = 12 + indent * 12;
    const end = (k === 0 ? SHEET_PX.w - SHEET_PX.fold - 6 : 112) - rand() * 30;
    while (x < end) {
      const len = Math.min(end - x, 10 + rand() * 24);
      words.push({ line: k, x, y, len, color: CODE_COLORS[Math.floor(rand() * CODE_COLORS.length)] });
      x += len + 5;
    }
  }
  return words;
}
const writeWords = [11, 12, 13, 14].map(codeWords);

// Draws a page with the top-right corner folded and its code filled in down
// to `reveal` (0..1 from top to bottom). Each line runs in quickly from left
// to right as the fill reaches it.
function drawSheet(g, words, reveal = 1) {
  const { w, h, fold } = SHEET_PX;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff4e0';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w - fold, 0);
  g.lineTo(w, fold);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = '#e8cfae';
  g.beginPath();
  g.moveTo(w - fold, 0);
  g.lineTo(w - fold, fold);
  g.lineTo(w, fold);
  g.fill();
  for (const wd of words) {
    const across = THREE.MathUtils.clamp(reveal * SHEET.lines - wd.line, 0, 1) * w;
    const len = Math.min(wd.len, across - wd.x);
    if (len <= 0) continue;
    g.fillStyle = wd.color;
    g.fillRect(wd.x, wd.y, len, 7);
  }
}

function sheetCanvas(w = SHEET_PX.w, h = SHEET_PX.h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Unlit, so the paper stays bright whichever way the light comes from.
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  return { g: c.getContext('2d'), tex, mat };
}

// Finished pages to read, and one page that gets written on.
const readPages = [1, 2, 3, 4].map((seed) => {
  const page = sheetCanvas();
  drawSheet(page.g, codeWords(seed));
  return page;
});
const writePage = sheetCanvas();

// The terminal: a dark window with a title bar. A command types out after the
// prompt, then output prints line by line, scrolling up once the window is
// full, with a blinking cursor at the end.
// w/h: its size next to a sheet's; px: its canvas size (same aspect)
const TERM = { w: 0.74, h: 0.56, px: [148, 112], typeSecs: 0.55, lineSecs: 0.16, rows: 6 };
const termPage = sheetCanvas(...TERM.px);
function termLines(seed) {
  let r = seed * 7919 + 104729;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 24 }, () => ({
    len: 30 + rand() * 90,
    color: rand() < 0.2 ? '#6fb3c4' : '#a99aa6',
  }));
}
const termOutput = [1, 2, 3, 4].map(termLines);

// The browser: a light window with a search bar. The query types in, a spinner
// turns while it loads, then result cards pop in one after another.
// typeSecs/loadSecs: how long the typing and the spinner take; resultSecs:
// the gap between results
const WEB = { w: 0.74, h: 0.6, px: [148, 120], typeSecs: 0.5, loadSecs: 0.45, resultSecs: 0.3, results: 3 };
const webPage = sheetCanvas(...WEB.px);
let webTyping = 0; // 1 while the query is typing, for his tapping arms
let webSkim = 0;   // 0..1 down the results, for his eyes
function drawBrowser(g, t, seed) {
  const [w, h] = WEB.px;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff4e0';
  g.beginPath();
  g.roundRect(0, 0, w, h, 10);
  g.fill();
  g.fillStyle = '#e8cfae';
  g.beginPath();
  g.roundRect(0, 0, w, 16, [10, 10, 0, 0]);
  g.fill();
  // An outline, so the pale window stands out against his cream side.
  g.strokeStyle = '#b58f6c';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(1.5, 1.5, w - 3, h - 3, 9);
  g.stroke();
  ['#e0703c', '#f0b24a', '#6fae8a'].forEach((c, k) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(12 + k * 11, 8, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  // Search bar, with a little magnifier and the query typing in.
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#c9a888';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(10, 24, w - 20, 16, 8);
  g.fill();
  g.stroke();
  g.strokeStyle = '#3e7486';
  g.beginPath();
  g.arc(20, 31, 3.5, 0, Math.PI * 2);
  g.moveTo(22.5, 33.5);
  g.lineTo(25.5, 36.5);
  g.stroke();
  const typed = THREE.MathUtils.clamp(t / WEB.typeSecs, 0, 1);
  g.fillStyle = '#9a6bb0';
  g.fillRect(31, 29, (60 + (seed % 3) * 12) * typed, 5);
  const loaded = t - WEB.typeSecs - WEB.loadSecs;
  if (t > WEB.typeSecs && loaded < 0) {
    // Loading: three dots chasing around.
    for (let k = 0; k < 3; k++) {
      const a = t * 9 + k * 2.1;
      g.fillStyle = k ? '#c9a888' : '#e0703c';
      g.beginPath();
      g.arc(w / 2 + Math.cos(a) * 8, 76 + Math.sin(a) * 8, 3, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  for (let k = 0; k < WEB.results; k++) {
    const pop = THREE.MathUtils.clamp((loaded - k * WEB.resultSecs) / 0.15, 0, 1);
    if (pop <= 0) break;
    const y = 50 + k * 22;
    const slide = (1 - pop) * 10;
    g.globalAlpha = pop;
    g.fillStyle = '#3e7486';
    g.fillRect(12 + slide, y, 50 + ((seed + k) % 3) * 16, 6);
    g.fillStyle = '#c9a888';
    g.fillRect(12 + slide, y + 9, 110, 4);
    g.fillRect(12 + slide, y + 15, 80 + ((seed * 3 + k) % 4) * 8, 4);
    g.globalAlpha = 1;
  }
}
function drawTerminal(g, t, output) {
  const [w, h] = TERM.px;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#2b2230';
  g.beginPath();
  g.roundRect(0, 0, w, h, 10);
  g.fill();
  g.fillStyle = '#3d3243';
  g.beginPath();
  g.roundRect(0, 0, w, 16, [10, 10, 0, 0]);
  g.fill();
  ['#e0703c', '#f0b24a', '#6fae8a'].forEach((c, k) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(12 + k * 11, 8, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  const rowH = 14;
  const top = 24;
  // The command line scrolls off the top with everything else once the
  // output fills the window.
  const printed = Math.max(0, Math.floor((t - TERM.typeSecs - 0.15) / TERM.lineSecs));
  const rows = [{ prompt: true }, ...output.slice(0, printed)];
  const first = Math.max(0, rows.length - TERM.rows);
  let y = top;
  let cursorX = 0;
  for (let k = first; k < rows.length; k++) {
    const row = rows[k];
    if (row.prompt) {
      g.fillStyle = '#e0703c';
      g.font = 'bold 13px monospace';
      g.fillText('>', 8, y + 5);
      const typed = THREE.MathUtils.clamp(t / TERM.typeSecs, 0, 1) * 70;
      g.fillStyle = '#ffe6bd';
      g.fillRect(22, y - 3, typed, 6);
      cursorX = 22 + typed + 3;
    } else {
      g.fillStyle = row.color;
      g.fillRect(8, y - 3, row.len, 6);
      cursorX = 8 + row.len + 3;
    }
    y += rowH;
  }
  if (Math.floor(t * 3) % 2 === 0) {
    g.fillStyle = '#ffe6bd';
    g.fillRect(cursorX, y - rowH - 5, 6, 10);
  }
}
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w, SHEET.h), readPages[0].mat);
sheet.visible = false;
body.add(sheet);

let sheetT = 0;     // seconds into the current sheet's visit
let sheetCount = 0; // which sheet this is, to vary the page
let readLine = 0;   // 0..1 down the page, for his eyes while reading
let writeLine = 0;  // 0..1 down the page, how far the code has filled in
let sheetFlick = 0; // 0..1, his arm swatting the sheet away
const writeSweep = { on: 0, lift: 0 }; // his writing arm: how far into the pass, and its height

// Where his eyes are while reading `lines` lines, `f` (0..1) of the way
// through: along runs 0..1 across the current line, then snaps back.
const reading = { along: 0, line: 0 };
function readAlong(f, lines) {
  const at = Math.min(f * lines, lines - 0.001);
  const u = at % 1;
  reading.along = u < 0.8 ? u / 0.8 : 1 - (u - 0.8) / 0.2;
  reading.line = Math.floor(at);
}

function updateSheet(step) {
  const pick = { read: P.sheets, write: P.write, run: P.term, web: P.web };
  const mode = Object.keys(pick).reduce((a, b) => (pick[b] > pick[a] ? b : a));
  const writing = mode === 'write';
  const show = Math.max(P.sheets, P.write, P.term, P.web) * Math.max(0, 1 - P.star);
  sheet.visible = show > 0.02;
  sheetFlick = 0;
  writeSweep.on = 0;
  if (!sheet.visible) { sheetT = 0; return; }
  const hold = SHEET[mode];
  const cycle = SHEET.in + hold + SHEET.out;
  sheetT += step;
  if (sheetT > cycle) {
    sheetT -= cycle;
    sheetCount++;
  }
  const page = { run: termPage, web: webPage, write: writePage }[mode] ?? readPages[sheetCount % readPages.length];
  sheet.material = page.mat;
  let x = 0, lean = 0, stretch = 0, progress = 0;
  if (sheetT < SHEET.in) {
    // Whizzes in from the right, overshoots and settles.
    const u = sheetT / SHEET.in;
    x = (1 - easeOutOvershoot(u)) * SHEET.from;
    lean = (1 - u) * 0.5;
    stretch = (1 - u) * 0.6;
  } else if (sheetT < SHEET.in + hold) {
    progress = (sheetT - SHEET.in) / hold;
  } else {
    // A small pull back to the right as he winds up, then it zooms off left.
    const u = (sheetT - SHEET.in - hold) / SHEET.out;
    x = -(u * u * (1 + 2.2 * u) - 0.25 * Math.sin(u * Math.PI)) * SHEET.from / 3.2;
    lean = -u * 0.5;
    stretch = u * 0.8;
    sheetFlick = Math.sin(Math.min(1, u * 1.4) * Math.PI);
    progress = 1;
  }
  readLine = progress;
  const bob = Math.sin(time * 1.6) * 0.02;
  sheet.position.set(SHEET.at[0] + x, SHEET.at[1] + bob, SHEET.at[2]);
  sheet.rotation.set(SHEET.tilt, 0, lean);
  const size = { run: TERM, web: WEB }[mode];
  const [sx, sy] = size ? [size.w / SHEET.w, size.h / SHEET.h] : [1, 1];
  sheet.scale.set((1 + stretch) * show * sx, (1 - stretch * 0.3) * show * sy, 1);
  const since = Math.max(0, sheetT - SHEET.in);
  if (mode === 'run') {
    drawTerminal(page.g, since, termOutput[sheetCount % termOutput.length]);
    page.tex.needsUpdate = true;
  }
  webTyping = 0;
  if (mode === 'web') {
    drawBrowser(page.g, since, sheetCount);
    page.tex.needsUpdate = true;
    webTyping = since > 0 && since < WEB.typeSecs && progress < 1 ? 1 : 0;
    const loadedAt = WEB.typeSecs + WEB.loadSecs;
    webSkim = THREE.MathUtils.clamp((since - loadedAt) / (SHEET.web - loadedAt), 0, 1);
  }
  if (!writing) return;

  // His arm rises to the top of the page, then passes down it with the code
  // filling in just behind, and drops back to rest at the end.
  const pass = THREE.MathUtils.clamp((progress - SWEEP.start) / (SWEEP.end - SWEEP.start), 0, 1);
  writeLine = pass * pass * (3 - 2 * pass);
  const raised = THREE.MathUtils.smoothstep(progress, 0, SWEEP.windup) * (1 - THREE.MathUtils.smoothstep(progress, SWEEP.end, 1));
  writeSweep.on = raised * P.write;
  writeSweep.lift = SWEEP.top + (SWEEP.bottom - SWEEP.top) * writeLine;
  drawSheet(page.g, writeWords[sheetCount % writeWords.length], Math.max(0, writeLine * 1.08 - 0.04));
  page.tex.needsUpdate = true;
}

// Thinking: a little thought bubble pops up beside his head with three dots
// bouncing in a wave inside, like a chat app's "typing…". ?bubble=0 hides it.
// at: where it sits (in his space); size: its width; bob: how far the dots
// hop; trail: the two small circles leading back to his head
const BUBBLE = { at: [0.95, 1.37], size: 0.66, px: [112, 66], bob: 4.5, hz: 1.4, popSecs: 0.35, trail: [[-0.46, -0.31, 0.04], [-0.35, -0.21, 0.075]] };
const BUBBLE_ON = params.get('bubble') !== '0';

const bubbleCanvas = document.createElement('canvas');
[bubbleCanvas.width, bubbleCanvas.height] = BUBBLE.px;
const bubbleG = bubbleCanvas.getContext('2d');
const bubbleTex = new THREE.CanvasTexture(bubbleCanvas);
bubbleTex.colorSpace = THREE.SRGBColorSpace;
// alphaTest rather than blending: a half-transparent edge shows up as a dark
// fringe over the transparent window.
const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, alphaTest: 0.5 }));
bubble.visible = false;
root.add(bubble);
const bubbleTrail = BUBBLE.trail.map(() => {
  const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), alphaTest: 0.5 }));
  d.visible = false;
  root.add(d);
  return d;
});
let bubbleT = 0;

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff4e0';
  g.strokeStyle = '#b58f6c';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawBubble(t) {
  const [w, h] = BUBBLE.px;
  const g = bubbleG;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff4e0';
  g.strokeStyle = '#b58f6c';
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, (h - 8) / 2);
  g.fill();
  g.stroke();
  // Three dots hop in turn, each a little after the one before.
  for (let k = 0; k < 3; k++) {
    const hop = Math.max(0, Math.sin(t * BUBBLE.hz * Math.PI * 2 - k * 0.9));
    g.fillStyle = ['#c9a888', '#e0703c', '#c9a888'][k];
    g.beginPath();
    g.arc(w / 2 + (k - 1) * 24, h / 2 + 3 - hop * BUBBLE.bob * 2, 7.5, 0, Math.PI * 2);
    g.fill();
  }
  bubbleTex.needsUpdate = true;
}

function updateBubble(step) {
  const show = BUBBLE_ON ? P.ponder * Math.max(0, 1 - P.star) : 0;
  bubbleT = show > 0.02 ? bubbleT + step : 0;
  const on = show > 0.02;
  bubble.visible = on;
  bubbleTrail.forEach((d) => { d.visible = on; });
  if (!on) return;
  // The trail puffs up first, then the bubble pops in after it.
  const pop = (delay) => Math.max(0.001, easeOutBack(THREE.MathUtils.clamp((bubbleT - delay) / BUBBLE.popSecs, 0, 1)));
  const [x, y] = BUBBLE.at;
  const bx = body.position.x + x;
  const by = body.position.y + y + Math.sin(time * 1.8) * 0.02;
  bubbleTrail.forEach((d, k) => {
    const [dx, dy, r] = BUBBLE.trail[k];
    d.position.set(bx + dx, by + dy, 0.4);
    d.scale.setScalar(r * 2 * pop(k * 0.12) * show);
  });
  const s = pop(0.24) * show;
  bubble.position.set(bx, by, 0.4);
  bubble.scale.set(BUBBLE.size * s, BUBBLE.size * (BUBBLE.px[1] / BUBBLE.px[0]) * s, 1);
  drawBubble(bubbleT);
}

// Asleep: Z's drift up from his head one after another, swaying side to side
// and growing as they rise, then shrink away near the top. Each one moves off
// quickly and slows as it rises, so the next one has room to appear.
// every: seconds between Z's; life: how long each one lasts; from/to: where
// they start and end up (in his space); size: smallest and largest
const ZS = { every: 1.4, life: 3.6, from: [0.4, 0.85], to: [0.95, 1.45], size: [0.12, 0.28], sway: 0.08 };

function zTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 56px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#b58f6c';
  g.strokeText('z', 32, 30);
  g.fillStyle = '#fff4e0';
  g.fillText('z', 32, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const zTex = zTexture();
const zs = Array.from({ length: Math.ceil(ZS.life / ZS.every) }, () => {
  const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, alphaTest: 0.5 }));
  z.visible = false;
  root.add(z);
  return z;
});
let zT = 0;

function updateZs(step) {
  const on = state === 'sleeping' && doze.done && P.star < 0.5;
  zT = on ? zT + step : 0;
  zs.forEach((z, k) => {
    // Each Z takes its turn; age is how far through its life it is.
    const age = (zT - k * ZS.every) % (zs.length * ZS.every);
    const u = age / ZS.life;
    z.visible = on && zT > k * ZS.every && u < 1;
    if (!z.visible) return;
    const grow = THREE.MathUtils.lerp(ZS.size[0], ZS.size[1], u);
    const pop = Math.min(1, u / 0.12) * (u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1);
    const [x0, y0] = ZS.from;
    const [x1, y1] = ZS.to;
    const rise = 1 - (1 - u) ** 2;
    z.position.set(
      body.position.x + THREE.MathUtils.lerp(x0, x1, rise) + Math.sin(u * Math.PI * 3) * ZS.sway,
      body.position.y + THREE.MathUtils.lerp(y0, y1, rise),
      0.4,
    );
    z.scale.setScalar(Math.max(0.001, grow * 2 * pop));
    z.material.rotation = Math.sin(u * Math.PI * 3) * 0.3;
  });
}

// Fills in `doze` for this frame: how much the yawn squashes, tips and lifts
// his arms, and how closed his eyes are (null when sleep takes over).
function updateDoze(now) {
  doze.squash = doze.pitch = doze.arms = 0;
  doze.closed = null;
  doze.done = true;
  doze.settle = 1;
  if (state !== 'sleeping') return;
  let t = (now - stateSince) / 1000;
  if (LOCKED === 'sleeping') t = DOZE_LOOP ? t % DOZE.loop : DOZE.end;
  if (t >= DOZE.end) return;
  doze.done = false;
  doze.settle = THREE.MathUtils.smoothstep(t, DOZE.yawn, DOZE.end);
  const pulse = (a, b) => Math.sin(Math.PI * THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
  // The yawn: up tall with his arms stretched out, eyes screwed shut...
  const yawn = pulse(0, DOZE.yawn);
  doze.squash = -DOZE.stretch * yawn;
  doze.arms = DOZE.arms * yawn;
  doze.pitch = -0.06 * yawn;
  // ...landing in a squish.
  doze.squash += 0.05 * pulse(DOZE.yawn, DOZE.yawn + 0.3);
  // Eyes: screwed shut for the yawn, open halfway after it, then drifting
  // closed.
  const closed = t < DOZE.yawn ? 0.3 + 0.7 * yawn : 0.5;
  doze.closed = THREE.MathUtils.lerp(closed, 1, THREE.MathUtils.smoothstep(t, DOZE.yawn + 0.2, DOZE.end));
}

// ---------------------------------------------------------------------------
// Helpers: each running subagent is a mini-me that circles him until it
// finishes. He makes them on purpose: crouches with effort, reaches out an arm,
// a bulb swells at its tip and pinches off. When one finishes he reaches out,
// catches it and pulls it back in. Helpers share his deforming mesh and
// material, so they wobble, jiggle and transform along with him.
// ---------------------------------------------------------------------------
// The ring is tilted (tilt) so helpers pass over his head in front instead of
// across his face, and dip lower behind him.
const MINION = { scale: 0.3, rx: 1.4, rz: 0.9, y: 0.3, tilt: 0.45, speed: 0.8, inSecs: 1.1, maxAgeMs: 30 * 60 * 1000 };
// Gesture timings, in seconds from the start of the gesture.
const BUD = { crouch: 0.35, pinch: 0.85, end: 1.4 };
// A finished helper backs out, loops up and over his head with a somersault,
// and zooms down onto the top of it. Rising above his head first means you
// see it come home even when it starts out behind him.
// rise: how high above where it wound up the loop climbs first; apex: the top
// of the loop over his head (x is pulled toward the middle by pull); land:
// where on his head it lands, as a direction from his middle
const CATCH = { windup: 0.45, hit: 1.35, end: 1.75, rise: 0.9, apex: [0, 1.75, 0.7], pull: 0.3, land: [0, 1, 0.35] };
const catchFrom = new THREE.Vector3();
const catchC1 = new THREE.Vector3();
const catchC2 = new THREE.Vector3();
const catchTo = new THREE.Vector3();
const catchLand = new THREE.Vector3(...CATCH.land).normalize();

// A point u (0..1) along the cubic curve a -> b -> c -> d.
function bezier(a, b, c, d, u, out) {
  const v = 1 - u;
  return out.set(0, 0, 0)
    .addScaledVector(a, v * v * v)
    .addScaledVector(b, 3 * v * v * u)
    .addScaledVector(c, 3 * v * u * u)
    .addScaledVector(d, u * u * u);
}
const minions = [];
let orbitAngle = 0;

// One gesture plays at a time; extra spawns and catches wait their turn.
const gestures = [];
let gesture = null;
let budSide = 1;
const reach = [0, 0];       // how far each arm is stretched out, 0..1
const reachTarget = [0, 0];
let gestureSquash = 0;      // crouch (+) or stretch (-) added to his squash
let gestureSquint = 0;      // 0..1, eyes scrunched with effort or contentment
let gestureLook = null;     // where he's looking during a gesture, or null

function makeMinion() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, bodyMat));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyes[0].children[0].geometry, eyeMat);
    eye.scale.set(0.12, 0.2, 0.06);
    eye.position.set(side * 0.3, 0.15, 0.93);
    const sparkle = new THREE.Mesh(eyes[0].children[1].geometry, sparkleMat);
    sparkle.scale.set(0.04, 0.05, 0.02);
    sparkle.position.set(side * 0.3 - 0.03, 0.22, 0.99);
    g.add(eye, sparkle);
  }
  g.scale.setScalar(0.001);
  root.add(g);
  return g;
}

function spawnMinion(session) {
  gestures.push({ kind: 'bud', session });
}

// The Agent call that buds a helper doesn't know the subagent's id yet, so the
// first event carrying a new id claims the session's oldest unclaimed helper.
function bindMinion(session, agent) {
  const helpers = [...minions, ...gestures.filter((g) => g.kind === 'bud' && !g.minion)];
  if (helpers.some((x) => x.agent === agent)) return;
  const free = helpers.find((x) => x.session === session && !x.agent && !x.leaving);
  if (free) free.agent = agent;
}

// Retires the helper bound to `agent`, else the session's oldest unclaimed one.
function retireMinion(session, agent) {
  const waiting = (x) => !x.leaving && (x.phase === 'in' || x.phase === 'orbit');
  const m = (agent && minions.find((x) => waiting(x) && x.agent === agent))
    ?? minions.find((x) => waiting(x) && x.session === session && !x.agent)
    ?? minions.find((x) => waiting(x) && (!session || x.session === session))
    ?? minions.find(waiting);
  if (!m) return;
  m.leaving = true;
  gestures.push({ kind: 'catch', minion: m });
}

function easeOutBack(x) {
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

const smooth = (x) => THREE.MathUtils.smoothstep(x, 0, 1);

// A point at angle a on the ring scaled by r (1 = on the ring), at height y.
function polarToRing(a, r, y, out) {
  return out.set(Math.cos(a) * MINION.rx * r, y, Math.sin(a) * MINION.rz * r);
}

// Back-out curve with a stronger kick than easeOutBack, for the swoop past the ring.
function easeOutOvershoot(x) {
  const c = 2.6;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

// Where the end of an arm is right now, in the root's space (where helpers
// live): the deformed surface at the arm's center, nudged out so a bulb sits
// on the tip rather than inside it.
function armTip(i, out) {
  const a = armRest[i];
  surface(a.x, a.y, a.z, out);
  out.addScaledVector(armDirs[i], MINION.scale * 0.45);
  return out.applyMatrix4(body.matrix);
}

function startGesture(g) {
  g.t = 0;
  if (g.kind === 'bud') {
    budSide = -budSide;
    g.side = budSide;
  } else {
    g.side = Math.cos(g.minion.angle) >= 0 ? 1 : -1; // the arm on the helper's side
    g.angle = g.minion.angle;
    g.minion.phase = 'caught';
    g.minion.from = g.minion.group.position.clone();
    g.minion.t = 0;
  }
  g.arm = g.side > 0 ? 1 : 0;
  gesture = g;
}

function updateGesture(step) {
  gestureSquash = 0;
  gestureSquint = 0;
  gestureLook = null;
  if (!gesture && gestures.length) startGesture(gestures.shift());
  const g = gesture;
  if (!g) return;
  g.t += step;
  const t = g.t;
  const tip = armTip(g.arm, tmp2);

  if (g.kind === 'bud') {
    if (t < BUD.crouch) {
      // Gather himself: crouch, scrunch, eye the spot.
      const u = smooth(t / BUD.crouch);
      gestureSquash = 0.12 * u;
      gestureSquint = u;
      gestureLook = { x: g.side * 0.8, y: 0.05 };
    } else if (t < BUD.pinch) {
      // Reach out; a bulb swells at the end of the arm.
      const u = smooth((t - BUD.crouch) / (BUD.pinch - BUD.crouch));
      reachTarget[g.arm] = 1;
      gestureSquash = 0.12 * (1 - u);
      gestureSquint = 1 - 0.6 * u;
      gestureLook = { x: g.side * 0.9, y: 0.1 };
      if (!g.minion) {
        g.minion = {
          session: g.session, agent: g.agent, group: makeMinion(), phase: 'budding', t: 0,
          born: performance.now(), angle: orbitAngle, bob: Math.random() * Math.PI * 2,
        };
        minions.push(g.minion);
      }
      g.minion.group.position.copy(tip);
      g.minion.group.scale.setScalar(MINION.scale * 0.85 * Math.max(0.001, u));
    } else {
      if (g.minion.phase === 'budding') {
        // Pinch off: the arm snaps back, the helper pops free, he recoils.
        reachTarget[g.arm] = 0;
        g.minion.phase = 'in';
        g.minion.t = 0;
        g.minion.from = g.minion.group.position.clone();
        g.minion.angle = Math.atan2(g.minion.from.z / MINION.rz, g.minion.from.x / MINION.rx);
        poke(blobScreen.x + g.side * blobScreen.r * 0.7, blobScreen.y);
      }
      // Watch it float off.
      const u = (t - BUD.pinch) / (BUD.end - BUD.pinch);
      gestureSquash = -0.06 * Math.max(0, 1 - u * 3);
      gestureLook = { x: g.side * 0.6, y: 0.45 };
      if (t >= BUD.end) gesture = null;
    }
  } else {
    // Homecoming: the helper backs out to wind up, loops up over his head and
    // dives onto the top of it. He looks up to watch it come and braces.
    const m = g.minion;
    const a = g.angle;
    if (t < CATCH.windup) {
      const u = smooth(t / CATCH.windup);
      polarToRing(a, 1 + 0.4 * u, m.from.y + 0.15 * u, m.group.position);
      m.group.scale.set(MINION.scale * (1 + 0.15 * u), MINION.scale * (1 - 0.2 * u), MINION.scale * (1 + 0.15 * u));
      gestureSquash = 0.04 * u;
      gestureLook = { x: g.side * 0.8, y: 0.3 };
    } else if (t < CATCH.hit) {
      // The loop: up and over, somersaulting, speeding up into the dive.
      const u = (t - CATCH.windup) / (CATCH.hit - CATCH.windup);
      if (!g.looping) {
        g.looping = true;
        catchFrom.copy(m.group.position);
      }
      surface(catchLand.x, catchLand.y, catchLand.z, catchTo).applyMatrix4(body.matrix);
      catchTo.y += MINION.scale * 0.6;
      catchC1.copy(catchFrom).y += CATCH.rise;
      catchC2.set(catchFrom.x * CATCH.pull + CATCH.apex[0], body.position.y + CATCH.apex[1], CATCH.apex[2]);
      const e = u * u * (3 - 2 * u) * 0.5 + u * u * 0.5;
      bezier(catchFrom, catchC1, catchC2, catchTo, e, m.group.position);
      m.spin = -Math.PI * 2 * smooth(u);
      // Stretched along its path as it speeds up.
      const speed = u * u;
      m.group.scale.set(MINION.scale * (1 - 0.15 * speed), MINION.scale * (1 + 0.2 * speed), MINION.scale * (1 - 0.15 * speed));
      gestureLook = {
        x: THREE.MathUtils.clamp(m.group.position.x / 1.4, -1, 1) * 0.8,
        y: THREE.MathUtils.lerp(0.4, 1, smooth(u)),
      };
      gestureSquash = 0.04 + 0.04 * u; // bracing
    } else {
      if (minions.includes(m)) {
        // Impact on top of his head: a jello wobble out from where it landed.
        root.remove(m.group);
        minions.splice(minions.indexOf(m), 1);
        poke(blobScreen.x, blobScreen.y - blobScreen.r * 0.95);
      }
      // Content little squint.
      gestureSquint = 0.7 * Math.sin(Math.min(1, (t - CATCH.hit) / (CATCH.end - CATCH.hit)) * Math.PI);
      gestureLook = null;
      if (t >= CATCH.end) gesture = null;
    }
  }
}

function updateMinions(step, now) {
  orbitAngle += step * MINION.speed;
  const orbiting = minions.filter((m) => m.phase === 'in' || m.phase === 'orbit');
  for (const m of minions) {
    m.t += step;
    if (!m.leaving && now - m.born > MINION.maxAgeMs) retireMinion(m.session, m.agent); // never heard back
    if (m.phase === 'budding' || m.phase === 'caught') continue; // the gesture moves these
    // Spread evenly around the ring, sliding over as helpers come and go.
    const i = orbiting.indexOf(m);
    const slot = orbitAngle + (i / orbiting.length) * Math.PI * 2;
    const d = Math.atan2(Math.sin(slot - m.angle), Math.cos(slot - m.angle));
    m.angle += d * (1 - Math.exp(-step * 3));
    tmp.set(
      Math.cos(m.angle) * MINION.rx,
      body.position.y + MINION.y + Math.sin(m.angle) * MINION.tilt + Math.sin(time * 2.2 + m.bob) * 0.08,
      Math.sin(m.angle) * MINION.rz,
    );
    const g = m.group;
    if (m.phase === 'in') {
      // Swoop out on a curve: sweep round toward its slot while flying out past
      // the ring, arc up, then ease back in to settle into place.
      const e = Math.min(1, m.t / MINION.inSecs);
      const fromA = Math.atan2(m.from.z / MINION.rz, m.from.x / MINION.rx);
      const fromR = Math.hypot(m.from.x / MINION.rx, m.from.z / MINION.rz);
      const da = Math.atan2(Math.sin(m.angle - fromA), Math.cos(m.angle - fromA));
      const a = fromA + da * (1 - (1 - e) ** 3);
      const r = fromR + (1 - fromR) * easeOutOvershoot(e);
      const y = THREE.MathUtils.lerp(m.from.y, tmp.y, smooth(e)) + Math.sin(e * Math.PI) * 0.3;
      polarToRing(a, r, y, g.position);
      g.scale.setScalar(MINION.scale * THREE.MathUtils.lerp(0.85, 1, easeOutBack(e)));
      if (e >= 1) m.phase = 'orbit';
    } else {
      g.position.copy(tmp);
      g.scale.setScalar(MINION.scale * (1 + Math.sin(time * 5 + m.bob) * 0.04));
    }
  }
  for (const m of minions) {
    m.group.rotation.set(m.spin ?? 0, Math.sin(time * 1.3 + m.bob) * 0.3, Math.sin(time * 2 + m.bob) * 0.12);
  }
  for (let i = 0; i < 2; i++) reach[i] += (reachTarget[i] - reach[i]) * (1 - Math.exp(-step * 10));
}
window.__minions = minions;

// ---------------------------------------------------------------------------
// UI elements
// ---------------------------------------------------------------------------
const bubbleEl = document.getElementById('bubble');
const bubbleLabel = document.getElementById('bubble-label');
const bubbleText = document.getElementById('bubble-text');
const chipEl = document.getElementById('chip');
const shadowEl = document.getElementById('shadow');
const pulseEl = document.getElementById('pulse');

let bubbleSession = null;
let bubbleTimer = null;

function showBubble(text, label, { timeout = 0, attention = false, session = null } = {}) {
  bubbleText.textContent = text;
  bubbleLabel.textContent = label || '';
  bubbleEl.classList.toggle('attention', attention);
  bubbleEl.classList.remove('hidden');
  bubbleSession = session;
  clearTimeout(bubbleTimer);
  if (timeout) bubbleTimer = setTimeout(hideBubble, timeout);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleEl.classList.add('hidden');
  bubbleSession = null;
}

// ---------------------------------------------------------------------------
// Claude Code session tracking
// ---------------------------------------------------------------------------
let state = 'idle';
let stateSince = performance.now();
let lastEventAt = performance.now();
// One entry per live Claude Code session. The blob shows a derived view of all
// of them, so no session's events can overwrite another's.
const sessions = new Map(); // id -> { id, project, activity, at, ask, askedAt, agents, awaitingAgents }
let current = null; // id of the session the blob is showing
const tintTarget = new THREE.Color('#ffffff');
const spring = { x: 0, v: 0 };
const spin = { t: 1, turns: 1, dir: 1, secs: 0.9 };

function startSpin(turns, secs, dir = 1) {
  Object.assign(spin, { t: 0, turns, secs, dir });
}

function projectOf(cwd) {
  return cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '';
}

function updateChip() {
  const label = LABELS[state];
  const project = sessions.get(current)?.project;
  chipEl.replaceChildren(...[[label, 'action'], [project, 'repo']]
    .filter(([text]) => text)
    .map(([text, cls]) => Object.assign(document.createElement('div'), { className: cls, textContent: text })));
  chipEl.classList.toggle('hidden', !label && !project);
}

function setState(next) {
  stateSince = performance.now();
  if (next === state) return;
  const prev = state;
  state = next;
  target = { ...DEFAULTS, ...STATES[next] };
  if (starMode) target.star = 1;
  tintTarget.set(TINTS[next] || '#ffffff');
  if (next === 'done') startSpin(1, 0.9);
  if (next === 'dizzy') startSpin(2, 1.1, spin.dir);
  spring.v -= prev === 'sleeping' || next === 'attention' ? 3 : 1.2;
  updateChip();
}

const WORKING = new Set(['thinking', 'attention', ...Object.values(TOOL_STATES)]);
// A session silent this long is presumed dead (killed without a SessionEnd).
const STALE_MS = 15 * 60 * 1000;

function sessionFor(e) {
  let s = sessions.get(e.session);
  if (!s) sessions.set(e.session, s = { id: e.session, activity: 'idle', ask: null, askedAt: 0, agents: new Set() });
  s.project = projectOf(e.cwd) || s.project || '';
  s.at = performance.now();
  return s;
}

function pendingAsks() {
  return [...sessions.values()].filter((s) => s.ask).sort((a, b) => a.askedAt - b.askedAt);
}

function liveSession() {
  const now = performance.now();
  let live = null;
  for (const s of sessions.values()) {
    if (s.activity !== 'idle' && now - s.at < STALE_MS && (!live || s.at > live.at)) live = s;
  }
  return live;
}

function latestSession() {
  let latest = null;
  for (const s of sessions.values()) if (!latest || s.at > latest.at) latest = s;
  return latest;
}

// Points the blob at whatever matters most: the oldest unanswered ask, else the
// most recently active session, else stays on the last one shown. `release` lets a transient state (done, dizzy)
// fall back to idle when nothing is going on.
function settle({ release = false } = {}) {
  if (LOCKED) return;
  const asks = pendingAsks();
  if (asks.length) {
    const ask = asks[0];
    const label = asks.length > 1 ? `${ask.project} · +${asks.length - 1} more` : ask.project;
    current = ask.id;
    setState('attention');
    showBubble(ask.ask, label, { attention: true, session: ask.id });
  } else {
    if (bubbleEl.classList.contains('attention')) hideBubble();
    const live = liveSession();
    if (!sessions.has(current)) current = latestSession()?.id ?? null;
    if (live) {
      current = live.id;
      setState(live.activity);
    } else if (release || WORKING.has(state)) {
      setState('idle');
    }
  }
  updateChip();
}

function dismissAsk(id) {
  const s = sessions.get(id);
  if (s) s.ask = null;
  hideBubble();
  settle();
}

function onEvent(e) {
  if (!e || !e.event) return;
  lastEventAt = performance.now();
  const s = sessionFor(e);

  // Anything a session does after asking means the ask was handled.
  if (e.event !== 'Notification') s.ask = null;
  if (!e.agent) s.awaitingAgents = false;
  if (e.agent && e.event !== 'SubagentStop') {
    s.agents.add(e.agent);
    bindMinion(e.session, e.agent);
  }

  switch (e.event) {
    case 'SessionStart':
      if (state === 'sleeping') setState('idle');
      break;
    // Subagent tool calls (tagged with `agent`) belong to the minions, so the
    // session keeps showing what its main agent is doing.
    case 'UserPromptSubmit':
    case 'PostToolUse':
      if (!e.agent) s.activity = 'thinking';
      break;
    case 'PreToolUse':
      if (e.tool === 'Agent' || e.tool === 'Task') spawnMinion(e.session);
      if (!e.agent) s.activity = TOOL_STATES[e.tool] || 'thinking';
      break;
    case 'Notification': {
      const msg = e.message || 'Claude needs your attention';
      const idle = e.type === 'idle_prompt' || /waiting for your input/i.test(msg);
      if (!idle) {
        s.ask = msg;
        s.askedAt = performance.now();
      } else if (!pendingAsks().length) {
        showBubble(msg, s.project, { timeout: 8000, session: e.session });
        spring.v -= 2;
      }
      break;
    }
    case 'Stop':
      // Background subagents outlive the main agent's turn.
      s.agents = new Set(e.tasks || []);
      s.awaitingAgents = s.agents.size > 0;
      s.activity = s.awaitingAgents ? 'delegating' : 'idle';
      if (s.agents.size || pendingAsks().length) break;
      if (liveSession()) {
        showBubble('Finished', s.project, { timeout: 5000 });
      } else {
        current = s.id;
        setState('done');
        showBubble('All done ✓', s.project, { timeout: 5000 });
      }
      break;
    case 'SubagentStop':
      retireMinion(e.session, e.agent);
      s.agents.delete(e.agent);
      if (s.awaitingAgents && !s.agents.size) {
        s.awaitingAgents = false;
        s.activity = 'idle';
      }
      break;
    case 'SessionEnd':
      for (const m of minions) if (m.session === e.session) retireMinion(e.session);
      sessions.delete(e.session);
      break;
  }
  settle();
}

api.onEvent(onEvent);
window.__emit = onEvent; // handy for poking it from devtools
window.__sessions = sessions;

// ---------------------------------------------------------------------------
// Mouse: click-through except over the blob/bubble, drag to move, click to boop
// ---------------------------------------------------------------------------
let W = 1, H = 1;
let cursor = null;
let interactive = false;
let press = null;
let lastClickAt = 0;
let dragging = false;
const blobScreen = { x: 0, y: 0, r: 0 };

api.onCursor((p) => { cursor = p; });

function overBubble(x, y) {
  if (bubbleEl.classList.contains('hidden')) return false;
  const r = bubbleEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function overBlob(x, y) {
  return Math.hypot(x - blobScreen.x, (y - blobScreen.y) * 1.15) < blobScreen.r;
}

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  api.setIgnore(!v);
  if (v) spring.v -= 0.8;
}

window.addEventListener('mousemove', (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  if (press && !dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    dragging = true;
    api.dragStart();
  }
  if (!press && !dragging) setInteractive(overBlob(e.clientX, e.clientY) || overBubble(e.clientX, e.clientY));
});

window.addEventListener('mousedown', (e) => {
  if (e.button === 0 && interactive) press = { x: e.screenX, y: e.screenY };
});

window.addEventListener('mouseup', (e) => {
  if (dragging) {
    api.dragEnd();
    dragging = false;
  } else if (press) {
    if (bubbleSession && bubbleEl.classList.contains('attention')) dismissAsk(bubbleSession);
    else if (overBubble(e.clientX, e.clientY) || !bubbleEl.classList.contains('hidden')) hideBubble();
    poke(e.clientX, e.clientY);
    if (state === 'sleeping') setState('idle');
    const now = performance.now();
    if (now - lastClickAt < 350) toggleStar();
    lastClickAt = now;
    lastEventAt = now;
  }
  press = null;
});

// Pokes stack up to a point, so tapping repeatedly gets him really wobbling.
function poke(x, y) {
  const r = blobScreen.r || 1;
  // Rough spot on his body from the click's offset from his center.
  jiggle.origin.set((x - blobScreen.x) / r, -(y - blobScreen.y) / r, 0.8).normalize();
  jiggle.amp = Math.min(jiggleNow + JIGGLE.amp, JIGGLE.amp * 1.8);
  jiggle.t = 0;
  spring.v -= 1.5;
}
window.__poke = poke;

function toggleStar() {
  starMode = !starMode;
  target.star = starMode || state === 'done' ? 1 : 0;
}
window.__toggleStar = toggleStar;

window.addEventListener('mouseleave', () => { if (!press && !dragging) setInteractive(false); });

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.contextMenu();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const look = new THREE.Vector2();
const lookTarget = new THREE.Vector2();
let time = 0;
let hopPhase = 0;
let blinkAt = 2;
let blink = 0;
let last = performance.now();
let sinceRender = 0;
let lastMinionDemo = -1e9;

// Dizzy gesture: while he's idle, circling the cursor around his eyes three
// whole times in one direction (without stopping for long) spins him dizzy.
const eyesScreen = { x: 0, y: 0 };
// against: how far the cursor has gone backwards, so a brief wobble doesn't
// count as reversing direction.
const circling = { last: null, total: 0, against: 0, at: 0, cursor: null };
const DIZZY_TURNS = 3;
window.__circling = circling; // for checking the gesture from devtools
window.__eyesScreen = eyesScreen;

function trackCircles(now) {
  if (state !== 'idle' || starMode || !cursor) {
    circling.last = null;
    circling.total = 0;
    return;
  }
  if (now - circling.at > 1200) circling.total = 0; // paused too long
  // Only measure when the cursor actually moves; his own bobbing would
  // otherwise jitter the angle.
  if (cursor === circling.cursor) return;
  circling.cursor = cursor;
  const dx = cursor.x - eyesScreen.x;
  const dy = cursor.y - eyesScreen.y;
  const dist = Math.hypot(dx, dy);
  // Too close to tell the direction, or too far away to be circling him.
  if (dist < 15 || dist > 260) {
    circling.last = null;
    return;
  }
  const a = Math.atan2(dy, dx);
  if (circling.last !== null) {
    let d = a - circling.last;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (circling.total === 0 || Math.sign(d) === Math.sign(circling.total)) {
      circling.total += d;
      circling.against = Math.max(0, circling.against - Math.abs(d));
    } else if ((circling.against += Math.abs(d)) > 0.8) {
      circling.total = d; // genuinely circling the other way now
      circling.against = 0;
    }
    circling.at = now;
  }
  circling.last = a;
  if (Math.abs(circling.total) >= Math.PI * 2 * DIZZY_TURNS) {
    spin.dir = Math.sign(circling.total);
    circling.total = 0;
    setState('dizzy');
  }
}

function toScreen(v) {
  v.project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Sleep is cheap: drop to ~20fps.
  sinceRender += dt;
  if (state === 'sleeping' && sinceRender < 0.05) return;
  const step = sinceRender;
  sinceRender = 0;
  time += step;

  if (!LOCKED && state === 'idle' && now - lastEventAt > SLEEP_AFTER_MS) setState('sleeping');
  if (state === 'done' && now - stateSince > DONE_HOLD_MS) settle({ release: true });
  if (state === 'dizzy' && now - stateSince > DIZZY_MS) settle({ release: true });
  // Re-derive now and then so a session that died mid-task stops holding the blob.
  if (WORKING.has(state) && now - stateSince > STALE_MS) settle();
  // A locked state that times out (like done) replays after a short rest.
  if (STATES[LOCKED] && state !== LOCKED && now - stateSince > 1500) setState(LOCKED);

  updateDoze(now);
  if (state === 'attention') {
    let t = (now - stateSince) / 1000;
    if (LOCKED === 'attention') t = ATTN_STAGE ?? t % ATTN.loop;
    attnLoud = THREE.MathUtils.smoothstep(t, ATTN.calm, ATTN.calm + ATTN.ramp);
    target.hop = ATTN.hop * attnLoud;
    target.glow = THREE.MathUtils.smoothstep(t, ATTN.glowAt, ATTN.glowAt + 1);
  } else {
    attnLoud = 0;
  }

  // Ease params toward the current state.
  const k = 1 - Math.exp(-step * 4);
  keyLight.position.lerp(keyTarget, k);
  rimLight.position.set(-keyLight.position.x, 1, -3);
  cel.uLightDir.value.lerp(celTarget, k).normalize();
  for (const key in P) if (key !== 'star') P[key] += (target[key] - P[key]) * k;

  // Transformations run on a timed curve instead of easing: wind up, rush
  // through, overshoot, settle.
  if (target.star !== starTween.to) {
    starTween.from = P.star;
    starTween.to = target.star;
    starTween.t = 0;
  }
  if (starTween.t < 1) {
    starTween.t = Math.min(1, starTween.t + step / STAR_TWEEN_S);
    const e = easeInOutBack(starTween.t);
    // The star can overshoot past full size; the ghost lands with a squish instead.
    P.star = Math.max(0, starTween.from + (starTween.to - starTween.from) * e);
    if (starTween.t === 1 && starTween.to === 0) spring.v -= 3.5;
  }
  morph = Math.max(-0.4, 4 * P.star * (1 - P.star));
  bodyMat.color.lerp(tintTarget, k);
  phase += step * P.speed;
  hemPhase += step * (0.8 + P.paddle * 5);
  halftone.uTime.value += step * (1.6 + P.paddle * 2.5) * HALFTONE_WAVE.speed / HALFTONE_WAVE.width;

  // Hop
  hopPhase += step * P.hopHz;
  const s = hopPhase % 1;
  const h = P.hop * 4 * s * (1 - s);
  const landing = P.hop > 0.01 ? Math.max(0, 1 - Math.min(s, 1 - s) * 10) : 0;

  // Boop spring
  spring.v += (-180 * spring.x - 9 * spring.v) * step;
  spring.x += spring.v * step;

  jiggle.t += step;
  jiggleNow = jiggle.amp * Math.exp(-JIGGLE.decay * jiggle.t);
  if (LOCKED === 'jiggle' && jiggle.t > 2.2) {
    poke(blobScreen.x + (Math.random() - 0.5) * blobScreen.r, blobScreen.y + (Math.random() - 0.5) * blobScreen.r);
  }

  // Thinking: he glances up to one side, then the other, with a little "hmm"
  // squish each time he switches.
  const beat = time % (THINK.glance * 2);
  ponderSide += ((beat < THINK.glance ? -1 : 1) - ponderSide) * (1 - Math.exp(-step * 12));
  const hmm = Math.max(0, 1 - (beat % THINK.glance) / 0.3);

  squash = landing * P.hop * 0.7 - h * 0.3
    + P.ponder * THINK.squish * Math.sin(hmm * Math.PI)
    + Math.sin(time * 1.7) * 0.018 * P.breath
    + P.write * 0.025 * Math.max(0, Math.sin(time * 9)) ** 2
    - P.lean * ATTN.stretch * (1 - attnLoud)
    + doze.squash
    + jiggleNow * 1.4 * Math.sin(jiggle.t * 13)
    + gestureSquash
    - spring.x * 0.05;

  const hoverY = P.hover * (0.14 + Math.sin(time * 1.4) * 0.07);
  body.position.set((Math.random() - 0.5) * P.jitter, h + hoverY + P.star * (0.12 + Math.sin(time * 2) * 0.05), 0);

  // Eye target: follow the cursor, unless the current activity overrides it.
  if (cursor) {
    lookTarget.set(
      THREE.MathUtils.clamp((cursor.x - blobScreen.x) / 350, -1, 1),
      THREE.MathUtils.clamp(-(cursor.y - blobScreen.y) / 300, -1, 1),
    );
  } else {
    lookTarget.set(0, 0);
  }
  // Reading: eyes run along a line, snap back for the next one a bit lower,
  // and start again at the top of each new sheet.
  readAlong(readLine, 5);
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, -0.6 + 1.2 * reading.along, P.scan);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, -0.2 - reading.line * 0.13, P.scan);
  // Searching: eyes on the search bar, then reading down the results once
  // they've loaded, one line per result.
  readAlong(webSkim, WEB.results);
  const loaded = webSkim > 0;
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, loaded ? -0.6 + 1.2 * reading.along : -0.3, P.web);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, loaded ? -0.3 - reading.line * 0.15 : -0.15, P.web);
  // Running a command: eyes on the newest output at the bottom of the window.
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, -0.2, P.term);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, -0.55, P.term);
  // Writing: eyes follow his hand down the page as the code fills in.
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, -0.15, P.write);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, 0.1 - writeLine * 0.75, P.write);
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, ponderSide * 0.6, P.ponder);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, 0.6, P.ponder);
  if (gestureLook) lookTarget.set(gestureLook.x, gestureLook.y);
  look.lerp(lookTarget, 1 - Math.exp(-step * 10));

  // Body orientation
  if (spin.t < 1) spin.t = Math.min(1, spin.t + step / spin.secs);
  const spinAngle = spin.t < 1 ? (1 - Math.cos(spin.t * Math.PI)) / 2 * Math.PI * 2 * spin.turns * spin.dir : 0;
  const rock = jiggleNow * 2.2 * Math.sin(jiggle.t * 11);
  // Woozy wobble and eye-rolling turn the same way he spun.
  const woozy = -time * spin.dir;
  // While he's at a sheet or terminal, or thinking, only his eyes move; his body
  // stays still.
  const turnToLook = 1 - 0.85 * Math.max(P.scan, P.write, P.term, P.web, P.ponder);
  body.rotation.set(
    -look.y * 0.08 * turnToLook + doze.pitch + Math.cos(woozy * 4.5) * 0.08 * P.dizzy + rock * 0.4,
    look.x * 0.22 * turnToLook + spinAngle,
    Math.sin(time * 1.3) * 0.08 * P.sway - ponderSide * THINK.tilt * P.ponder + P.lean * ATTN.tilt * (1 - attnLoud)
      + Math.sin(woozy * 4.5) * 0.14 * P.dizzy + rock,
  );

  // Arms: a lazy idle sway, lifted for waving, and melting back into the
  // body as it becomes a star.
  armDirs.forEach((a, i) => {
    const side = i ? 1 : -1;
    const lift = Math.sin(time * 1.5 + side) * 0.06 + reach[i] * 0.5
      + P.wave * (i ? 1 : attnLoud) * (0.45 + (0.22 + 0.08 * attnLoud) * Math.sin(time * (6 + 4 * attnLoud) + side))
      + (i ? P.lean * ATTN.reach * (1 - attnLoud) : 0)
      + doze.arms - P.slump * DOZE.slump * doze.settle;
    armLift[i] = lift;
    // Reaching swings the arm forward too, toward you, so it stays in view.
    // Flicking a finished sheet away swings his right arm up and across.
    const flick = i === 1 ? sheetFlick : 0;
    // Writing, his left arm passes down over the page as the code fills in.
    const pass = i === 0 ? writeSweep.on : 0;
    // Running a command, both arms tap away at the terminal, taking turns.
    const tap = (P.term + P.web * webTyping) * (0.3 * Math.max(0, Math.sin(time * 15 + (i ? Math.PI : 0))) ** 2 - 0.1) * (1 - sheetFlick);
    armLift[i] += flick * 0.7 + pass * writeSweep.lift + tap;
    a.set(
      side * (1 - 0.6 * flick - 0.3 * pass - 0.2 * P.term),
      ARMS.y + lift + flick * 0.7 + pass * writeSweep.lift + tap,
      ARMS.z + reach[i] * 1.6 + flick * 0.8 + pass * 0.6 + 0.5 * P.term,
    ).normalize();
  });
  armLen = ARMS.len * Math.max(0, 1 - P.star) * (1 + 0.15 * P.wave) * (1 - DOZE.shrink * P.slump * doze.settle);
  updateArmAnchors();
  body.updateMatrix();
  updateGesture(step);
  updateSheet(step);
  updateBubble(step);
  updateZs(step);

  // Deform the surface
  const arr = posAttr.array;
  for (let i = 0; i < arr.length; i += 3) {
    surface(dirs[i], dirs[i + 1], dirs[i + 2], tmp);
    arr[i] = tmp.x; arr[i + 1] = tmp.y; arr[i + 2] = tmp.z;
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  // Blink
  blinkAt -= step;
  if (blinkAt <= 0) { blink = 1; blinkAt = 2.5 + Math.random() * 4; }
  blink = Math.max(0, blink - step * 7);
  const closed = doze.closed ?? P.eyesClosed;
  const eyeOpen = Math.max(0.08, (1 - Math.sin(blink * Math.PI)) * (1 - closed * 0.92) * (1 - gestureSquint * 0.65));

  for (const eye of eyes) {
    tmp2.copy(eye.userData.base);
    tmp2.x *= 1 - P.star * 0.2; // a touch closer together on the star's face
    tmp2.x += look.x * 0.16;
    tmp2.y += look.y * 0.1;
    // Dizzy: each eye rolls in its own circle, out of step with the other.
    const roll = woozy * 8 + (eye.userData.base.x > 0 ? Math.PI : 0);
    tmp2.x += Math.cos(roll) * 0.1 * P.dizzy;
    tmp2.y += Math.sin(roll) * 0.07 * P.dizzy;
    tmp2.normalize();
    surface(tmp2.x, tmp2.y, tmp2.z, tmp).multiplyScalar(0.995);
    eye.position.copy(tmp);
    eye.quaternion.setFromUnitVectors(Z, tmp2);
    eye.scale.set((1 + P.glow * 0.12) * (1 - morph * 0.2), eyeOpen * (1 + P.glow * 0.12) * (1 + morph * 1.6), 1);
  }

  for (const d of decals) {
    const { dir, spin } = d.userData;
    surface(dir.x, dir.y, dir.z, tmp).multiplyScalar(1.004);
    d.position.copy(tmp);
    d.quaternion.setFromUnitVectors(Z, dir);
    if (spin) d.rotateZ(spin);
  }

  updateMinions(step, now);
  if (LOCKED === 'delegating' && now - lastMinionDemo > 2600) {
    // Gallery: keep a few helpers coming and going.
    lastMinionDemo = now;
    if (minions.filter((m) => m.phase !== 'out').length < 3) spawnMinion('demo');
    else retireMinion('demo');
  }

  bodyMat.emissiveIntensity = 0.06 + P.glow * (0.14 + 0.1 * Math.sin(time * 6));

  // Screen-space bookkeeping for hit testing and the contact shadow.
  root.updateMatrixWorld(true);
  const c = toScreen(tmp.set(0, 0.1, 0).applyMatrix4(body.matrixWorld));
  const edge = toScreen(tmp.set(1.05, 0.1, 0).applyMatrix4(body.matrixWorld));
  blobScreen.x = c.x;
  blobScreen.y = c.y;
  blobScreen.r = Math.abs(edge.x - c.x);
  const e0 = toScreen(eyes[0].getWorldPosition(tmp));
  const e1 = toScreen(eyes[1].getWorldPosition(tmp));
  eyesScreen.x = (e0.x + e1.x) / 2;
  eyesScreen.y = (e0.y + e1.y) / 2;
  trackCircles(now);

  // Halftone grid: anchored to the body's center, sized from the unrotated
  // root so spins and shape changes don't resize the dots.
  const dpr = renderer.getPixelRatio();
  const o = toScreen(tmp.set(0, 0, 0).applyMatrix4(root.matrixWorld));
  const unit = toScreen(tmp.set(1, 0, 0).applyMatrix4(root.matrixWorld));
  halftone.uCenter.value.set(c.x * dpr, (H - c.y) * dpr);
  halftone.uCell.value = (Math.abs(unit.x - o.x) * dpr) / HALFTONE_DOTS_PER_UNIT;
  pulseEl.style.left = `${c.x}px`;
  pulseEl.style.top = `${c.y}px`;
  pulseEl.classList.toggle('on', P.glow > 0.3);

  const ground = toScreen(tmp.set(0, ROOT_Y + SHAPE.floor * ROOT_SCALE, 0));
  const lift = THREE.MathUtils.clamp(h * 2.2 + hoverY * 2.2 + P.star * 0.45, 0, 0.8);
  shadowEl.style.left = `${ground.x}px`;
  shadowEl.style.top = `${ground.y}px`;
  shadowEl.style.transform = `scale(${(1 - lift * 0.5) * (1 + squash * 0.5)})`;
  shadowEl.style.opacity = String(1 - lift);

  renderer.render(scene, camera);
}

if (LOCKED === 'star') toggleStar();
else if (STATES[LOCKED]) setState(LOCKED);

updateChip();
requestAnimationFrame(frame);
