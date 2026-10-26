import * as THREE from 'three';
import { DEFAULTS, STATES, TINTS } from './states.js';

// The params he's showing right now, eased each frame toward mood.target.
export const P = { ...DEFAULTS };

export const mood = {
  state: 'idle',
  since: performance.now(),
  lastEventAt: performance.now(),
  target: { ...DEFAULTS },
  starMode: false, // toggled by double-click
};

export const tintTarget = new THREE.Color('#ffffff');
export const spring = { x: 0, v: 0 };
export const spin = { t: 1, turns: 1, dir: 1, secs: 0.9 };

const listeners = [];
export function onStateChange(fn) {
  listeners.push(fn);
}

export function startSpin(turns, secs, dir = 1) {
  Object.assign(spin, { t: 0, turns, secs, dir });
}

export function setState(next) {
  mood.since = performance.now();
  if (next === mood.state) return;
  const prev = mood.state;
  mood.state = next;
  mood.target = { ...DEFAULTS, ...STATES[next] };
  if (mood.starMode) mood.target.star = 1;
  tintTarget.set(TINTS[next] || '#ffffff');
  if (next === 'done') startSpin(1, 0.9);
  if (next === 'dizzy') startSpin(2, 1.1, spin.dir);
  spring.v -= prev === 'sleeping' || next === 'attention' ? 3 : 1.2;
  for (const fn of listeners) fn();
}

export function toggleStar() {
  mood.starMode = !mood.starMode;
  mood.target.star = mood.starMode || mood.state === 'done' ? 1 : 0;
}
