// Renders one idle frame at 2x for icon.py to trace the app icon from.
//   npx electron tools/icon.js && python tools/icon.py
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'frames', 'icon.png');
// Far enough in for the idle sway to settle, and between blinks.
const WARM_S = 2.5;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    // The page laid out at its usual 300x380, zoomed 2x: the renderer caps its
    // pixel ratio at 2, so more zoom only upscales.
    width: 300 * 2,
    height: 380 * 2,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'capture-preload.js'),
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'index.html'), { search: 'embed&state=idle' });
  win.webContents.setZoomFactor(2);
  await win.webContents.executeJavaScript(`for (let i = 0; i < ${WARM_S * 25}; i++) __advance(40)`);
  // Draw one more frame just before capturing, as capture.js does: a frame
  // drawn earlier may no longer be on the canvas.
  await win.webContents.executeJavaScript('__advance(40)');
  await new Promise((r) => setTimeout(r, 40));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log(`icon frame: ${img.getSize().width}x${img.getSize().height}`);
  app.quit();
});
