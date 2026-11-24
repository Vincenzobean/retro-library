// Builds fake games + save states in test-fixtures/, scans them, and checks the results.
// Also writes test-fixtures/demo-data/settings.json so `npm run demo` shows a filled library.
// Run: node scripts/selftest.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'test-fixtures');
const { buildLibrary } = require('../src/main/scanner');
const { buildCommand } = require('../src/main/launcher');
const { serialFromCnf, serialFromName } = require('../src/main/gameid');
const settingsStore = require('../src/main/settings');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function write(rel, data) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}
function touch(p, ageMs) {
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
}

// ---- Minimal ISO9660 image with a SYSTEM.CNF in the root directory ----
function isoWithCnf(cnfText, sectorSize = 2048, dataOffset = 0) {
  const SECT = 2048;
  const sectors = 21;
  const logical = Buffer.alloc(sectors * SECT);
  const cnf = Buffer.from(cnfText, 'latin1');

  const pvd = logical.subarray(16 * SECT);
  pvd[0] = 1; pvd.write('CD001', 1, 'latin1'); pvd[6] = 1;
  const root = pvd.subarray(156);
  root[0] = 34; root.writeUInt32LE(18, 2); root.writeUInt32BE(18, 6);
  root.writeUInt32LE(SECT, 10); root.writeUInt32BE(SECT, 14); root[25] = 2; root[32] = 1;

  const term = logical.subarray(17 * SECT);
  term[0] = 255; term.write('CD001', 1, 'latin1'); term[6] = 1;

  const dir = logical.subarray(18 * SECT);
  let o = 0;
  const rec = (name, lba, size, flags) => {
    const nameBuf = Buffer.from(name, 'latin1');
    const len = 33 + nameBuf.length + (nameBuf.length % 2 === 0 ? 1 : 0);
    dir[o] = len; dir.writeUInt32LE(lba, o + 2); dir.writeUInt32BE(lba, o + 6);
    dir.writeUInt32LE(size, o + 10); dir.writeUInt32BE(size, o + 14);
    dir[o + 25] = flags; dir[o + 32] = nameBuf.length; nameBuf.copy(dir, o + 33);
    o += len;
  };
  rec('\0', 18, SECT, 2);
  rec('\x01', 18, SECT, 2);
  rec('SYSTEM.CNF;1', 19, cnf.length, 0);
  cnf.copy(logical, 19 * SECT);

  if (sectorSize === 2048) return logical;
  // Raw 2352-byte sectors: put each 2048-byte block at dataOffset.
  const raw = Buffer.alloc(sectors * sectorSize);
  for (let i = 0; i < sectors; i++) logical.copy(raw, i * sectorSize + dataOffset, i * SECT, (i + 1) * SECT);
  return raw;
}

