// Reads game identifiers straight from disc images:
//  - PS1/PS2: the boot serial in SYSTEM.CNF (ISO9660), e.g. "SLUS-20946"
//  - GameCube: the 6-character game ID, e.g. "GALE01"
const fs = require('fs');
const path = require('path');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

// Detect the sector layout of a CD/DVD image by finding the ISO9660 primary volume descriptor.
function detectLayout(fd) {
  const layouts = [
    { sector: 2048, offset: 0 },   // plain .iso
    { sector: 2352, offset: 24 },  // raw Mode 2 (most PS1 .bin)
    { sector: 2352, offset: 16 },  // raw Mode 1
  ];
  for (const l of layouts) {
    const pvd = readAt(fd, 16 * l.sector + l.offset, 8);
    if (pvd.length >= 6 && pvd[0] === 1 && pvd.toString('latin1', 1, 6) === 'CD001') return l;
  }
  return null;
}

function readSectors(fd, layout, lba, size) {
  if (layout.sector === 2048) return readAt(fd, lba * 2048, size);
  const chunks = [];
  let remaining = size;
  let cur = lba;
  while (remaining > 0) {
    const part = readAt(fd, cur * layout.sector + layout.offset, Math.min(2048, remaining));
    if (!part.length) break;
    chunks.push(part);
    remaining -= part.length;
    cur++;
  }
  return Buffer.concat(chunks);
}

function findSystemCnf(fd, layout) {
  const pvd = readSectors(fd, layout, 16, 2048);
  const root = pvd.subarray(156, 156 + 34);
  const rootLba = root.readUInt32LE(2);
  const rootSize = Math.min(root.readUInt32LE(10), 64 * 1024);
  const dir = readSectors(fd, layout, rootLba, rootSize);
  let i = 0;
  while (i < dir.length) {
    const len = dir[i];
    if (len === 0) {
      // Records don't cross sector boundaries; skip to the next sector.
      i = (Math.floor(i / 2048) + 1) * 2048;
      continue;
    }
    const nameLen = dir[i + 32];
    const name = dir.toString('latin1', i + 33, i + 33 + nameLen).toUpperCase();
    if (name === 'SYSTEM.CNF;1' || name === 'SYSTEM.CNF') {
      const lba = dir.readUInt32LE(i + 2);
      const size = Math.min(dir.readUInt32LE(i + 10), 4096);
      return readSectors(fd, layout, lba, size).toString('latin1');
    }
    i += len;
  }
  return null;
}

// "BOOT2 = cdrom0:\SLUS_209.46;1" -> "SLUS-20946"
function serialFromCnf(text) {
  const m = /BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4})[_-](\d{3})\.(\d{2})/i.exec(text);
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null;
}

// Many dumps carry the serial in the file name, e.g. "Game (USA) [SLUS-20946].chd"
function serialFromName(name) {
  // Sony serial prefixes start with S (SLUS, SCES, SLPM, ...) or P (PAPX, PBPX).
  const m = /\b([SP][A-Z]{3})[-_ ]?(\d{3})\.?(\d{2})\b/i.exec(name);
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null;
}

function firstBinFromCue(cuePath) {
  try {
    const text = fs.readFileSync(cuePath, 'utf8');
    const m = /FILE\s+"([^"]+)"/i.exec(text) || /FILE\s+(\S+)/i.exec(text);
    if (m) return path.join(path.dirname(cuePath), m[1]);
  } catch {}
  return null;
}

function discSerial(file) {
  const ext = path.extname(file).toLowerCase();
  let target = file;
  if (ext === '.cue') target = firstBinFromCue(file);
  if (target && ['.iso', '.bin', '.img'].includes(path.extname(target).toLowerCase())) {
    let fd;
    try {
      fd = fs.openSync(target, 'r');
      const layout = detectLayout(fd);
      if (layout) {
        const cnf = findSystemCnf(fd, layout);
        const serial = cnf && serialFromCnf(cnf);
        if (serial) return serial;
      }
    } catch {
      // unreadable image; fall back to the name
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return serialFromName(path.basename(file));
}

const GCID = /^[A-Z0-9]{6}$/;

function gamecubeInfo(file) {
  const ext = path.extname(file).toLowerCase();
  // Where the disc header starts inside each container format.
  const headerOffset = { '.iso': 0, '.gcm': 0, '.ciso': 0x8000, '.rvz': 0x58, '.wia': 0x58 }[ext];
  if (headerOffset === undefined) return { id: null, title: null };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = readAt(fd, headerOffset, 0x60);
    const id = head.toString('latin1', 0, 6);
    if (!GCID.test(id)) return { id: null, title: null };
    const raw = head.toString('latin1', 0x20, 0x60);
    const title = raw.split('\0')[0].trim() || null;
    return { id, title };
  } catch {
    return { id: null, title: null };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { discSerial, gamecubeInfo, serialFromCnf, serialFromName };
