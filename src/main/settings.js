// Load/save settings JSON. Kept free of Electron so the self-test can use it.
const fs = require('fs');
const path = require('path');
const { SYSTEMS, EMULATORS } = require('./systems');

function defaults() {
  const s = { emulators: {}, systems: {}, boxArt: false, hideWhilePlaying: true };
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

function load(dir) {
  const file = path.join(dir, 'settings.json');
  try {
    return merge(defaults(), JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
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

module.exports = { load, save, defaults, stateDirFor };
