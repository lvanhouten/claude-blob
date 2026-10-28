const { app, BrowserWindow, dialog, ipcMain, screen, shell, Menu, Tray } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { hookCommand, connect, disconnect, isConnected } = require('./claude-hooks');

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
// color: his base (shade-side) color; lit: a hand-picked lit side, or null to
// let the renderer derive it (with the rest of the palette) from color. The
// default is the original orange and cream.
const DEFAULT_COLOR = '#ff8642';
const DEFAULT_LIT = '#ffdc9c';
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const settings = { light: 'auto', scale: 1, color: DEFAULT_COLOR, lit: DEFAULT_LIT };
try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* defaults */ }
if (!SCALES.some(([s]) => s === settings.scale)) settings.scale = 1;
if (!isHex(settings.color)) Object.assign(settings, { color: DEFAULT_COLOR, lit: DEFAULT_LIT });
if (!isHex(settings.lit)) settings.lit = null;

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

const showColor = (pick) => { if (win && !win.isDestroyed()) win.webContents.send('color', pick); };

// The picker previews on him live; only Apply (done) keeps the pick.
function setColor({ color, lit }, done) {
  if (!isHex(color)) return;
  const pick = { color, lit: isHex(lit) ? lit : null };
  showColor(pick);
  if (!done) return;
  Object.assign(settings, pick);
  saveSettings();
}

const savedColor = () => ({ color: settings.color, lit: settings.lit });

let picker = null;

function openPicker() {
  if (picker && !picker.isDestroyed()) return picker.focus();
  picker = new BrowserWindow({
    width: 320, height: 300, useContentSize: true, show: false, title: 'Blob color',
    resizable: false, maximizable: false, minimizable: false, autoHideMenuBar: true, alwaysOnTop: true, icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  picker.loadFile('color.html', { query: { color: settings.color, lit: settings.lit ?? '' } });
  // Fit the window to the page, so it never needs a scroll bar.
  picker.webContents.on('did-finish-load', async () => {
    const height = await picker.webContents.executeJavaScript('document.documentElement.scrollHeight');
    picker.setContentSize(320, height);
    picker.show();
  });
  // Cancel, or closing it any other way, puts back the saved color.
  picker.on('closed', () => showColor(savedColor()));
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
    showColor(savedColor());
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

// Hides him without quitting: he keeps following Claude Code, and the tray
// menu (or a click on the tray icon) brings him back.
function toggleVisible() {
  if (win.isVisible()) win.hide();
  else {
    win.showInactive(); // he never takes focus
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  if (tray) tray.setContextMenu(menu());
}

// Claude Code runs this copy, so updates and reinstalls never move the path in its settings.
const hookPath = () => path.join(app.getPath('userData'), 'hook.js');
const claudeSettingsFile = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
let claudeConnected = false;

function installHook() {
  try { fs.writeFileSync(hookPath(), fs.readFileSync(path.join(__dirname, 'hook.js'))); } catch { /* keeps the last copy */ }
}

function readClaudeSettings() {
  try { return JSON.parse(fs.readFileSync(claudeSettingsFile(), 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function checkClaude() {
  try { claudeConnected = isConnected(readClaudeSettings(), hookCommand(hookPath())); } catch { claudeConnected = false; }
}

// Leaves a backup beside settings.json, and refuses to touch a file it can't parse.
function toggleClaude() {
  const file = claudeSettingsFile();
  try {
    const current = readClaudeSettings();
    const command = hookCommand(hookPath());
    const next = isConnected(current, command) ? disconnect(current) : connect(current, command);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.claude-blob.bak`);
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  } catch (err) {
    dialog.showErrorBox('Claude Blob', `Couldn't update ${file}:\n${err.message}`);
  }
  checkClaude();
  if (tray) tray.setContextMenu(menu());
  if (claudeConnected) {
    dialog.showMessageBox({ type: 'info', title: 'Claude Blob', message: 'Connected to Claude Code',
      detail: 'Sessions started from now on will show up on the blob. The hooks need Node.js on your PATH.' });
  }
}

// { version, ready }: ready once the download is in place to install on quit.
let update = null;

function startUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  // Unsigned macOS builds can't install updates themselves; the menu links to the download instead.
  autoUpdater.autoDownload = process.platform !== 'darwin';
  const found = (ready) => ({ version }) => {
    update = { version, ready };
    if (tray) tray.setContextMenu(menu());
  };
  autoUpdater.on('update-available', found(false));
  autoUpdater.on('update-downloaded', found(true));
  autoUpdater.on('error', (err) => console.error(`claude-blob: update check failed: ${err.message}`));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline; try again later */ });
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

function updateMenu() {
  if (update?.ready) {
    return [{ label: `Restart to update to v${update.version}`, click: () => require('electron-updater').autoUpdater.quitAndInstall(true, true) }];
  }
  if (update && process.platform === 'darwin') {
    return [{ label: `Download v${update.version}…`, click: () => shell.openExternal('https://github.com/lvanhouten/claude-blob/releases/latest') }];
  }
  return [];
}

function menu() {
  return Menu.buildFromTemplate([
    ...updateMenu(),
    { label: win?.isVisible() === false ? 'Show' : 'Hide', click: toggleVisible },
    { type: 'separator' },
    { label: 'Reset position', click: () => { const p = homePosition(); place(p.x, p.y); savePosition(); } },
    { label: 'Test notification', click: () => send({ event: 'Notification', session: 'test', cwd: 'claude-blob', message: 'Claude needs your permission to use Bash' }) },
    { label: 'Session', submenu: sessionMenu() },
    { label: 'Light', submenu: LIGHTS.map(([mode, label]) => ({ label, type: 'radio', checked: settings.light === mode, click: () => setLight(mode) })) },
    { label: 'Color…', click: openPicker },
    { label: 'Size', submenu: SCALES.map(([scale, label]) => ({ label, type: 'radio', checked: settings.scale === scale, click: () => setScale(scale) })) },
    { label: 'Animation gallery', click: openGallery },
    { label: 'Connect to Claude Code', type: 'checkbox', checked: claudeConnected, click: toggleClaude },
    // Linux has no login-item API, and a dev run would register the bare electron binary.
    ...(app.isPackaged && process.platform !== 'linux' ? [{
      label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    }] : []),
    { type: 'separator' },
    { label: `Version ${app.getVersion()}`, enabled: false },
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

ipcMain.on('set-color', (_e, pick, done) => setColor(pick, done));

ipcMain.on('context-menu',() => menu().popup({ window: win }));

app.whenReady().then(() => {
  app.dock?.hide(); // a desktop pet, not a windowed app
  installHook();
  checkClaude();
  createWindow();
  startServer();
  // Electron swaps in tray@2x.png on high-DPI screens.
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('Claude Blob');
  tray.setContextMenu(menu());
  tray.on('click', toggleVisible);
  startUpdates();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', savePosition);
