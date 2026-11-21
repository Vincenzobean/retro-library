const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Images (covers, save screenshots) are served through retroimg:// so the page can only load
// files the app has explicitly handed out.
protocol.registerSchemesAsPrivileged([{ scheme: 'retroimg', privileges: { standard: true, secure: true } }]);
const imageTokens = new Map(); // token -> absolute file path
function imageUrl(file) {
  const token = crypto.createHash('sha1').update(file).digest('hex');
  imageTokens.set(token, file);
  return `retroimg://img/${token}`;
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const settingsStore = require('./src/main/settings');
const { buildLibrary } = require('./src/main/scanner');
const { launch } = require('./src/main/launcher');
const { SYSTEMS, EMULATORS, getSystem } = require('./src/main/systems');

// --data=<folder> runs against a separate data folder (used by `npm run demo`).
const dataArg = process.argv.find((a) => a.startsWith('--data='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice('--data='.length)));
const DATA = app.getPath('userData');
const HISTORY_FILE = path.join(DATA, 'history.json');
const CACHE_FILE = path.join(DATA, 'id-cache.json');
const COVER_DIR = path.join(DATA, 'covers');

let win;
let settings;
let library;
let playing = null;

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}
function writeHistory(h) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(HISTORY_FILE, JSON.stringify(h)); } catch {}
}

function rescan() {
  library = buildLibrary(settings, { cacheFile: CACHE_FILE, history: readHistory() });
  return library;
}

function findGame(id) {
  if (!library) return null;
  return library.games.find((g) => g.id === id) || library.orphans.find((g) => g.id === id) || null;
}

function emulatorInfo() {
  const out = {};
  for (const [key, e] of Object.entries(EMULATORS)) {
    const p = settings.emulators[key] && settings.emulators[key].path;
    out[key] = {
      name: e.name, site: e.site, exeHint: e.exeHint, controllerHelp: e.controllerHelp,
      found: !!p && fs.existsSync(p),
      usableFor: SYSTEMS.filter((s) => s.options.some((o) => o.emulator === key)).map((s) => s.short),
    };
  }
  return out;
}

function snapshot() {
  return {
    library,
    settings,
    emulators: emulatorInfo(),
    playing,
    // Started through "Retro Library.exe"? Then Steam can point straight at that.
    steam: process.env.RETRO_LIBRARY_LAUNCHER
      ? { target: process.env.RETRO_LIBRARY_LAUNCHER, launchOptions: '--fullscreen' }
      : { target: process.execPath, launchOptions: `"${app.getAppPath()}" --fullscreen` },
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e141b',
    title: 'Retro Library',
    icon: path.join(__dirname, 'launcher', 'icon.png'),
    autoHideMenuBar: true,
    fullscreen: process.argv.includes('--fullscreen'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('library:get', () => {
  if (!library) rescan();
  return snapshot();
});

ipcMain.handle('library:rescan', () => {
  rescan();
  return snapshot();
});

ipcMain.handle('settings:save', (_e, next) => {
  settings = { ...settingsStore.defaults(), ...next };
  settingsStore.save(DATA, settings);
  rescan();
  return snapshot();
});

ipcMain.handle('dialog:pickFile', async (_e, { title }) => {
  const r = await dialog.showOpenDialog(win, {
    title: title || 'Choose the emulator program',
    properties: ['openFile'],
    filters: [{ name: 'Programs', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickFolder', async (_e, { title }) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openSite', (_e, emulatorKey) => {
  const e = EMULATORS[emulatorKey];
  if (e) shell.openExternal(`https://${e.site}`);
});

ipcMain.handle('shell:showFile', (_e, file) => {
  if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file);
});

ipcMain.handle('game:launch', (_e, { gameId, stateFile }) => {
  if (playing) return { ok: false, error: 'A game is already running. Close it first.' };
  const game = findGame(gameId);
  if (!game) return { ok: false, error: 'Game not found. Try Rescan.' };
  const state = stateFile ? game.saves.find((s) => s.file === stateFile) : null;

  const result = launch(settings, game, state, (info) => {
    playing = null;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    rescan();
    win.webContents.send('game:exited', { ...info, snapshot: snapshot() });
  });

  if (result.ok) {
    playing = { gameId, title: game.title, startedAt: Date.now() };
    const h = readHistory();
    h[gameId] = Date.now();
    writeHistory(h);
    if (settings.hideWhilePlaying && win) win.minimize();
  }
  return result;
});

// Box art: from the libretro thumbnail server (only when turned on in Settings), cached on disk.
const coverJobs = new Map();
function safeThumbName(name) {
  return name.replace(/[&*/:`<>?\\|"]/g, '_');
}
ipcMain.handle('cover:get', async (_e, gameId) => {
  const game = findGame(gameId);
  if (!game || game.orphan || !game.rawName) return null;
  const sys = getSystem(game.systemId, settings);
  const dir = path.join(COVER_DIR, sys.id);
  const file = path.join(dir, `${safeThumbName(game.rawName)}.png`);
  const miss = `${file}.miss`;
  if (fs.existsSync(file)) return imageUrl(file);
  if (!settings.boxArt || fs.existsSync(miss)) return null;

  if (!coverJobs.has(file)) {
    coverJobs.set(file, (async () => {
      const url = `https://thumbnails.libretro.com/${encodeURIComponent(sys.thumbs)}/Named_Boxarts/${encodeURIComponent(safeThumbName(game.rawName))}.png`;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const res = await fetch(url);
        if (!res.ok) { fs.writeFileSync(miss, ''); return null; }
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        return imageUrl(file);
      } catch {
        return null; // offline: try again next time
      } finally {
        coverJobs.delete(file);
      }
    })());
  }
  return coverJobs.get(file);
});

// Only save-state screenshots the scanner found can be turned into image URLs.
ipcMain.handle('file:url', (_e, file) => {
  if (typeof file !== 'string' || !library) return null;
  const known = [...library.games, ...library.orphans].some((g) => g.saves.some((s) => s.thumb === file));
  return known && fs.existsSync(file) ? imageUrl(file) : null;
});

// --capture=<folder>: saves screenshots of a few screens and quits (used to check the layout).
async function captureScreens(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shots = [
    ['home', ''],
    ['console-snes', "document.querySelector('[data-action=system][data-id=snes]').click()"],
    ['detail', "document.querySelector('.game-tile[data-action=detail]').click()"],
    ['continue-detail', "document.querySelector('[data-action=home]').click(); setTimeout(()=>document.querySelector('.cont-card').click(),300)"],
    ['settings', "document.querySelector('[data-action=settings]').click()"],
  ];
  win.webContents.on('console-message', (_e, level, message) => console.log(`[renderer] ${message}`));
  await wait(1500);
  for (const [name, js] of shots) {
    if (js) await win.webContents.executeJavaScript(`try { ${js} } catch (e) {}`);
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  }
  app.quit();
}

app.setAppUserModelId('RetroLibrary');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  settings = settingsStore.load(DATA);
  protocol.handle('retroimg', async (req) => {
    const token = new URL(req.url).pathname.replace(/^\//, '');
    const file = imageTokens.get(token);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow();
  const cap = process.argv.find((a) => a.startsWith('--capture='));
  if (cap) win.webContents.once('did-finish-load', () => captureScreens(path.resolve(cap.slice('--capture='.length))));
});

app.on('window-all-closed', () => app.quit());