// ---- Tiny PNG (gradient) so RetroArch-style save screenshots show up ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function gradientPng(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      row[1 + x * 3] = r1 + (r2 - r1) * t;
      row[2 + x * 3] = g1 + (g2 - g1) * t;
      row[3 + x * 3] = b1 + (b2 - b1) * t;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true });

  // Games
  write('roms/ps2/Test Racer (USA).iso', isoWithCnf('BOOT2 = cdrom0:\\SLUS_209.46;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n'));
  write('roms/ps2/Unknown Disc (Europe) [SLES-50123].chd', 'not a real chd');
  write('roms/ps1/Test Quest (USA).bin', isoWithCnf('BOOT = cdrom:\\SLUS_005.94;1\r\nTCB = 4\r\n', 2352, 24));
  write('roms/ps1/Test Quest (USA).cue', 'FILE "Test Quest (USA).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n');
  const gc = Buffer.alloc(0x440);
  gc.write('GTKE01', 0, 'latin1');
  gc.write('Test Kart Double Dash', 0x20, 'latin1');
  write('roms/gc/Test Kart (USA).iso', gc);
  write('roms/snes/Test Platformer (USA).sfc', Buffer.alloc(1024));
  write('roms/snes/Another Adventure (USA).smc', Buffer.alloc(1024));
  write('roms/snes/Puzzle Time (Japan).sfc', Buffer.alloc(1024));
  write('roms/genesis/Test Hedgehog (USA, Europe).md', Buffer.alloc(1024));
  write('roms/genesis/Street Brawler (USA).gen', Buffer.alloc(1024));

  // Pretend emulator installs (empty files, enough for path checks)
  const fakeExe = (rel) => write(rel, '');
  const pcsx2 = fakeExe('emus/PCSX2/pcsx2-qt.exe');
  const duck = fakeExe('emus/DuckStation/duckstation-qt-x64-ReleaseLTCG.exe');
  const dolphin = fakeExe('emus/Dolphin/Dolphin.exe');
  const ra = fakeExe('emus/RetroArch/retroarch.exe');
  write('emus/RetroArch/cores/snes9x_libretro.dll', '');
  write('emus/RetroArch/cores/play_libretro.dll', '');

  // Save states
  touch(write('states/pcsx2/SLUS-20946 (1A2B3C4D).01.p2s', 'x'), 2 * HOUR);
  touch(write('states/pcsx2/SLUS-20946 (1A2B3C4D).02.p2s', 'x'), 4 * DAY);
  touch(write('states/pcsx2/SLES-50000 (00000000).01.p2s', 'x'), 3 * DAY); // no ROM for this one
  touch(write('states/duckstation/SLUS-00594_resume.sav', 'x'), 1 * DAY);
  touch(write('states/duckstation/SLUS-00594_1.sav', 'x'), 5 * DAY);
  touch(write('states/dolphin/GTKE01.s01', 'x'), 30 * MIN);
  const raStates = path.join('emus/RetroArch/states');
  touch(write(`${raStates}/Snes9x/Test Platformer (USA).state1`, 'x'), 6 * HOUR);
  write(`${raStates}/Snes9x/Test Platformer (USA).state1.png`, gradientPng(160, 90, [40, 90, 200], [230, 120, 60]));
  touch(write(`${raStates}/Snes9x/Test Platformer (USA).state.auto`, 'x'), 2 * DAY);
  touch(write(`${raStates}/Genesis Plus GX/Test Hedgehog (USA, Europe).state`, 'x'), 9 * DAY);
  touch(write(`${raStates}/Play!/Test Racer (USA).state2`, 'x'), 1 * HOUR); // PS2 via RetroArch's Play! core
  write(`${raStates}/Genesis Plus GX/Test Hedgehog (USA, Europe).state.png`, gradientPng(160, 90, [20, 60, 180], [40, 200, 120]));

  const settings = settingsStore.defaults();
  settings.emulators.pcsx2.path = pcsx2;
  settings.emulators.duckstation.path = duck;
  settings.emulators.dolphin.path = dolphin;
  settings.emulators.retroarch.path = ra;
  // The demo uses the BIOS emulators for PS1/PS2 so disc-serial matching gets exercised too.
  settings.systems.ps2 = { romDirs: [path.join(ROOT, 'roms/ps2')], stateDir: path.join(ROOT, 'states/pcsx2'), emulator: 'pcsx2' };
  settings.systems.ps1 = { romDirs: [path.join(ROOT, 'roms/ps1')], stateDir: path.join(ROOT, 'states/duckstation'), emulator: 'duckstation' };
  settings.systems.gc = { romDirs: [path.join(ROOT, 'roms/gc')], stateDir: path.join(ROOT, 'states/dolphin') };
  settings.systems.snes = { romDirs: [path.join(ROOT, 'roms/snes')], stateDir: '' };
  settings.systems.genesis = { romDirs: [path.join(ROOT, 'roms/genesis')], stateDir: '' };
  settingsStore.save(path.join(ROOT, 'demo-data'), settings);
  return settings;
}

// ---------------------------------------------------------------------------
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('Building fixtures in test-fixtures/ ...');
const settings = makeFixtures();
const lib = buildLibrary(settings, {});
const bySys = (id) => lib.games.filter((g) => g.systemId === id);
const byTitle = (t) => lib.games.find((g) => g.title === t);

console.log('\nGame IDs');
check('SYSTEM.CNF parser (PS2)', () => assert.strictEqual(serialFromCnf('BOOT2 = cdrom0:\\SLUS_209.46;1'), 'SLUS-20946'));
check('SYSTEM.CNF parser (PS1)', () => assert.strictEqual(serialFromCnf('BOOT=cdrom:\\SCUS_944.26;1'), 'SCUS-94426'));
check('serial from file name', () => assert.strictEqual(serialFromName('Game (Europe) [SLES-50123]'), 'SLES-50123'));
check('no false serial in plain names', () => assert.strictEqual(serialFromName('Game 12345 Deluxe'), null));
check('PS2 .iso serial read from disc', () => assert.strictEqual(byTitle('Test Racer').key, 'SLUS-20946'));
check('PS2 .chd falls back to serial in name', () => assert.strictEqual(byTitle('Unknown Disc').key, 'SLES-50123'));
check('PS1 raw .bin via .cue serial', () => assert.strictEqual(byTitle('Test Quest').key, 'SLUS-00594'));
check('PS1 .bin not listed twice next to its .cue', () => assert.strictEqual(bySys('ps1').length, 1));
check('GameCube ID from disc header', () => assert.strictEqual(byTitle('Test Kart').key, 'GTKE01'));

