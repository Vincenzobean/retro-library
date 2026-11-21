// Builds the library: games per console, their save states, and the Continue Playing list.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SYSTEMS, getSystem } = require('./systems');
const { stateDirFor } = require('./settings');
const { discSerial, gamecubeInfo } = require('./gameid');
const { scanStates } = require('./saves');

const MAX_DEPTH = 4;

function walk(dir, exts, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const lower = files.map((f) => f.toLowerCase());
  const hasM3u = lower.some((f) => f.endsWith('.m3u'));
  const hasCue = lower.some((f) => f.endsWith('.cue'));

  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    if (!exts.includes(ext)) continue;
    // Multi-file discs: show one entry per game, not one per track.
    if (hasM3u && ext !== '.m3u' && ['.cue', '.bin', '.chd', '.iso'].includes(ext)) continue;
    if (hasCue && ext === '.bin' && exts.includes('.cue')) continue;
    out.push(path.join(dir, name));
  }
  if (depth < MAX_DEPTH) {
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), exts, depth + 1, out);
  }
  return out;
}

function cleanTitle(base) {
  const t = base.replace(/\s*[\[(][^\])]*[\])]/g, '').replace(/_/g, ' ').trim();
  return t || base;
}

function gameIdFor(file) {
  return crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 12);
}

// Disc IDs are slow-ish to read, so remember them between scans.
class IdCache {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.dirty = false;
    if (file) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
  }
  get(gamePath, compute) {
    let stamp = '';
    try {
      const st = fs.statSync(gamePath);
      stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {}
    const hit = this.data[gamePath];
    if (hit && hit.stamp === stamp) return hit.value;
    const value = compute();
    this.data[gamePath] = { stamp, value };
    this.dirty = true;
    return value;
  }
  flush() {
    if (this.file && this.dirty) {
      try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch {}
      this.dirty = false;
    }
  }
}

function scanGames(sys, romDirs, cache) {
  const files = [];
  for (const d of romDirs) walk(d, sys.extensions, 0, files);
  const seen = new Set();
  const games = [];
  for (const file of files) {
    if (seen.has(file.toLowerCase())) continue;
    seen.add(file.toLowerCase());
    const base = path.basename(file, path.extname(file));
    let key = base.toLowerCase();
    let title = cleanTitle(base);
    if (sys.idType === 'serial') {
      key = cache.get(file, () => discSerial(file)) || null;
    } else if (sys.idType === 'gcid') {
      const info = cache.get(file, () => gamecubeInfo(file));
      key = info.id;
    }
    games.push({
      id: gameIdFor(file),
      systemId: sys.id,
      title,
      rawName: base,
      file,
      key,
      saves: [],
      lastSave: 0,
      lastPlayed: 0,
    });
  }
  return games;
}

/**
 * @param settings  settings object (see settings.js)
 * @param opts      { cacheFile, history: { [gameId]: timestamp } }
 */
function buildLibrary(settings, opts = {}) {
  const cache = new IdCache(opts.cacheFile);
  const history = opts.history || {};
  const systems = [];
  const games = [];
  const orphans = [];

  for (const base of SYSTEMS) {
    const sys = getSystem(base.id, settings);
    const cfg = settings.systems[sys.id] || { romDirs: [] };
    const romDirs = (cfg.romDirs || []).filter(Boolean);
    const stateDir = stateDirFor(settings, sys);
    const emuPath = (settings.emulators[sys.emulator] || {}).path || '';

    const sysGames = scanGames(sys, romDirs, cache);
    const states = scanStates(sys, stateDir);

    const byKey = new Map();
    for (const g of sysGames) if (g.key) {
      if (!byKey.has(g.key)) byKey.set(g.key, []);
      byKey.get(g.key).push(g);
    }

    const orphanByKey = new Map();
    for (const st of states) {
      const matches = byKey.get(st.key);
      if (matches) {
        for (const g of matches) {
          if (!g.saves.some((s) => s.file === st.file)) g.saves.push(st);
        }
      } else if (st.owned) {
        if (!orphanByKey.has(st.key)) orphanByKey.set(st.key, []);
        orphanByKey.get(st.key).push(st);
      }
    }

    for (const g of sysGames) {
      g.saves.sort((a, b) => b.mtime - a.mtime);
      g.lastSave = g.saves.length ? g.saves[0].mtime : 0;
      g.lastPlayed = Math.max(g.lastSave, history[g.id] || 0);
    }

    for (const [key, saves] of orphanByKey) {
      saves.sort((a, b) => b.mtime - a.mtime);
      orphans.push({
        id: `orphan-${sys.id}-${key}`,
        systemId: sys.id,
        title: sys.idType === 'name' ? key : key.toUpperCase(),
        file: null,
        key,
        saves,
        lastSave: saves[0].mtime,
        lastPlayed: saves[0].mtime,
        orphan: true,
      });
    }

    games.push(...sysGames);
    systems.push({
      id: sys.id,
      name: sys.name,
      short: sys.short,
      maker: sys.maker,
      year: sys.year,
      color: sys.color,
      emulator: sys.emulator,
      option: sys.option,
      options: sys.options.map((o) => ({ id: o.id, label: o.label, bios: !!o.bios })),
      coreName: sys.coreName,
      idType: sys.idType,
      extensions: sys.extensions,
      emulatorReady: !!emuPath && fs.existsSync(emuPath)
        && (!sys.core || fs.existsSync(path.join(path.dirname(emuPath), 'cores', sys.core))),
      configured: romDirs.length > 0,
      stateDir,
      stateDirExists: !!stateDir && fs.existsSync(stateDir),
      gameCount: sysGames.length,
      saveCount: sysGames.filter((g) => g.lastSave).length + orphanByKey.size,
    });
  }

  cache.flush();

  const continuePlaying = [...games.filter((g) => g.lastSave), ...orphans]
    .sort((a, b) => b.lastSave - a.lastSave);

  return { systems, games, orphans, continuePlaying, scannedAt: Date.now() };
}

module.exports = { buildLibrary, cleanTitle, walk };
