const { app, BrowserWindow, ipcMain, screen, Menu, Tray } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.BLOB_PORT) || 7777;
const WIN_W = 300;
const WIN_H = 380;
const ICON = path.join(__dirname, 'assets', 'icon.ico');

let win = null;
let tray = null;
let dragOffset = null;
let dragTimer = null;

if (!app.requestSingleInstanceLock()) app.quit();

// The page always lays out at WIN_W x WIN_H; scale grows the window and zooms the page to match.
const size = () => ({ width: Math.round(WIN_W * settings.scale), height: Math.round(WIN_H * settings.scale) });

function homePosition() {
  const { workArea } = screen.getPrimaryDisplay();
  const { width, height } = size();
  return { x: workArea.x + workArea.width - width - 24, y: workArea.y + workArea.height - height };
}

// Where he was last left, so he reopens there. Saved after each drag, reset and quit.
const positionFile = () => path.join(app.getPath('userData'), 'window-position.json');

// The window's center must land in some display's work area; otherwise (monitor
// unplugged, resolution changed) he'd open off-screen.
function onScreen({ x, y }) {
  const { width, height } = size();
  const cx = x + width / 2;
  const cy = y + height / 2;
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

// Moves always restate the size: setPosition onto a monitor with a different
// scale factor keeps the old physical size, stretching the scene past the CSS layout.
function place(x, y) {
  win.setBounds({ x, y, ...size() });
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
const SCALES = [[0.75, 'Small'], [1, 'Medium'], [1.25, 'Large']];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const settings = { light: 'auto', scale: 1 };
try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* defaults */ }
if (!SCALES.some(([s]) => s === settings.scale)) settings.scale = 1;

function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch { /* not worth crashing over */ }
  if (tray) tray.setContextMenu(menu());
}

function setLight(mode) {
  settings.light = mode;
  saveSettings();
  sendLight();
}

// Resizes around his feet, so he stays standing where he was.
function setScale(scale) {
  const b = win.getBounds();
  settings.scale = scale;
  saveSettings();
  const { width, height } = size();
  place(Math.round(b.x + (b.width - width) / 2), b.y + b.height - height);
  win.webContents.setZoomFactor(scale);
  savePosition();
}

// Where he sits on his monitor, -1..1 from left to right and top to bottom.
function sendLight() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const { workArea: a } = screen.getDisplayNearestPoint(c);
  win.webContents.send('light', {
    mode: settings.light,
    x: Math.max(-1, Math.min(1, ((c.x - a.x) / a.width) * 2 - 1)),
    y: Math.max(-1, Math.min(1, ((c.y - a.y) / a.height) * 2 - 1)),
  });
}

function createWindow() {
  const { x, y } = startPosition();
  win = new BrowserWindow({
    x, y,
    ...size(),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  place(x, y);
  screen.on('display-metrics-changed', () => {
    if (!win || win.isDestroyed()) return;
    const [wx, wy] = win.getPosition();
    place(wx, wy);
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Clicks fall through to whatever is underneath; mouse moves are still forwarded
  // so the renderer can switch this off while the cursor is over the blob.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(settings.scale);
    sendLight();
  });
  win.on('move', () => { if (settings.light === 'auto') sendLight(); });

  // Feed the cursor position to the renderer so the eyes can follow it anywhere on screen.
  let last = '';
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const msg = { x: (p.x - b.x) / settings.scale, y: (p.y - b.y) / settings.scale };
    const key = msg.x + ',' + msg.y;
    if (key !== last) {
      last = key;
      win.webContents.send('cursor', msg);
    }
  }, 50);
}

// The renderer tracks the sessions; this mirrors its list and pick for the menu.
let sessionList = { pinned: null, sessions: [] };

function pin(id) {
  if (win && !win.isDestroyed()) win.webContents.send('pin', id);
}

function sessionMenu() {
  const { pinned, sessions } = sessionList;
  return [
    { label: 'Auto', type: 'radio', checked: !pinned, click: () => pin(null) },
    ...(sessions.length ? [{ type: 'separator' }] : []),
    ...sessions.map(({ id, label }) => ({ label, type: 'radio', checked: pinned === id, click: () => pin(id) })),
  ];
}

function menu() {
  return Menu.buildFromTemplate([
    { label: 'Reset position', click: () => { const p = homePosition(); place(p.x, p.y); savePosition(); } },
    { label: 'Test notification', click: () => send({ event: 'Notification', session: 'test', cwd: 'claude-blob', message: 'Claude needs your permission to use Bash' }) },
    { label: 'Session', submenu: sessionMenu() },
    { label: 'Light', submenu: LIGHTS.map(([mode, label]) => ({ label, type: 'radio', checked: settings.light === mode, click: () => setLight(mode) })) },
    { label: 'Size', submenu: SCALES.map(([scale, label]) => ({ label, type: 'radio', checked: settings.scale === scale, click: () => setScale(scale) })) },
    { label: 'Animation gallery', click: openGallery },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

const recent = [];

let gallery = null;

function openGallery() {
  if (gallery && !gallery.isDestroyed()) return gallery.focus();
  gallery = new BrowserWindow({ width: 1120, height: 900, title: 'Blob animations', autoHideMenuBar: true, icon: ICON });
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
    place(c.x - dragOffset.x, c.y - dragOffset.y);
  }, 10);
});

ipcMain.on('drag-end', () => {
  clearInterval(dragTimer);
  dragTimer = null;
  savePosition();
});

ipcMain.on('sessions', (_e, list) => {
  sessionList = list;
  if (tray) tray.setContextMenu(menu());
});

ipcMain.on('context-menu',() => menu().popup({ window: win }));

app.whenReady().then(() => {
  createWindow();
  startServer();
  // Electron swaps in tray@2x.png on high-DPI screens.
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('Claude Blob');
  tray.setContextMenu(menu());
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', savePosition);
