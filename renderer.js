import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Falls back to no-ops so the page can be previewed in a plain browser.
const api = window.blob ?? {
  onEvent() {}, onCursor() {}, setIgnore() {}, dragStart() {}, dragEnd() {}, contextMenu() {},
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
  hammer: 0, sway: 0, wave: 0,          // body/arm motions
  scan: 0, lookAround: 0, ponder: 0,    // eye behaviours
  glow: 0, breath: 1, eyesClosed: 0,
  star: 0,                              // 0 = blob, 1 = star
  paddle: 0,                            // feet shuffling
  hover: 1,                             // floating off the desk
};

const STATES = {
  idle: {},
  thinking: { speed: 1.0, amp: 0.08, freq: 1.5, ponder: 1, breath: 0.6 },
  running: { speed: 2.4, amp: 0.08, freq: 2.4, hop: 0.1, hopHz: 2.8, jitter: 0.015, paddle: 1 },
  building: { speed: 1.2, amp: 0.08, freq: 1.8, hammer: 1, paddle: 0.5 },
  reading: { speed: 0.6, amp: 0.05, scan: 1, sway: 0.6 },
  searching: { speed: 0.9, amp: 0.06, lookAround: 1 },
  delegating: { speed: 1.6, amp: 0.12, freq: 2.0, hop: 0.06, hopHz: 1.3, paddle: 0.7 },
  attention: { speed: 1.4, amp: 0.08, hop: 0.32, hopHz: 1.7, wave: 1, glow: 1, paddle: 1 },
  done: { speed: 0.7, amp: 0.03, star: 1 },
  sleeping: { speed: 0.15, amp: 0.025, breath: 2.2, eyesClosed: 1, hover: 0 },
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

const keyLight = new THREE.DirectionalLight(0xfff1e0, 1.6);
keyLight.position.set(-3, 4, 4);
const rimLight = new THREE.DirectionalLight(0xffb27a, 0.8);
rimLight.position.set(3, 1, -3);
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
// unrolled into straight walls ending in a scalloped hem of stubby feet, and the
// last bit tucks under as a hidden underside.
const GHOST = { n: 5, box: 2.2, taper: 0.16, wall: 0.62, flare: 0.04, bulge: 0.1, scallop: 0.26, cap: 0.14 };
let hemPhase = 0; // rolls the feet around the hem

// radius: size of the skin patch each arm grows from
// cap: fraction of the patch that blends; the rest moves out together as the tip
const ARMS = { len: 0.2, radius: 0.3, cap: 0.5, tip: 0.6, droop: 0.04, bend: 0.22, y: -0.3, z: 0.2 };
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
  const r = 1 + noise.noise4d(dx * P.freq, dy * P.freq, dz * P.freq, phase) * P.amp * (0.12 + 0.88 * skirt);

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
    const lobe = 0.5 + 0.5 * Math.cos(GHOST.n * ang + Math.PI - hemPhase);
    const hem = -SHAPE.floor - GHOST.scallop * (1 - lobe) ** 2.5; // feet reach the floor
    const ux = hl > 1e-6 ? dx / hl : 0;
    const uz = hl > 1e-6 ? dz / hl : 0;
    let rad;
    if (w < GHOST.wall) {
      const f = w / GHOST.wall;
      rad = (1 + GHOST.flare * f * f + GHOST.bulge * lobe * f ** 4) * r; // bulbous feet
      y = -f * hem;
    } else {
      const c = (w - GHOST.wall) / (1 - GHOST.wall);
      rad = (1 + GHOST.flare + GHOST.bulge * lobe) * r * (1 - c);
      y = -hem + Math.sqrt(c) * GHOST.cap;
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
      const d = Math.hypot(x - s.x, y - s.y, z - s.z);
      if (d >= ARMS.radius) continue;
      // The middle of the patch moves out as a whole, so the arm has a body
      // rather than pinching to a point...
      const u = 1 - d / ARMS.radius;
      const t = Math.min(1, u / ARMS.cap);
      const b = t * t * (3 - 2 * t);
      // ...and a quarter-circle dome rounds off the tip.
      const v = Math.max(0, (u - ARMS.cap) / (1 - ARMS.cap));
      const dome = Math.sqrt(1 - (1 - v) * (1 - v));
      const L = armLen * (b + ARMS.tip * dome);
      // Reaching along the lifted direction tilts the arm; the extra rise grows
      // toward the tip, bending it like a wave from the shoulder.
      const a = armDirs[i];
      const bend = armLift[i] * ARMS.bend * b * b * (armLen / ARMS.len);
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

let geo = new THREE.IcosahedronGeometry(1, EMBED ? 26 : 36);
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
  uLightDir: { value: new THREE.Vector3(-1, 0.8, 0.35).normalize().transformDirection(camera.matrixWorldInverse) },
  uLitColor: { value: new THREE.Color('#ffdc9c') },
  uShadeColor: { value: new THREE.Color('#ff8642') },
  uBand: { value: 0.3 },
};

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
// silhouette. The grid lives in screen space, centred on the blob and sized to
// it, so it follows the blob around but never stretches with its shape.
const HALFTONE_DOTS_PER_UNIT = 15;
const halftone = {
  uHalftone: { value: 1 },
  uCenter: { value: new THREE.Vector2() }, // blob centre, in drawing-buffer pixels
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
      uniform float uTime;`)
    .replace('#include <opaque_fragment>', `
      {
        vec2 p = (gl_FragCoord.xy - uCenter) / uCell;
        float d = length(fract(p) - 0.5);
        vec3 n = normalize(normal);
        float shade = 0.5 - 0.5 * dot(n, uLightDir);
        float rim = 1.0 - abs(dot(n, normalize(vViewPosition)));
        float amt = clamp(0.12 + shade * 0.85 + rim * 0.4, 0.0, 1.0) * uHalftone;
        // A wave washes diagonally over the grid; each dot swells as it passes.
        float wave = 0.5 + 0.5 * sin(dot(floor(p) + 0.5, vec2(0.38, -0.26)) - uTime);
        amt = clamp(amt * (0.3 + 1.1 * wave * wave), 0.0, 1.0);
        float r = 0.44 * sqrt(amt);
        float aa = fwidth(d);
        float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
        outgoingLight = mix(outgoingLight, vec3(0.95, 0.8, 0.6), dotMask * 0.8);
      }
      #include <opaque_fragment>`);
};
const blobMesh = new THREE.Mesh(geo, bodyMat);
body.add(blobMesh);


// Eyes: glossy black ovals with two white catch-lights
const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#0d0705', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
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
let focused = null;   // session the user most recently prompted
let project = '';
const tintTarget = new THREE.Color('#ffffff');
const spring = { x: 0, v: 0 };
let spinT = 1;

function projectOf(cwd) {
  return cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '';
}

function updateChip() {
  const label = LABELS[state];
  chipEl.textContent = label ? (project ? `${label} · ${project}` : label) : '';
  chipEl.classList.toggle('hidden', !label);
}

function setState(next) {
  stateSince = performance.now();
  if (next === state) return;
  const prev = state;
  state = next;
  target = { ...DEFAULTS, ...STATES[next] };
  if (starMode) target.star = 1;
  tintTarget.set(TINTS[next] || '#ffffff');
  if (next === 'done') spinT = 0;
  spring.v -= prev === 'sleeping' || next === 'attention' ? 3 : 1.2;
  updateChip();
}

function onEvent(e) {
  if (!e || !e.event) return;
  lastEventAt = performance.now();
  const proj = projectOf(e.cwd);
  const isFocused = !focused || e.session === focused;

  // Any activity in a session means a pending "needs you" for it was handled.
  if (bubbleSession && e.session === bubbleSession && e.event !== 'Notification') hideBubble();

  switch (e.event) {
    case 'SessionStart':
      if (!focused) { focused = e.session; project = proj; }
      if (state === 'sleeping') setState('idle');
      break;
    case 'UserPromptSubmit':
      focused = e.session;
      project = proj;
      setState('thinking');
      break;
    case 'PreToolUse':
      if (!isFocused) break;
      focused = e.session;
      project = proj;
      setState(TOOL_STATES[e.tool] || 'thinking');
      break;
    case 'PostToolUse':
      if (!isFocused) break;
      setState('thinking');
      break;
    case 'Notification': {
      const msg = e.message || 'Claude needs your attention';
      const idle = e.type === 'idle_prompt' || /waiting for your input/i.test(msg);
      if (idle) {
        showBubble(msg, proj, { timeout: 8000, session: e.session });
        spring.v -= 2;
      } else {
        project = proj;
        setState('attention');
        showBubble(msg, proj, { attention: true, session: e.session });
      }
      break;
    }
    case 'Stop':
      if (isFocused) {
        setState('done');
        showBubble('All done ✓', proj, { timeout: 5000 });
      } else {
        showBubble('Finished', proj, { timeout: 5000 });
      }
      break;
    case 'SessionEnd':
      if (e.session === focused) { focused = null; setState('idle'); }
      break;
  }
  updateChip();
}

api.onEvent(onEvent);
window.__emit = onEvent; // handy for poking it from devtools

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
    if (overBubble(e.clientX, e.clientY) || !bubbleEl.classList.contains('hidden')) hideBubble();
    spring.v -= 4;
    if (state === 'sleeping') setState('idle');
    const now = performance.now();
    if (now - lastClickAt < 350) toggleStar();
    lastClickAt = now;
    lastEventAt = now;
  }
  press = null;
});

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
  if (state === 'done' && now - stateSince > DONE_HOLD_MS) setState('idle');
  // A locked state that times out (like done) replays after a short rest.
  if (STATES[LOCKED] && state !== LOCKED && now - stateSince > 1500) setState(LOCKED);

  // Ease params toward the current state.
  const k = 1 - Math.exp(-step * 4);
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
  halftone.uTime.value += step * (1.6 + P.paddle * 2.5);

  // Hop
  hopPhase += step * P.hopHz;
  const s = hopPhase % 1;
  const h = P.hop * 4 * s * (1 - s);
  const landing = P.hop > 0.01 ? Math.max(0, 1 - Math.min(s, 1 - s) * 10) : 0;

  // Boop spring
  spring.v += (-180 * spring.x - 9 * spring.v) * step;
  spring.x += spring.v * step;

  squash = landing * P.hop * 0.7 - h * 0.3
    + Math.sin(time * 1.7) * 0.018 * P.breath
    + P.hammer * 0.07 * Math.max(0, Math.sin(time * 9)) ** 2
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
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, Math.sin(time * 2.2) * 0.7, P.scan);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, -0.35, P.scan);
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, Math.sin(time * 0.9) > 0 ? 0.9 : -0.9, P.lookAround);
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, 0.45, P.ponder);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, 0.6, P.ponder);
  look.lerp(lookTarget, 1 - Math.exp(-step * 10));

  // Body orientation
  if (spinT < 1) spinT = Math.min(1, spinT + step / 0.9);
  const spinEase = spinT < 1 ? (1 - Math.cos(spinT * Math.PI)) / 2 : 1;
  body.rotation.set(
    -look.y * 0.08,
    look.x * 0.22 + (spinT < 1 ? spinEase * Math.PI * 2 : 0) + Math.sin(time * 0.9) * 0.35 * P.lookAround,
    Math.sin(time * 1.3) * 0.08 * (P.ponder + P.sway),
  );

  // Arms: a lazy idle sway, lifted for waving, pumping while hammering, and
  // melting back into the body as it becomes a star.
  armDirs.forEach((a, i) => {
    const side = i ? 1 : -1;
    const lift = Math.sin(time * 1.5 + side) * 0.06
      + P.wave * (0.45 + 0.3 * Math.sin(time * 10 + side))
      + P.hammer * 0.35 * Math.max(0, Math.sin(time * 9));
    armLift[i] = lift;
    a.set(side, ARMS.y + lift, ARMS.z).normalize();
  });
  armLen = ARMS.len * Math.max(0, 1 - P.star) * (1 + 0.3 * P.wave);
  updateArmAnchors();

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
  const eyeOpen = Math.max(0.08, (1 - Math.sin(blink * Math.PI)) * (1 - P.eyesClosed * 0.92));

  for (const eye of eyes) {
    tmp2.copy(eye.userData.base);
    tmp2.x *= 1 - P.star * 0.2; // a touch closer together on the star's face
    tmp2.x += look.x * 0.16;
    tmp2.y += look.y * 0.1;
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

  bodyMat.emissiveIntensity = 0.06 + P.glow * (0.14 + 0.1 * Math.sin(time * 6));

  // Screen-space bookkeeping for hit testing and the contact shadow.
  root.updateMatrixWorld(true);
  const c = toScreen(tmp.set(0, 0.1, 0).applyMatrix4(body.matrixWorld));
  const edge = toScreen(tmp.set(1.05, 0.1, 0).applyMatrix4(body.matrixWorld));
  blobScreen.x = c.x;
  blobScreen.y = c.y;
  blobScreen.r = Math.abs(edge.x - c.x);

  // Halftone grid: anchored to the body's centre, sized from the unrotated
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
