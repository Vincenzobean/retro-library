// Adds "Retro Library" to Steam as a non-Steam game (for every Steam user on this PC).
// Steam must be closed first, or it overwrites shortcuts.vdf when it exits.
// Usage: node scripts/add-to-steam.js ["C:\path\to\Retro Library.exe"] [--steam "C:\Program Files (x86)\Steam"]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- Binary VDF (shortcuts.vdf format) -----------------------------------
// 0x00 = nested map, 0x01 = string, 0x02 = int32, 0x08 = end of map
function parse(buf) {
  let i = 0;
  const cstr = () => { const end = buf.indexOf(0, i); const s = buf.toString('utf8', i, end); i = end + 1; return s; };
  function map() {
    const out = {};
    for (;;) {
      const type = buf[i++];
      if (type === 0x08 || type === undefined) return out;
      const key = cstr();
      if (type === 0x00) out[key] = map();
      else if (type === 0x01) out[key] = cstr();
      else if (type === 0x02) { out[key] = { int32: buf.readInt32LE(i) }; i += 4; }
      else throw new Error(`Unknown VDF type 0x${type.toString(16)} at ${i}`);
    }
  }
  return map();
}

function serialize(obj) {
  const parts = [];
  const str = (s) => parts.push(Buffer.from(`${s}\0`, 'utf8'));
  (function write(m) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'string') { parts.push(Buffer.from([0x01])); str(k); str(v); }
      else if (v && typeof v.int32 === 'number') {
        parts.push(Buffer.from([0x02])); str(k);
        const b = Buffer.alloc(4); b.writeInt32LE(v.int32); parts.push(b);
      } else { parts.push(Buffer.from([0x00])); str(k); write(v); }
    }
    parts.push(Buffer.from([0x08]));
  })(obj);
  parts.push(Buffer.from([0x08]));
  return Buffer.concat(parts);
}

// Steam's id for a shortcut: crc32(exe + name) with the top bit set.
function shortcutAppId(exe, name) {
  return (zlib.crc32(Buffer.from(exe + name, 'utf8')) | 0x80000000) | 0; // as signed int32
}

// ---- Main -----------------------------------------------------------------
const args = process.argv.slice(2);
const steamIdx = args.indexOf('--steam');
const steamDir = steamIdx >= 0 ? args.splice(steamIdx, 2)[1] : 'C:\\Program Files (x86)\\Steam';
const exePath = path.resolve(args[0] || path.join(__dirname, '..', '..', 'Retro Library.exe'));
const appDir = path.join(__dirname, '..');
const NAME = 'Retro Library';

if (!fs.existsSync(exePath)) { console.error(`Not found: ${exePath}`); process.exit(1); }
const userdata = path.join(steamDir, 'userdata');
if (!fs.existsSync(userdata)) { console.error(`Steam userdata not found in ${steamDir}`); process.exit(1); }

const exeQuoted = `"${exePath}"`;
const entry = {
  appid: { int32: shortcutAppId(exeQuoted, NAME) },
  AppName: NAME,
  Exe: exeQuoted,
  StartDir: `"${path.dirname(exePath)}\\"`,
  icon: path.join(appDir, 'launcher', 'icon.ico'),
  ShortcutPath: '',
  LaunchOptions: '--fullscreen',
  IsHidden: { int32: 0 },
  AllowDesktopConfig: { int32: 1 },
  AllowOverlay: { int32: 1 },
  OpenVR: { int32: 0 },
  Devkit: { int32: 0 },
  DevkitGameID: '',
  DevkitOverrideAppID: { int32: 0 },
  LastPlayTime: { int32: 0 },
  FlatpakAppID: '',
  tags: {},
};

for (const user of fs.readdirSync(userdata)) {
  if (!/^\d+$/.test(user) || user === '0') continue;
  const cfgDir = path.join(userdata, user, 'config');
  const file = path.join(cfgDir, 'shortcuts.vdf');
  let data = { shortcuts: {} };
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
    data = parse(fs.readFileSync(file));
    data.shortcuts = data.shortcuts || {};
  }
  const list = Object.values(data.shortcuts);
  const existing = list.findIndex((s) => s.AppName === NAME || s.Exe === exeQuoted);
  if (existing >= 0) list[existing] = { ...list[existing], ...entry };
  else list.push(entry);
  data.shortcuts = Object.fromEntries(list.map((s, idx) => [String(idx), s]));

  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(file, serialize(data));

  // Check the file reads back.
  const check = parse(fs.readFileSync(file));
  const ok = Object.values(check.shortcuts).some((s) => s.AppName === NAME);
  console.log(`${existing >= 0 ? 'Updated' : 'Added'} "${NAME}" for Steam user ${user}: ${ok ? 'ok' : 'FAILED'}`);
}
