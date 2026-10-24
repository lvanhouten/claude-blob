const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
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

function createWindow() {
  const { x, y } = homePosition();
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
    { label: 'Reset position', click: () => { const p = homePosition(); win.setPosition(p.x, p.y); } },
    { label: 'Test notification', click: () => send({ event: 'Notification', session: 'test', cwd: 'claude-blob', message: 'Claude needs your permission to use Bash' }) },
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
