// Console and emulator definitions. Add a console by adding an entry to SYSTEMS.
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const DOCS = path.join(HOME, 'Documents');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates.find(Boolean) || '';
}

function isPortable(exePath, markers) {
  if (!exePath) return false;
  const dir = path.dirname(exePath);
  return markers.some((m) => fs.existsSync(path.join(dir, m)));
}

// ---------------------------------------------------------------------------
// Emulators: how to find their save states and how to launch them.
// ---------------------------------------------------------------------------
const EMULATORS = {
  pcsx2: {
    name: 'PCSX2',
    site: 'pcsx2.net',
    exeHint: 'pcsx2-qt.exe',
    controllerHelp: 'Settings > Controllers > Port 1: pick your XInput controller, then click "Automatic Mapping".',
    defaultStateDir(exe) {
      if (isPortable(exe, ['portable.ini', 'portable.txt'])) return path.join(path.dirname(exe), 'sstates');
      return firstExisting([path.join(DOCS, 'PCSX2', 'sstates')]);
    },
    // e.g. "SLUS-20946 (A1B2C3D4).01.p2s"
    parseState(file) {
      const m = /^([A-Z]{4}-\d{5}) \(([0-9A-F]{8})\)\.(\d+)\.p2s$/i.exec(file);
      if (!m) return null;
      return { key: m[1].toUpperCase(), slot: String(parseInt(m[3], 10)) };
    },
    args({ game, statePath }) {
      const a = [];
      if (statePath) a.push('-statefile', statePath);
      a.push('--', game);
      return a;
    },
  },

  duckstation: {
    name: 'DuckStation',
    site: 'duckstation.org',
    exeHint: 'duckstation-qt-x64-ReleaseLTCG.exe',
    controllerHelp: 'Settings > Controllers: set Port 1 to "Analog Controller", then click "Automatic Mapping" for your XInput pad.',
    defaultStateDir(exe) {
      if (isPortable(exe, ['portable.txt'])) return path.join(path.dirname(exe), 'savestates');
      return firstExisting([
        path.join(DOCS, 'DuckStation', 'savestates'),
        path.join(HOME, 'AppData', 'Local', 'DuckStation', 'savestates'),
      ]);
    },
    // e.g. "SLUS-00594_1.sav" or "SLUS-00594_resume.sav"
    parseState(file) {
      const m = /^([A-Z]{4}-\d{5})_(\w+)\.sav$/i.exec(file);
      if (!m) return null;
      return { key: m[1].toUpperCase(), slot: m[2].toLowerCase() === 'resume' ? 'auto' : m[2] };
    },
    args({ game, statePath }) {
      const a = [];
      if (statePath) a.push('-statefile', statePath);
      a.push('--', game);
      return a;
    },
  },

  dolphin: {
    name: 'Dolphin',
    site: 'dolphin-emu.org',
    exeHint: 'Dolphin.exe',
    controllerHelp: 'Controllers > Port 1: "Standard Controller" > Configure, choose your XInput device and map the buttons.',
    defaultStateDir(exe) {
      if (isPortable(exe, ['portable.txt'])) return path.join(path.dirname(exe), 'User', 'StateSaves');
      // Dolphin 2306+ uses AppData; older installs that already have a Documents folder keep using it.
      const docs = path.join(DOCS, 'Dolphin Emulator');
      if (fs.existsSync(docs)) return path.join(docs, 'StateSaves');
      return path.join(APPDATA, 'Dolphin Emulator', 'StateSaves');
    },
    // e.g. "GALE01.s01"
    parseState(file) {
      const m = /^([A-Z0-9]{6})\.s(\d+)$/i.exec(file);
      if (!m) return null;
      return { key: m[1].toUpperCase(), slot: String(parseInt(m[2], 10)) };
    },
    args({ game, statePath }) {
      // -b closes Dolphin when the game stops, so you drop back into the library.
      const a = ['-b', '-e', game];
      if (statePath) a.push('-s', statePath);
      return a;
    },
  },

  retroarch: {
    name: 'RetroArch',
    site: 'retroarch.com',
    exeHint: 'retroarch.exe',
    controllerHelp: 'RetroArch detects Xbox/XInput controllers automatically. Select+Start opens the menu; use "Quit RetroArch" to return here.',
    defaultStateDir(exe) {
      if (!exe) return '';
      return path.join(path.dirname(exe), 'states');
    },
    // e.g. "Super Mario World (USA).state", ".state3", ".state.auto"
    parseState(file) {
      const m = /^(.*)\.state(\d+|\.auto)?$/i.exec(file);
      if (!m) return null;
      let slot = '0';
      if (m[2] === '.auto') slot = 'auto';
      else if (m[2]) slot = m[2];
      return { key: m[1].toLowerCase(), slot };
    },
    args({ game, statePath, slot, exe, core }) {
      const a = ['-L', path.join(path.dirname(exe), 'cores', core), game];
      if (statePath && slot && slot !== 'auto') a.push(`--entryslot=${slot}`);
      return a;
    },
  },
};

