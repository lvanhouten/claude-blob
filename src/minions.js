import * as THREE from 'three';
import { root, body, blobScreen } from './scene.js';
import { surface, armRest, armDirs, arms, geo, poke } from './surface.js';
import { bodyMat, eyeMat, sparkleMat } from './materials.js';
import { eyes } from './face.js';
import { easeOutBack, easeOutOvershoot, smooth } from './easing.js';

// Helpers: each running subagent is a mini-me that circles him until it
// finishes. He makes them on purpose: crouches with effort, reaches out an arm,
// a bulb swells at its tip and pinches off. When one finishes he reaches out,
// catches it and pulls it back in. Helpers share his deforming mesh and
// material, so they wobble, jiggle and transform along with him.
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
export const minions = [];
let orbitAngle = 0;

// One gesture plays at a time; extra spawns and catches wait their turn.
const gestures = [];
let gesture = null;
let budSide = 1;
// What the current gesture does to him. squash: crouch (+) or stretch (-)
// added to his squash; squint: 0..1, eyes scrunched with effort or
// contentment; look: where he's looking, or null.
export const gestureFx = { squash: 0, squint: 0, look: null };
const tip = new THREE.Vector3();
const tmp = new THREE.Vector3();

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

export function spawnMinion(session) {
  gestures.push({ kind: 'bud', session });
}

// The Agent call that buds a helper doesn't know the subagent's id yet, so the
// first event carrying a new id claims the session's oldest unclaimed helper.
export function bindMinion(session, agent) {
  const helpers = [...minions, ...gestures.filter((g) => g.kind === 'bud' && !g.minion)];
  if (helpers.some((x) => x.agent === agent)) return;
  const free = helpers.find((x) => x.session === session && !x.agent && !x.leaving);
  if (free) free.agent = agent;
}

// Retires the helper bound to `agent`, else the session's oldest unclaimed one.
export function retireMinion(session, agent) {
  const waiting = (x) => !x.leaving && (x.phase === 'in' || x.phase === 'orbit');
  const m = (agent && minions.find((x) => waiting(x) && x.agent === agent))
    ?? minions.find((x) => waiting(x) && x.session === session && !x.agent)
    ?? minions.find((x) => waiting(x) && (!session || x.session === session))
    ?? minions.find(waiting);
  if (!m) return;
  m.leaving = true;
  gestures.push({ kind: 'catch', minion: m });
}

// A point at angle a on the ring scaled by r (1 = on the ring), at height y.
function polarToRing(a, r, y, out) {
  return out.set(Math.cos(a) * MINION.rx * r, y, Math.sin(a) * MINION.rz * r);
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

export function updateGesture(step) {
  gestureFx.squash = 0;
  gestureFx.squint = 0;
  gestureFx.look = null;
  if (!gesture && gestures.length) startGesture(gestures.shift());
  const g = gesture;
  if (!g) return;
  g.t += step;
  const t = g.t;
  armTip(g.arm, tip);

  if (g.kind === 'bud') {
    if (t < BUD.crouch) {
      // Gather himself: crouch, scrunch, eye the spot.
      const u = smooth(t / BUD.crouch);
      gestureFx.squash = 0.12 * u;
      gestureFx.squint = u;
      gestureFx.look = { x: g.side * 0.8, y: 0.05 };
    } else if (t < BUD.pinch) {
      // Reach out; a bulb swells at the end of the arm.
      const u = smooth((t - BUD.crouch) / (BUD.pinch - BUD.crouch));
      arms.reachTarget[g.arm] = 1;
      gestureFx.squash = 0.12 * (1 - u);
      gestureFx.squint = 1 - 0.6 * u;
      gestureFx.look = { x: g.side * 0.9, y: 0.1 };
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
        arms.reachTarget[g.arm] = 0;
        g.minion.phase = 'in';
        g.minion.t = 0;
        g.minion.from = g.minion.group.position.clone();
        g.minion.angle = Math.atan2(g.minion.from.z / MINION.rz, g.minion.from.x / MINION.rx);
        poke(blobScreen.x + g.side * blobScreen.r * 0.7, blobScreen.y);
      }
      // Watch it float off.
      const u = (t - BUD.pinch) / (BUD.end - BUD.pinch);
      gestureFx.squash = -0.06 * Math.max(0, 1 - u * 3);
      gestureFx.look = { x: g.side * 0.6, y: 0.45 };
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
      gestureFx.squash = 0.04 * u;
      gestureFx.look = { x: g.side * 0.8, y: 0.3 };
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
      gestureFx.look = {
        x: THREE.MathUtils.clamp(m.group.position.x / 1.4, -1, 1) * 0.8,
        y: THREE.MathUtils.lerp(0.4, 1, smooth(u)),
      };
      gestureFx.squash = 0.04 + 0.04 * u; // bracing
    } else {
      if (minions.includes(m)) {
        // Impact on top of his head: a jello wobble out from where it landed.
        root.remove(m.group);
        minions.splice(minions.indexOf(m), 1);
        poke(blobScreen.x, blobScreen.y - blobScreen.r * 0.95);
      }
      // Content little squint.
      gestureFx.squint = 0.7 * Math.sin(Math.min(1, (t - CATCH.hit) / (CATCH.end - CATCH.hit)) * Math.PI);
      gestureFx.look = null;
      if (t >= CATCH.end) gesture = null;
    }
  }
}

export function updateMinions(step, now, time) {
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
  for (let i = 0; i < 2; i++) arms.reach[i] += (arms.reachTarget[i] - arms.reach[i]) * (1 - Math.exp(-step * 10));
}

export function retireSessionMinions(session) {
  for (const m of minions) if (m.session === session) retireMinion(session);
}
