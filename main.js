const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.BLOB_PORT) || 7777;
const WIN_W = 300;
const WIN_H = 380;

let win = null;
let tray = null;
let dragOffset = null;
let dragTimer = null;

if (!app.requestSingleInstanceLock()) app.quit();

function homePosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - WIN_W - 24, y: workArea.y + workArea.height - WIN_H };
}

// Where he was last left, so he reopens there. Saved after each drag, reset and quit.
const positionFile = () => path.join(app.getPath('userData'), 'window-position.json');

// The window's center must land in some display's work area; otherwise (monitor
// unplugged, resolution changed) he'd open off-screen.
function onScreen({ x, y }) {
  const cx = x + WIN_W / 2;
  const cy = y + WIN_H / 2;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height);
}

function startPosition() {
  try {
    const p = JSON.parse(fs.readFileSync(positionFile(), 'utf8'));
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && onScreen(p)) return p;
  } catch { /* no saved position yet */ }
  return homePosition();
}

function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(positionFile(), JSON.stringify({ x, y })); } catch { /* not worth crashing over */ }
}

// Which way the light comes from: a fixed preset, or 'auto' to light him from
// the middle of whichever monitor he's on.
const LIGHTS = [['auto', 'Auto (from screen center)'], ['upper-left', 'Upper left'], ['upper-right', 'Upper right'],
  ['top', 'Top'], ['front', 'Front'], ['side', 'Side']];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let light = 'auto';
try { light = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).light ?? light; } catch { /* defaults */ }

function setLight(mode) {
  light = mode;
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ light })); } catch { /* not worth crashing over */ }
  sendLight();
  if (tray) tray.setContextMenu(menu());
}

// Where he sits on his monitor, -1..1 from left to right and top to bottom.
function sendLight() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const { workArea: a } = screen.getDisplayNearestPoint(c);
  win.webContents.send('light', {
    mode: light,
    x: Math.max(-1, Math.min(1, ((c.x - a.x) / a.width) * 2 - 1)),
    y: Math.max(-1, Math.min(1, ((c.y - a.y) / a.height) * 2 - 1)),
  });
}

function createWindow() {
  const { x, y } = startPosition();
  win = new BrowserWindow({
    x, y,
    width: WIN_W,
    height: WIN_H,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Clicks fall through to whatever is underneath; mouse moves are still forwarded
  // so the renderer can switch this off while the cursor is over the blob.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', sendLight);
  win.on('move', () => { if (light === 'auto') sendLight(); });

  // Feed the cursor position to the renderer so the eyes can follow it anywhere on screen.
  let last = '';
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const msg = { x: p.x - b.x, y: p.y - b.y };
    const key = msg.x + ',' + msg.y;
    if (key !== last) {
      last = key;
      win.webContents.send('cursor', msg);
    }
  }, 50);
}

function trayIcon() {
  // 16x16 orange dot, drawn by hand so the app ships without image assets.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 8.5);
      const a = Math.max(0, Math.min(1, 7 - d));
      const i = (y * size + x) * 4;
      buf[i] = 76 * a;      // B
      buf[i + 1] = 140 * a; // G
      buf[i + 2] = 255 * a; // R
      buf[i + 3] = 255 * a; // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function menu() {
  return Menu.buildFromTemplate([
    { label: 'Reset position', click: () => { const p = homePosition(); win.setPosition(p.x, p.y); savePosition(); } },
    { label: 'Test notification', click: () => send({ event: 'Notification', session: 'test', cwd: 'claude-blob', message: 'Claude needs your permission to use Bash' }) },
    { label: 'Light', submenu: LIGHTS.map(([mode, label]) => ({ label, type: 'radio', checked: light === mode, click: () => setLight(mode) })) },
    { label: 'Animation gallery', click: openGallery },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

const recent = [];

let gallery = null;

function openGallery() {
  if (gallery && !gallery.isDestroyed()) return gallery.focus();
  gallery = new BrowserWindow({ width: 1120, height: 900, title: 'Blob animations', autoHideMenuBar: true });
  gallery.loadFile('gallery.html');
}

function send(evt) {
  recent.push({ at: new Date().toISOString(), ...evt });
  if (recent.length > 20) recent.shift();
  if (win && !win.isDestroyed()) win.webContents.send('claude-event', evt);
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        res.writeHead(204).end();
        try { send(JSON.parse(body)); } catch { /* ignore malformed events */ }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    } else if (req.method === 'GET' && req.url === '/recent') {
      // Last few events received, for checking that hooks are wired up.
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(recent, null, 2));
    } else {
      res.writeHead(404).end();
    }
  });
  server.on('error', (err) => {
    console.error(`claude-blob: could not listen on 127.0.0.1:${PORT}: ${err.message}`);
    app.quit();
  });
  server.listen(PORT, '127.0.0.1');
}

ipcMain.on('set-ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('drag-start', () => {
  const p = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffset = { x: p.x - wx, y: p.y - wy };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    win.setPosition(c.x - dragOffset.x, c.y - dragOffset.y);
  }, 10);
});

ipcMain.on('drag-end', () => {
  clearInterval(dragTimer);
  dragTimer = null;
  savePosition();
});

ipcMain.on('context-menu', () => menu().popup({ window: win }));

app.whenReady().then(() => {
  createWindow();
  startServer();
  tray = new Tray(trayIcon());
  tray.setToolTip('Claude Blob');
  tray.setContextMenu(menu());
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', savePosition);