// ---------------------------------------------------------------------------
// Consoles.
//   idType: 'serial' (PS1/PS2 disc serial), 'gcid' (GameCube game ID), 'name' (ROM file name)
// ---------------------------------------------------------------------------
const SYSTEMS = [
  {
    id: 'ps2', name: 'PlayStation 2', short: 'PS2', maker: 'Sony', year: 2000,
    color: ['#1a3a8f', '#0b1640'], emulator: 'pcsx2', idType: 'serial',
    extensions: ['.iso', '.chd', '.bin', '.cso', '.gz', '.isz'],
    thumbs: 'Sony - PlayStation 2',
  },
  {
    id: 'ps1', name: 'PlayStation', short: 'PS1', maker: 'Sony', year: 1994,
    color: ['#5b5f6b', '#1d1f26'], emulator: 'duckstation', idType: 'serial',
    extensions: ['.cue', '.chd', '.bin', '.pbp', '.m3u', '.iso'],
    thumbs: 'Sony - PlayStation',
  },
  {
    id: 'gc', name: 'GameCube', short: 'GameCube', maker: 'Nintendo', year: 2001,
    color: ['#5a3fa8', '#1f1342'], emulator: 'dolphin', idType: 'gcid',
    extensions: ['.iso', '.rvz', '.gcm', '.ciso', '.gcz'],
    thumbs: 'Nintendo - GameCube',
  },
  {
    id: 'n64', name: 'Nintendo 64', short: 'N64', maker: 'Nintendo', year: 1996,
    color: ['#2e8b3a', '#0f2e14'], emulator: 'retroarch', idType: 'name',
    core: 'mupen64plus_next_libretro.dll', coreName: 'Mupen64Plus-Next',
    extensions: ['.z64', '.n64', '.v64'],
    thumbs: 'Nintendo - Nintendo 64',
  },
  {
    id: 'snes', name: 'Super Nintendo', short: 'SNES', maker: 'Nintendo', year: 1990,
    color: ['#6b4fb5', '#241a40'], emulator: 'retroarch', idType: 'name',
    core: 'snes9x_libretro.dll', coreName: 'Snes9x',
    extensions: ['.sfc', '.smc'],
    thumbs: 'Nintendo - Super Nintendo Entertainment System',
  },
  {
    id: 'genesis', name: 'Sega Genesis', short: 'Genesis', maker: 'Sega', year: 1988,
    color: ['#b3262e', '#3a0c0f'], emulator: 'retroarch', idType: 'name',
    core: 'genesis_plus_gx_libretro.dll', coreName: 'Genesis Plus GX',
    extensions: ['.md', '.gen', '.bin', '.smd'],
    thumbs: 'Sega - Mega Drive - Genesis',
  },
  {
    id: 'gba', name: 'Game Boy Advance', short: 'GBA', maker: 'Nintendo', year: 2001,
    color: ['#3d4fa8', '#141a3d'], emulator: 'retroarch', idType: 'name',
    core: 'mgba_libretro.dll', coreName: 'mGBA',
    extensions: ['.gba'],
    thumbs: 'Nintendo - Game Boy Advance',
  },
  {
    id: 'nes', name: 'Nintendo (NES)', short: 'NES', maker: 'Nintendo', year: 1983,
    color: ['#a8323a', '#2b0d10'], emulator: 'retroarch', idType: 'name',
    core: 'mesen_libretro.dll', coreName: 'Mesen',
    extensions: ['.nes'],
    thumbs: 'Nintendo - Nintendo Entertainment System',
  },
];

// How each emulator identifies games in its save-state file names.
EMULATORS.pcsx2.idType = 'serial';
EMULATORS.duckstation.idType = 'serial';
EMULATORS.dolphin.idType = 'gcid';
EMULATORS.retroarch.idType = 'name';

// Emulator choices per console. The first one is the default.
// bios: true means it won't run games without a BIOS file from a real console.
const OPTIONS = {
  ps2: [
    { id: 'retroarch:play', emulator: 'retroarch', core: 'play_libretro.dll', coreName: 'Play!', label: 'RetroArch · Play! (no BIOS needed)' },
    { id: 'pcsx2', emulator: 'pcsx2', label: 'PCSX2 (best compatibility, needs a PS2 BIOS)', bios: true },
  ],
  ps1: [
    { id: 'retroarch:pcsx_rearmed', emulator: 'retroarch', core: 'pcsx_rearmed_libretro.dll', coreName: 'PCSX-ReARMed', label: 'RetroArch · PCSX ReARMed (no BIOS needed)' },
    { id: 'duckstation', emulator: 'duckstation', label: 'DuckStation (needs a PS1 BIOS)', bios: true },
  ],
  gc: [{ id: 'dolphin', emulator: 'dolphin', label: 'Dolphin' }],
};
for (const sys of SYSTEMS) {
  if (!OPTIONS[sys.id]) {
    OPTIONS[sys.id] = [{ id: `retroarch:${sys.core.replace('_libretro.dll', '')}`, emulator: 'retroarch', core: sys.core, coreName: sys.coreName, label: `RetroArch · ${sys.coreName}` }];
  }
  sys.options = OPTIONS[sys.id];
}

/**
 * The console with its chosen emulator filled in (emulator, core, coreName, idType).
 * Without settings, the default choice is used.
 */
function getSystem(id, settings) {
  const sys = SYSTEMS.find((s) => s.id === id);
  if (!sys) return null;
  const wanted = settings && settings.systems && settings.systems[id] && settings.systems[id].emulator;
  const opt = sys.options.find((o) => o.id === wanted) || sys.options[0];
  return {
    ...sys,
    option: opt.id,
    emulator: opt.emulator,
    core: opt.core || null,
    coreName: opt.coreName || null,
    idType: EMULATORS[opt.emulator].idType,
  };
}

module.exports = { SYSTEMS, EMULATORS, getSystem };
