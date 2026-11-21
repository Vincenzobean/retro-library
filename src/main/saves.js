// Scans emulator save-state folders.
const fs = require('fs');
const path = require('path');
const { EMULATORS } = require('./systems');

function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}

// Returns [{ key, slot, file, mtime, thumb, owned }]
//   owned = true when the folder can only belong to this console (so unmatched saves are still shown).
function scanStates(sys, stateDir) {
  if (!stateDir) return [];
  const emu = EMULATORS[sys.emulator];
  const dirs = [];
  if (sys.emulator === 'retroarch') {
    // RetroArch can sort states into a per-core folder, or keep them flat.
    dirs.push({ dir: path.join(stateDir, sys.coreName), owned: true });
    dirs.push({ dir: stateDir, owned: false });
  } else {
    dirs.push({ dir: stateDir, owned: true });
  }

  const out = [];
  for (const { dir, owned } of dirs) {
    const names = listFiles(dir);
    const nameSet = new Set(names);
    for (const name of names) {
      const parsed = emu.parseState(name);
      if (!parsed) continue;
      const file = path.join(dir, name);
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      const thumb = nameSet.has(`${name}.png`) ? path.join(dir, `${name}.png`) : null;
      out.push({ ...parsed, file, mtime, thumb, owned });
    }
  }
  return out;
}

module.exports = { scanStates };
