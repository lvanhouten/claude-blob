// Runs the page on a fake clock so every frame can be captured at an exact
// time step, however long the capture itself takes.
let clock = 0;
let queue = [];

performance.now = () => clock;
window.requestAnimationFrame = (cb) => queue.push(cb);

// Seeded, so every capture of a clip comes out the same (blinks, pokes).
let seed = 1;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Move the clock forward one frame and run that frame. CSS animations and
// transitions (the attention ripples, fades) are held on the same clock,
// counted from when each one starts.
window.__advance = (ms) => {
  clock += ms;
  const q = queue;
  queue = [];
  for (const cb of q) cb(clock);
  for (const a of document.getAnimations()) {
    if (a.__t0 === undefined) {
      a.__t0 = clock;
      a.pause();
    }
    a.currentTime = clock - a.__t0;
  }
};
