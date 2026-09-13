// Generates BodyView's PWA icon set as PNGs with no external dependencies.
// Run with `npm run icons` after changing the mark.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed distance from point to a line segment. */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/** Signed distance to a rounded rectangle (negative inside). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

/**
 * Renders the mark at an arbitrary size. `bleed` draws the background edge to
 * edge (for maskable icons); otherwise the background is a rounded square.
 */
function renderIcon(size, { bleed = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = size;
  const u = (v) => v * S; // unit-space (0..1) -> pixels
  const SAMPLES = 3;
  const inset = bleed ? 0 : u(0.055);
  const radius = bleed ? 0 : u(0.235);

  // The chart line: an upward trend through five points, in unit space.
  const pts = [
    [0.24, 0.66],
    [0.385, 0.545],
    [0.5, 0.605],
    [0.64, 0.4],
    [0.775, 0.33],
  ].map(([x, y]) => [u(x), u(y)]);
  const lineW = u(0.072);

  // Three ascending bars sitting under the line.
  const bars = [
    [0.3, 0.74, 0.115],
    [0.47, 0.74, 0.175],
    [0.64, 0.74, 0.245],
  ];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let bgA = 0;
      let lineA = 0;
      let barA = 0;
      let dotA = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;

          const dBg = sdRoundRect(px, py, S / 2, S / 2, S / 2 - inset, S / 2 - inset, radius);
          bgA += clamp01(0.5 - dBg);

          let dLine = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            dLine = Math.min(
              dLine,
              distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]),
            );
          }
          lineA += clamp01(0.5 - (dLine - lineW / 2));

          let dBar = Infinity;
          for (const [bx, by, h] of bars) {
            const halfH = u(h) / 2;
            dBar = Math.min(
              dBar,
              sdRoundRect(px, py, u(bx), u(by) - halfH + u(0.02), u(0.052), halfH, u(0.048)),
            );
          }
          barA += clamp01(0.5 - dBar);

          const dDot = Math.hypot(px - pts[4][0], py - pts[4][1]) - u(0.085);
          dotA += clamp01(0.5 - dDot);
        }
      }

      const n = SAMPLES * SAMPLES;
      bgA /= n;
      lineA /= n;
      barA /= n;
      dotA /= n;

      const gy = y / S;
      const gx = x / S;

      // Background: subtle vertical gradient, deep navy.
      let r = mix(22, 11, gy);
      let g = mix(30, 14, gy);
      let b = mix(44, 20, gy);
      let a = bgA * 255;

      // Bars: muted slate, diagonal gradient so they recede behind the line.
      const barR = mix(56, 86, gx);
      const barG = mix(70, 104, gx);
      const barB = mix(96, 134, gx);
      r = mix(r, barR, barA);
      g = mix(g, barG, barA);
      b = mix(b, barB, barA);
      a = Math.max(a, barA * bgA * 255);

      // Trend line + endpoint dot: teal -> cyan along the x axis.
      const accentA = Math.max(lineA, dotA);
      const t = clamp01((gx - 0.22) / 0.58);
      const accR = mix(52, 56, t);
      const accG = mix(211, 189, t);
      const accB = mix(153, 248, t);
      r = mix(r, accR, accentA);
      g = mix(g, accG, accentA);
      b = mix(b, accB, accentA);
      a = Math.max(a, accentA * bgA * 255);

      const i = (y * S + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(clamp01(a / 255) * 255);
    }
  }

  return encodePng(S, S, rgba);
}

const targets = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/icon-512-maskable.png', 512, { bleed: true }],
  ['public/apple-touch-icon.png', 180, { bleed: true }],
];

for (const [file, size, opts] of targets) {
  const out = resolve(ROOT, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderIcon(size, opts));
  console.log(`wrote ${file} (${size}x${size})`);
}
