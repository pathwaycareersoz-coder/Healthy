// Generates the Peak Performance app icons (PNG) with zero dependencies.
// Draws a lightning bolt on a dark gradient — used for the phone home-screen icon,
// the PWA manifest, and the iOS apple-touch-icon.
//
// Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---- tiny PNG encoder (RGBA, 8-bit) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing helpers ----
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
// point in polygon (even-odd)
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
// distance from point to polygon edge (for anti-aliasing the bolt)
function distToPoly(px, py, poly) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < min) min = d;
  }
  return min;
}

// lightning bolt, normalized 0..1 within the icon's content box
const BOLT = [
  [0.56, 0.06], [0.28, 0.54], [0.46, 0.54], [0.40, 0.94],
  [0.74, 0.42], [0.55, 0.42], [0.62, 0.06],
];

function render(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0.20 : 0.0; // maskable keeps art inside the safe zone
  const radius = maskable ? 0 : size * 0.225; // iOS/Android round it themselves; PWA rounded looks nicer
  const bg1 = [18, 20, 27];   // top
  const bg2 = [30, 24, 46];   // bottom (subtle violet)
  const glow = [40, 60, 110]; // radial accent
  const boltTop = [125, 211, 252]; // #7dd3fc
  const boltBot = [139, 92, 246];  // #8b5cf6

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect alpha
      let a = 255;
      if (radius > 0) {
        const rx = Math.min(x, size - 1 - x);
        const ry = Math.min(y, size - 1 - y);
        if (rx < radius && ry < radius) {
          const d = Math.hypot(radius - rx, radius - ry);
          a = d <= radius ? 255 : d <= radius + 1.2 ? Math.round(255 * (radius + 1.2 - d) / 1.2) : 0;
        }
      }
      // background gradient + glow
      const ty = y / size;
      let col = mix(bg1, bg2, ty);
      const cx = size * 0.5, cy = size * 0.42;
      const gd = Math.hypot(x - cx, y - cy) / (size * 0.62);
      const gi = Math.max(0, 1 - gd);
      col = mix(col, glow, gi * 0.5);
      // bolt in content box
      const bx = (x / size - pad) / (1 - 2 * pad);
      const by = (y / size - pad) / (1 - 2 * pad);
      if (bx >= 0 && bx <= 1 && by >= 0 && by <= 1) {
        const inside = inPoly(bx, by, BOLT);
        const dpx = distToPoly(bx, by, BOLT) * size; // in px
        let boltA = inside ? 1 : 0;
        if (!inside && dpx < 1.4) boltA = (1.4 - dpx) / 1.4; // AA outer edge
        if (boltA > 0) {
          const bc = mix(boltTop, boltBot, by);
          col = mix(col, bc, boltA);
        }
      }
      rgba[i] = Math.round(col[0]);
      rgba[i + 1] = Math.round(col[1]);
      rgba[i + 2] = Math.round(col[2]);
      rgba[i + 3] = a;
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync("icons", { recursive: true });
writeFileSync("icons/icon-192.png", render(192));
writeFileSync("icons/icon-512.png", render(512));
writeFileSync("icons/maskable-512.png", render(512, { maskable: true }));
writeFileSync("icons/apple-touch-icon.png", render(180));
writeFileSync("icons/favicon-64.png", render(64));
console.log("Icons written to ./icons");
