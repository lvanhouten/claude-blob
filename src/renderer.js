import * as THREE from 'three';
import { api, params, LOCKED } from './env.js';
import { STATES, LABELS, WORKING, SLEEP_AFTER_MS, DONE_HOLD_MS, DIZZY_MS, STALE_MS } from './states.js';
import { P, mood, setState, onStateChange, tintTarget, spring, spin } from './mood.js';
import { renderer, scene, camera, root, body, ROOT_Y, ROOT_SCALE, updateLights, view, toScreen, blobScreen, eyesScreen } from './scene.js';
import { SHAPE, skin, jiggle, JIGGLE, poke, ARMS, armDirs, arms, updateArmAnchors, deform } from './surface.js';
import { bodyMat, halftone, HALFTONE_DOTS_PER_UNIT, HALFTONE_WAVE } from './materials.js';
import { eyes, updateFace } from './face.js';
import './color.js';
import { easeInOutBack } from './easing.js';
import { hands, updateSheet, lookAtSheet } from './props.js';
import { updateBubble, updateZs } from './floaters.js';
import { minions, spawnMinion, bindMinion, retireMinion, retireSessionMinions, gestureFx, updateGesture, updateMinions } from './minions.js';
import { showBubble, hideBubble, bubbleAsks, bubbleOwner, updateChip, placeOverlay } from './ui.js';
import { createSessions } from './sessions.js';
import { pointer, initInput, circling, trackCircles } from './input.js';

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

const STAR_TWEEN_S = 1.1; // length of a blob <-> star transformation
const starTween = { from: 0, to: 0, t: 1 };

