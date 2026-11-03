// Generates build/icon.png (256px) and build/icon.ico (256/48/32/16, PNG-compressed entries) without native deps.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const OUT = path.join(__dirname, '..', 'build'); fs.mkdirSync(OUT, { recursive: true });

function render(size, ss = 3) {
  const S = size * ss; const img = new Float32Array(S * S * 4);
  const inRound = (x, y, x0, y0, w, h, r) => { const cx = Math.max(x0 + r, Math.min(x, x0 + w - r)), cy = Math.max(y0 + r, Math.min(y, y0 + h - r)); const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r ? 1 : 0; };
  const rot = (x, y, cx, cy, a) => { const c = Math.cos(a), s = Math.sin(a); const dx = x - cx, dy = y - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
  const bgR = S * 0.23; const cardW = S * 0.585, cardH = S * 0.41, cardR = S * 0.07;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x + 0.5, py = y + 0.5; let r = 0, g = 0, b = 0, a = 0;
    if (inRound(px, py, 0, 0, S, S, bgR)) { const t = (px + py) / (2 * S); r = 124 + (200 - 124) * t; g = 127 + (92 - 127) * t; b = 245 + (240 - 245) * t; a = 1; }
    if (a) {
      // back card (rotated +10deg, translucent), front card (rotated -10deg, white)
      const [bx, by] = rot(px, py, S / 2 + S * 0.035, S / 2 + S * 0.035, -10 * Math.PI / 180);
      if (inRound(bx, by, S / 2 - cardW / 2, S / 2 - cardH / 2, cardW, cardH, cardR)) { r = r + (255 - r) * 0.5; g = g + (255 - g) * 0.5; b = b + (255 - b) * 0.5; }
      const [fx, fy] = rot(px, py, S / 2, S / 2, 10 * Math.PI / 180);
      if (inRound(fx, fy, S / 2 - cardW / 2, S / 2 - cardH / 2, cardW, cardH, cardR)) {
        r = 250; g = 250; b = 255;
        const lx = fx - (S / 2 - cardW / 2), ly = fy - (S / 2 - cardH / 2); const lineH = S * 0.043, rad = lineH / 2; const left = cardW * 0.13;
        if (inRound(lx, ly, left, cardH * 0.24, cardW * 0.52, lineH, rad)) { r = 124; g = 127; b = 245; }
        else if (inRound(lx, ly, left, cardH * 0.45, cardW * 0.7, lineH, rad) || inRound(lx, ly, left, cardH * 0.66, cardW * 0.4, lineH, rad)) { r = 196; g = 181; b = 253; }
      }
    }
    const i = (y * S + x) * 4; img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a * 255;
  }
  // downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let r = 0, g = 0, b = 0, a = 0; for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) { const i = ((y * ss + dy) * S + (x * ss + dx)) * 4; const al = img[i + 3] / 255; r += img[i] * al; g += img[i + 1] * al; b += img[i + 2] * al; a += al; } const n = ss * ss; const o = (y * size + x) * 4; if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); } out[o + 3] = Math.round(a / n * 255); }
  return out;
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size); for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [256, 64, 48, 32, 16]; const pngs = sizes.map(s => ({ s, buf: png(render(s, s >= 64 ? 3 : 4), s) }));
fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[0].buf);
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png(render(512, 2), 512));
// ICO container
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length; const entries = [], datas = [];
for (const p of pngs) { const e = Buffer.alloc(16); e[0] = p.s === 256 ? 0 : p.s; e[1] = p.s === 256 ? 0 : p.s; e[2] = 0; e[3] = 0; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(p.buf.length, 8); e.writeUInt32LE(offset, 12); entries.push(e); datas.push(p.buf); offset += p.buf.length; }
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([header, ...entries, ...datas]));
fs.copyFileSync(path.join(OUT, 'icon.png'), path.join(__dirname, '..', 'src', 'icon.png'));
console.log('icons written:', pngs.map(p => `${p.s}px ${p.buf.length}B`).join(', '));
