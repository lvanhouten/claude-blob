import * as THREE from 'three';

// Standard "back" in-out curve: dips slightly before starting, overshoots past
// the end, then settles.
export function easeInOutBack(x) {
  const c = 1.70158 * 1.525;
  return x < 0.5
    ? ((2 * x) ** 2 * ((c + 1) * 2 * x - c)) / 2
    : ((2 * x - 2) ** 2 * ((c + 1) * (2 * x - 2) + c) + 2) / 2;
}

export function easeOutBack(x) {
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

// Back-out curve with a stronger kick than easeOutBack, for the swoop past the ring.
export function easeOutOvershoot(x) {
  const c = 2.6;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

export const smooth = (x) => THREE.MathUtils.smoothstep(x, 0, 1);
