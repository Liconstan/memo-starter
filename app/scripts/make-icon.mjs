// Draws the Memo app icon: a portrait of Peeve, a blue-grey cat with amber eyes,
// on a teal-to-violet gradient, with a small sparkle (the Memo mark).
// Usage: node scripts/make-icon.mjs <out.png> <size>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [out, sizeArg] = process.argv.slice(2);
const N = Number(sizeArg || 180);
const SS = 4; // supersampling per axis

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], Math.min(1, Math.max(0, t))));
const TOP = [24, 160, 140];
const MID = [46, 94, 160];
const BOT = [110, 60, 190];
const FUR = [128, 136, 150];      // blue-grey
const FUR_DARK = [96, 103, 117];
const FUR_LIGHT = [158, 165, 178];
const EAR_IN = [176, 140, 150];
const EYE = [236, 160, 40];        // amber
const EYE_RIM = [70, 60, 50];
const PUPIL = [25, 22, 22];
const NOSE = [70, 72, 82];

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const ellipseV = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
const inTri = (x, y, a, b, c) => {
  const d1 = sign(x, y, ...a, ...b), d2 = sign(x, y, ...b, ...c), d3 = sign(x, y, ...c, ...a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const segDist = (x, y, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
};
const star = (x, y, cx, cy, r, p = 0.55) => Math.pow(Math.abs(x - cx) / r, p) + Math.pow(Math.abs(y - cy) / r, p) <= 1;

function shade(x, y) {
  const t = x * 0.35 + y * 0.65;
  let c = t < 0.5 ? mix(TOP, MID, t / 0.5) : mix(MID, BOT, (t - 0.5) / 0.5);
  // A soft glow behind the head.
  c = mix(c, [255, 255, 255], Math.max(0, 0.42 - Math.hypot(x - 0.5, y - 0.56)) * 0.6);

  // Ears: large upright triangles, with a lighter pinkish inner ear.
  const earL = [[0.20, 0.50], [0.27, 0.13], [0.46, 0.34]];
  const earR = [[0.80, 0.50], [0.73, 0.13], [0.54, 0.34]];
  const innerL = [[0.255, 0.44], [0.285, 0.21], [0.41, 0.35]];
  const innerR = [[0.745, 0.44], [0.715, 0.21], [0.59, 0.35]];
  if (inTri(x, y, ...earL) || inTri(x, y, ...earR)) c = FUR_DARK;
  if (inTri(x, y, ...innerL) || inTri(x, y, ...innerR)) c = EAR_IN;

  // Head: a wide rounded shape, shaded darker at the edge.
  const head = ellipseV(x, y, 0.5, 0.58, 0.33, 0.29);
  if (head <= 1) {
    c = mix(FUR_LIGHT, FUR, head);
    c = mix(c, FUR_DARK, Math.max(0, head - 0.75) * 3);
    // A lighter muzzle.
    const muzzle = Math.min(ellipseV(x, y, 0.455, 0.70, 0.08, 0.06), ellipseV(x, y, 0.545, 0.70, 0.08, 0.06));
    if (muzzle <= 1) c = mix(FUR_LIGHT, c, muzzle * 0.6);
    // Eyes: amber with a dark rim and a vertical pupil.
    for (const ex of [0.385, 0.615]) {
      if (inEllipse(x, y, ex, 0.55, 0.068, 0.058)) c = EYE_RIM;
      if (inEllipse(x, y, ex, 0.55, 0.060, 0.050)) c = mix(EYE, [255, 200, 90], Math.max(0, 0.55 - y) * 6);
      if (inEllipse(x, y, ex, 0.55, 0.016, 0.044)) c = PUPIL;
      if (inEllipse(x, y, ex + 0.022, 0.528, 0.011, 0.011)) c = [255, 255, 255];
    }
    // Nose: a small rounded triangle.
    if (inTri(x, y, [0.475, 0.645], [0.525, 0.645], [0.5, 0.675])) c = NOSE;
    // Mouth.
    if (segDist(x, y, 0.5, 0.675, 0.5, 0.695) < 0.005 || segDist(x, y, 0.5, 0.695, 0.475, 0.71) < 0.005 || segDist(x, y, 0.5, 0.695, 0.525, 0.71) < 0.005) c = NOSE;
  }
  // Whiskers: thin light lines that cross the edge of the head.
  for (const [ax, ay, bx, by] of [
    [0.40, 0.69, 0.12, 0.64], [0.40, 0.705, 0.12, 0.72],
    [0.60, 0.69, 0.88, 0.64], [0.60, 0.705, 0.88, 0.72],
  ]) if (segDist(x, y, ax, ay, bx, by) < 0.0045) c = mix(c, [245, 245, 250], 0.85);

  // The Memo sparkle, top right.
  if (star(x, y, 0.86, 0.15, 0.09)) c = [255, 236, 170];
  return c;
}

const px = Buffer.alloc(N * N * 4);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  let acc = [0, 0, 0];
  for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
    const c = shade((i + (si + 0.5) / SS) / N, (j + (sj + 0.5) / SS) / N);
    acc = acc.map((v, k) => v + c[k]);
  }
  const o = (j * N + i) * 4;
  for (let k = 0; k < 3; k++) px[o + k] = Math.round(acc[k] / (SS * SS));
  px[o + 3] = 255;
}

// PNG encoding: signature, IHDR, IDAT (filter byte 0 per row), IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let j = 0; j < N; j++) px.copy(raw, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4);
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
