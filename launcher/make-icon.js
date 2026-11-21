// Draws the app icon (blue rounded square with a play button and D-pad) and writes
// launcher/icon.png (256px, used for the window) and launcher/icon.ico (for the .exe).
// Run: node launcher/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    rgba.copy(row, 1, y * size * 4, (y + 1) * size * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in a 0..1 coordinate space.
function roundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s = (p1x, p1y, p2x, p2y, p3x, p3y) => (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
  const d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function shade(x, y) {
  // returns [r,g,b,a] for a point
  if (!roundRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.2)) return [0, 0, 0, 0];
  const t = (x + y) / 2;
  let r = 71 + (26 - 71) * t, g = 191 + (68 - 191) * t, b = 255 + (194 - 255) * t;
  // soft top highlight
  if (y < 0.5) { const h = (0.5 - y) * 0.25; r += (255 - r) * h; g += (255 - g) * h; b += (255 - b) * h; }
  // D-pad (left)
  const dpad = roundRect(x, y, 0.17, 0.44, 0.43, 0.56, 0.03) || roundRect(x, y, 0.24, 0.37, 0.36, 0.63, 0.03);
  // Play triangle (right)
  const play = inTriangle(x, y, [0.53, 0.33], [0.53, 0.67], [0.83, 0.5]);
  if (dpad || play) return [255, 255, 255, 255];
  return [r, g, b, 255];
}

function render(size) {
  const SS = 4; // supersampling for smooth edges
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
        r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
      }
      const i = (py * size + px) * 4;
      out[i] = a ? r / a : 0; out[i + 1] = a ? g / a : 0; out[i + 2] = a ? b / a : 0; out[i + 3] = a / (SS * SS);
    }
  }
  return png(size, out);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s === 256 ? 0 : s; header[e + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(__dirname, 'icon.png'), images[images.length - 1]);
console.log('Wrote launcher/icon.ico and launcher/icon.png');
