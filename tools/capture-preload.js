// Runs the page on a fake clock so every frame can be captured at an exact
// time step, however long the capture itself takes.
let clock = 0;
let queue = [];
const realRaf = window.requestAnimationFrame.bind(window);

performance.now = () => clock;
window.requestAnimationFrame = (cb) => queue.push(cb);

// Move the clock forward one frame and run that frame.
window.__advance = (ms) => {
  clock += ms;
  const q = queue;
  queue = [];
  for (const cb of q) cb(clock);
};

// Resolves once the frame has reached the screen.
window.__painted = () => new Promise((r) => realRaf(() => realRaf(r)));
