import * as THREE from 'three';
import { params } from './env.js';
import { P } from './mood.js';
import { root, body } from './scene.js';
import { easeOutBack } from './easing.js';

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

export function updateBubble(step, time) {
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

// on: asleep, past the yawn, and not a star.
export function updateZs(step, on) {
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