// Fills in `doze` for this frame: how much the yawn squashes, tips and lifts
// his arms, and how closed his eyes are (null when sleep takes over).
function updateDoze(now) {
  doze.squash = doze.pitch = doze.arms = 0;
  doze.closed = null;
  doze.done = true;
  doze.settle = 1;
  if (mood.state !== 'sleeping') return;
  let t = (now - mood.since) / 1000;
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
// Wiring
// ---------------------------------------------------------------------------
const tracker = createSessions({
  blob: {
    state: () => mood.state,
    set: setState,
    touch: () => { mood.lastEventAt = performance.now(); },
    kick: (v) => { spring.v -= v; },
  },
  bubble: { show: showBubble, hide: hideBubble, asks: bubbleAsks, owner: bubbleOwner },
  helpers: { spawn: spawnMinion, bind: bindMinion, retire: retireMinion, retireAll: retireSessionMinions },
  publish: (list) => api.setSessions(list),
  changed: refreshChip,
  locked: Boolean(LOCKED),
});

function refreshChip() {
  updateChip(LABELS[mood.state], tracker.currentProject());
}

onStateChange(refreshChip);
api.onEvent(tracker.onEvent);
api.onPin(tracker.pin);
initInput({ dismissAsk: tracker.dismissAsk });

// Handy for poking him from devtools.
Object.assign(window, {
  __emit: tracker.onEvent,
  __sessions: tracker.sessions,
  __pin: tracker.pin,
  __minions: minions,
  __poke: poke,
  __circling: circling,
  __eyesScreen: eyesScreen,
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
const tmp = new THREE.Vector3();
const look = new THREE.Vector2();
const lookTarget = new THREE.Vector2();
let time = 0;
let hopPhase = 0;
let blinkAt = 2;
let blink = 0;
let last = performance.now();
let sinceRender = 0;
let lastMinionDemo = -1e9;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Sleep is cheap: drop to ~20fps.
  sinceRender += dt;
  if (mood.state === 'sleeping' && sinceRender < 0.05) return;
  const step = sinceRender;
  sinceRender = 0;
  time += step;

  if (!LOCKED && mood.state === 'idle' && now - mood.lastEventAt > SLEEP_AFTER_MS) setState('sleeping');
  if (mood.state === 'done' && now - mood.since > DONE_HOLD_MS) tracker.settle({ release: true });
  if (mood.state === 'dizzy' && now - mood.since > DIZZY_MS) tracker.settle({ release: true });
  // Re-derive now and then so a session that died mid-task stops holding the blob.
  if (WORKING.has(mood.state) && now - mood.since > STALE_MS) tracker.settle();
  // A locked state that times out (like done) replays after a short rest.
  if (STATES[LOCKED] && mood.state !== LOCKED && now - mood.since > 1500) setState(LOCKED);

  updateDoze(now);
  const { target } = mood;
  if (mood.state === 'attention') {
    let t = (now - mood.since) / 1000;
    if (LOCKED === 'attention') t = ATTN_STAGE ?? t % ATTN.loop;
    attnLoud = THREE.MathUtils.smoothstep(t, ATTN.calm, ATTN.calm + ATTN.ramp);
    target.hop = ATTN.hop * attnLoud;
    target.glow = THREE.MathUtils.smoothstep(t, ATTN.glowAt, ATTN.glowAt + 1);
  } else {
    attnLoud = 0;
  }

  // Ease params toward the current state.
  const k = 1 - Math.exp(-step * 4);
  updateLights(k);
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
  skin.morph = Math.max(-0.4, 4 * P.star * (1 - P.star));
  bodyMat.color.lerp(tintTarget, k);
  skin.phase += step * P.speed;
  skin.hemPhase += step * (0.8 + P.paddle * 5);
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
  jiggle.now = jiggle.amp * Math.exp(-JIGGLE.decay * jiggle.t);
  if (LOCKED === 'jiggle' && jiggle.t > 2.2) {
    poke(blobScreen.x + (Math.random() - 0.5) * blobScreen.r, blobScreen.y + (Math.random() - 0.5) * blobScreen.r);
  }

  // Thinking: he glances up to one side, then the other, with a little "hmm"
  // squish each time he switches.
  const beat = time % (THINK.glance * 2);
  ponderSide += ((beat < THINK.glance ? -1 : 1) - ponderSide) * (1 - Math.exp(-step * 12));
  const hmm = Math.max(0, 1 - (beat % THINK.glance) / 0.3);

  skin.squash = landing * P.hop * 0.7 - h * 0.3
    + P.ponder * THINK.squish * Math.sin(hmm * Math.PI)
    + Math.sin(time * 1.7) * 0.018 * P.breath
    + P.write * 0.025 * Math.max(0, Math.sin(time * 9)) ** 2
    - P.lean * ATTN.stretch * (1 - attnLoud)
    + doze.squash
    + jiggle.now * 1.4 * Math.sin(jiggle.t * 13)
    + gestureFx.squash
    - spring.x * 0.05;

  const hoverY = P.hover * (0.14 + Math.sin(time * 1.4) * 0.07);
  body.position.set((Math.random() - 0.5) * P.jitter, h + hoverY + P.star * (0.12 + Math.sin(time * 2) * 0.05), 0);

  // Eye target: follow the cursor, unless the current activity overrides it.
  const { cursor } = pointer;
  if (cursor) {
    lookTarget.set(
      THREE.MathUtils.clamp((cursor.x - blobScreen.x) / 350, -1, 1),
      THREE.MathUtils.clamp(-(cursor.y - blobScreen.y) / 300, -1, 1),
    );
  } else {
    lookTarget.set(0, 0);
  }
  lookAtSheet(lookTarget);
  lookTarget.x = THREE.MathUtils.lerp(lookTarget.x, ponderSide * 0.6, P.ponder);
  lookTarget.y = THREE.MathUtils.lerp(lookTarget.y, 0.6, P.ponder);
  if (gestureFx.look) lookTarget.set(gestureFx.look.x, gestureFx.look.y);
  look.lerp(lookTarget, 1 - Math.exp(-step * 10));

  // Body orientation
  if (spin.t < 1) spin.t = Math.min(1, spin.t + step / spin.secs);
  const spinAngle = spin.t < 1 ? (1 - Math.cos(spin.t * Math.PI)) / 2 * Math.PI * 2 * spin.turns * spin.dir : 0;
  const rock = jiggle.now * 2.2 * Math.sin(jiggle.t * 11);
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
    const lift = Math.sin(time * 1.5 + side) * 0.06 + arms.reach[i] * 0.5
      + P.wave * (i ? 1 : attnLoud) * (0.45 + (0.22 + 0.08 * attnLoud) * Math.sin(time * (6 + 4 * attnLoud) + side))
      + (i ? P.lean * ATTN.reach * (1 - attnLoud) : 0)
      + doze.arms - P.slump * DOZE.slump * doze.settle;
    arms.lift[i] = lift;
    // Reaching swings the arm forward too, toward you, so it stays in view.
    // Flicking a finished sheet away swings his right arm up and across.
    const flick = i === 1 ? hands.flick : 0;
    // Writing, his left arm passes down over the page as the code fills in.
    const pass = i === 0 ? hands.sweep.on : 0;
    // Running a command, both arms tap away at the terminal, taking turns.
    const tap = (P.term + P.web * hands.typing) * (0.3 * Math.max(0, Math.sin(time * 15 + (i ? Math.PI : 0))) ** 2 - 0.1) * (1 - hands.flick);
    arms.lift[i] += flick * 0.7 + pass * hands.sweep.lift + tap;
    a.set(
      side * (1 - 0.6 * flick - 0.3 * pass - 0.2 * P.term),
      ARMS.y + lift + flick * 0.7 + pass * hands.sweep.lift + tap,
      ARMS.z + arms.reach[i] * 1.6 + flick * 0.8 + pass * 0.6 + 0.5 * P.term,
    ).normalize();
  });
  arms.len = ARMS.len * Math.max(0, 1 - P.star) * (1 + 0.15 * P.wave) * (1 - DOZE.shrink * P.slump * doze.settle);
  updateArmAnchors();
  body.updateMatrix();
  updateGesture(step);
  updateSheet(step, time);
  updateBubble(step, time);
  updateZs(step, mood.state === 'sleeping' && doze.done && P.star < 0.5);

  deform();

  // Blink
  blinkAt -= step;
  if (blinkAt <= 0) { blink = 1; blinkAt = 2.5 + Math.random() * 4; }
  blink = Math.max(0, blink - step * 7);
  const closed = doze.closed ?? P.eyesClosed;
  const eyeOpen = Math.max(0.08, (1 - Math.sin(blink * Math.PI)) * (1 - closed * 0.92) * (1 - gestureFx.squint * 0.65));
  updateFace(look, woozy, eyeOpen);

  updateMinions(step, now, time);
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
  halftone.uCenter.value.set(c.x * dpr, (view.H - c.y) * dpr);
  halftone.uCell.value = (Math.abs(unit.x - o.x) * dpr) / HALFTONE_DOTS_PER_UNIT;

  const ground = toScreen(tmp.set(0, ROOT_Y + SHAPE.floor * ROOT_SCALE, 0));
  const lift = THREE.MathUtils.clamp(h * 2.2 + hoverY * 2.2 + P.star * 0.45, 0, 0.8);
  placeOverlay(c, ground, lift, skin.squash, P.glow);

  renderer.render(scene, camera);
}

if (STATES[LOCKED]) setState(LOCKED);

refreshChip();
requestAnimationFrame(frame);
