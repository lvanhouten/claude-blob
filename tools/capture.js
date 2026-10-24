// Records the README animations: renders each state on a fake clock and saves
// the frames as PNGs, which encode.py turns into animated WebPs.
//   npx electron tools/capture.js && python tools/encode.py
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const FPS = 25;
const OUT = path.join(__dirname, '..', 'docs', 'frames');
const CROP = { x: 30, y: 82, width: 240, height: 250 }; // same crop as the gallery cards
const BG = '#00000000';
const SETTLE_MS = 40;

// warm: seconds to run before recording, so the state has eased in.
// secs: one loop of the animation.
const CLIPS = [
  { state: 'idle', warm: 2, secs: 4 },
  { state: 'thinking', warm: 2, secs: 4 },
  { state: 'running', warm: 2, secs: 3 },
  { state: 'building', warm: 2, secs: 3 },
  { state: 'reading', warm: 2, secs: 4 },
  { state: 'searching', warm: 2, secs: 4 },
  { state: 'delegating', warm: 12, secs: 5.2 },
  { state: 'attention', warm: 2, secs: 3 },
  { state: 'done', warm: 0, secs: 6 },
  { state: 'sleeping', warm: 4, secs: 4 },
  { state: 'jiggle', warm: 0.5, secs: 4.4 },
  { state: 'dizzy', warm: 0, secs: 4.7 },
];

app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Clips are recorded a few at a time, one offscreen window each; most of a
// frame is spent waiting on SETTLE_MS, so they overlap well.
const PARALLEL = 4;

function makeWindow() {
  // Offscreen: never shown, so it can't be covered up and stall.
  const win = new BrowserWindow({
    width: 300,
    height: 380,
    show: false,
    transparent: true,
    backgroundColor: BG,
    webPreferences: {
      preload: path.join(__dirname, 'capture-preload.js'),
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  win.webContents.setFrameRate(240);
  return win;
}

async function record(win, clip) {
  const dir = path.join(OUT, clip.state);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await win.loadFile(path.join(__dirname, '..', 'index.html'), { search: `embed&state=${clip.state}` });
  const step = 1000 / FPS;
  await win.webContents.executeJavaScript(`for (let i = 0; i < ${Math.round(clip.warm * FPS)}; i++) __advance(${step})`);
  const frames = Math.round(clip.secs * FPS);
  const writes = [];
  for (let i = 0; i < frames; i++) {
    await win.webContents.executeJavaScript(`__advance(${step})`);
    // A new frame takes a moment to reach the compositor; capturing straight
    // away sometimes gets the previous one. 15ms was enough in testing.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const img = await win.webContents.capturePage(CROP);
    writes.push(fs.promises.writeFile(path.join(dir, String(i).padStart(4, '0') + '.png'), img.toPNG()));
  }
  await Promise.all(writes);
  console.log(`${clip.state}: ${frames} frames`);
}

app.whenReady().then(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
  const todo = CLIPS.filter((c) => !only.length || only.includes(c.state));
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
    const win = makeWindow();
    while (todo.length) await record(win, todo.shift());
  }));
  app.quit();
});