console.log('\nLibrary');
check('game counts per console', () => {
  assert.deepStrictEqual(
    Object.fromEntries(lib.systems.map((s) => [s.id, s.gameCount])),
    { ps2: 2, ps1: 1, gc: 1, n64: 0, snes: 3, genesis: 2, gba: 0, nes: 0 },
  );
});
check('PS2 game has both save slots, newest first', () => {
  const g = byTitle('Test Racer');
  assert.deepStrictEqual(g.saves.map((s) => s.slot), ['1', '2']);
});
check('PS1 resume state shows as Auto', () => assert.deepStrictEqual(byTitle('Test Quest').saves.map((s) => s.slot), ['auto', '1']));
check('RetroArch states matched by ROM name, with screenshot', () => {
  const g = byTitle('Test Platformer');
  assert.strictEqual(g.saves.length, 2);
  assert.ok(g.saves[0].thumb && g.saves[0].thumb.endsWith('.png'));
});
check('save with no ROM shows as "not found" entry', () => {
  assert.ok(lib.orphans.some((o) => o.key === 'SLES-50000' && o.systemId === 'ps2'));
});
check('Continue Playing is sorted by latest save', () => {
  assert.deepStrictEqual(
    lib.continuePlaying.map((g) => g.title),
    ['Test Kart', 'Test Racer', 'Test Platformer', 'Test Quest', 'SLES-50000', 'Test Hedgehog'],
  );
});

console.log('\nLaunch commands');
check('PCSX2 resume uses -statefile', () => {
  const g = byTitle('Test Racer');
  const c = buildCommand(settings, g, g.saves[0]);
  assert.deepStrictEqual(c.args, ['-statefile', g.saves[0].file, '--', g.file]);
});
check('Dolphin uses -b -e and -s', () => {
  const g = byTitle('Test Kart');
  const c = buildCommand(settings, g, g.saves[0]);
  assert.deepStrictEqual(c.args, ['-b', '-e', g.file, '-s', g.saves[0].file]);
});
check('RetroArch slot uses -L core and --entryslot', () => {
  const g = byTitle('Test Platformer');
  const c = buildCommand(settings, g, g.saves[0]);
  assert.strictEqual(c.args[0], '-L');
  assert.ok(c.args[1].endsWith('snes9x_libretro.dll'));
  assert.strictEqual(c.args[3], '--entryslot=1');
});
check('RetroArch missing core gives a clear message', () => {
  const c = buildCommand(settings, byTitle('Test Hedgehog'), null);
  assert.match(c.error, /Genesis Plus GX core/);
});
check('missing emulator gives a clear message', () => {
  const s = JSON.parse(JSON.stringify(settings));
  s.emulators.pcsx2.path = '';
  assert.match(buildCommand(s, byTitle('Test Racer'), null).error, /Set the PCSX2 path in Settings/);
});
check('orphan save cannot launch without a ROM', () => {
  const o = lib.orphans[0];
  assert.match(buildCommand(settings, o, o.saves[0]).error, /game file/);
});

console.log('\nBIOS-free defaults (RetroArch cores for PS1/PS2)');
const noBios = JSON.parse(JSON.stringify(settings));
noBios.systems.ps2 = { romDirs: settings.systems.ps2.romDirs, stateDir: '', emulator: '' };
noBios.systems.ps1 = { romDirs: settings.systems.ps1.romDirs, stateDir: '', emulator: '' };
const lib2 = buildLibrary(noBios, {});
const racer2 = lib2.games.find((g) => g.title === 'Test Racer');
check('PS2 defaults to RetroArch + Play!', () => {
  const s = lib2.systems.find((x) => x.id === 'ps2');
  assert.strictEqual(s.option, 'retroarch:play');
  assert.ok(s.emulatorReady);
});
check('PS1 without the PCSX ReARMed core is "not ready"', () => {
  assert.strictEqual(lib2.systems.find((x) => x.id === 'ps1').emulatorReady, false);
});
check('Play! save state matched by ROM name', () => {
  assert.deepStrictEqual(racer2.saves.map((s) => s.slot), ['2']);
});
check('Play! launch uses the play core and slot', () => {
  const c = buildCommand(noBios, racer2, racer2.saves[0]);
  assert.ok(c.args[1].endsWith('play_libretro.dll'));
  assert.strictEqual(c.args[3], '--entryslot=2');
});

console.log('\nAuto-detect');
check('finds "Games\\<Console>" folders once, keeps user removals', () => {
  const s = settingsStore.defaults();
  const root = path.join(ROOT, 'roms');
  fs.mkdirSync(path.join(root, 'SNES'), { recursive: true });
  const found = settingsStore.autoDetect(s, root);
  assert.ok(found.some((f) => f.startsWith('SNES games')));
  assert.deepStrictEqual(s.systems.snes.romDirs, [path.join(root, 'SNES')]);
  s.systems.snes.romDirs = []; // user removes it
  settingsStore.autoDetect(s, root);
  assert.deepStrictEqual(s.systems.snes.romDirs, []);
});

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
console.log('Demo data written to test-fixtures/demo-data (run: npm run demo)');
process.exit(failures ? 1 : 0);
