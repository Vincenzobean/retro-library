// Load/save settings JSON. Kept free of Electron so the self-test can use it.
const fs = require('fs');
const path = require('path');
const { SYSTEMS, EMULATORS } = require('./systems');

function defaults() {
  const s = { emulators: {}, systems: {}, boxArt: false, hideWhilePlaying: true, autoDetected: { emulators: {}, games: {} } };
  for (const key of Object.keys(EMULATORS)) s.emulators[key] = { path: '' };
  // emulator: '' means the console's default choice (see OPTIONS in systems.js)
  for (const sys of SYSTEMS) s.systems[sys.id] = { romDirs: [], stateDir: '', emulator: '' };
  return s;
}

function merge(base, saved) {
  const out = { ...base, ...saved };
  out.emulators = { ...base.emulators };
  out.systems = { ...base.systems };
  for (const k of Object.keys(base.emulators)) out.emulators[k] = { ...base.emulators[k], ...(saved.emulators || {})[k] };
  for (const k of Object.keys(base.systems)) out.systems[k] = { ...base.systems[k], ...(saved.systems || {})[k] };
  return out;
}

// onError(err) is called when an existing settings file can't be read (a missing file is normal).
function load(dir, onError) {
  const file = path.join(dir, 'settings.json');
  try {
    return merge(defaults(), JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT' && onError) onError(err);
    return defaults();
  }
}

function save(dir, settings) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
}

// Where save states live for a console: user override, else the emulator's default.
// `sys` must come from getSystem(id, settings) so the chosen emulator is filled in.
function stateDirFor(settings, sys) {
  const override = settings.systems[sys.id] && settings.systems[sys.id].stateDir;
  if (override) return override;
  const exe = settings.emulators[sys.emulator] && settings.emulators[sys.emulator].path;
  return EMULATORS[sys.emulator].defaultStateDir(exe);
}

/**
 * Fills in emulator paths and game folders that can be found on this PC.
 * Each item is only tried once (remembered in settings.autoDetected), so a path or folder
 * the user clears or removes stays that way.
 *   gamesRoot: folder that may hold one sub-folder per console (e.g. "Retro Library\Games\SNES").
 * Returns a list of what was filled in.
 */
function autoDetect(settings, gamesRoot) {
  const done = settings.autoDetected || (settings.autoDetected = { emulators: {}, games: {} });
  done.emulators = done.emulators || {};
  done.games = done.games || {};
  const found = [];

  for (const [key, emu] of Object.entries(EMULATORS)) {
    if (done.emulators[key]) continue;
    const cfg = settings.emulators[key];
    if (!cfg.path || !fs.existsSync(cfg.path)) {
      const hit = (emu.autoPaths || []).find((p) => fs.existsSync(p));
      if (!hit) continue; // try again next start, in case it gets installed later
      cfg.path = hit;
      found.push(`${emu.name}: ${hit}`);
    }
    done.emulators[key] = true;
  }

  if (gamesRoot) {
    for (const sys of SYSTEMS) {
      if (done.games[sys.id]) continue;
      const names = [sys.short, sys.name, sys.id];
      const dir = names.map((n) => path.join(gamesRoot, n)).find((d) => fs.existsSync(d));
      if (!dir) continue;
      const cfg = settings.systems[sys.id];
      if (!cfg.romDirs.some((d) => path.resolve(d).toLowerCase() === path.resolve(dir).toLowerCase())) {
        cfg.romDirs.push(dir);
        found.push(`${sys.short} games: ${dir}`);
      }
      done.games[sys.id] = true;
    }
  }
  return found;
}

module.exports = { load, save, defaults, stateDirFor, autoDetect };
