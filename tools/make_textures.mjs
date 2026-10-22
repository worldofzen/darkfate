// Generates the level's stone textures (run once: `node tools/make_textures.mjs`).
//
// Each surface gets three images, like textures from a game studio:
//   *_color   the paint (stone colour, dirt in the cracks, a little moss)
//   *_normal  fakes small bumps so light catches pits, chips and crack edges
//   *_orm     red = ambient occlusion (dark in crevices), green = roughness, blue = metalness (0)
// All of them tile seamlessly. They're drawn from random noise and "random walk" cracks,
// so there are no image files to download, and changing the seed gives a new look.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = 'public/textures';
mkdirSync(OUT, { recursive: true });

// ---------- Helpers ----------
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// Smooth noise that repeats every `period` cells (so the texture tiles).
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Layers of noise from big blotches to fine grain (u, v in 0..1).
function fbm(u, v, frequency, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * frequency, v * frequency, frequency, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

function field(size, fn) {
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) f[y * size + x] = fn(x / size, y / size, x, y);
  return f;
}

// Draws cracks into `mask` (values 0..1), wrapping around the edges. Real stone cracks run
// fairly straight and change direction in sharp little kinks, so each crack is made of short
// straight segments with a small random turn between them, and side-branches split off at an angle.
function drawCracks(mask, size, rand, { count, length, width, branchChance }) {
  const stack = [];
  for (let i = 0; i < count; i++) {
    stack.push({ x: rand() * size, y: rand() * size, angle: rand() * Math.PI * 2, length: length * (0.6 + rand() * 0.8), width: width * (0.6 + rand() * 0.8) });
  }
  const stamp = (x, y, w) => {
    const r = Math.ceil(w + 1);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > w + 1) continue;
        const px = ((Math.round(x) + dx) % size + size) % size;
        const py = ((Math.round(y) + dy) % size + size) % size;
        const v = Math.min(1, w + 1 - d);
        const i = py * size + px;
        if (v > mask[i]) mask[i] = v;
      }
    }
  };
  while (stack.length) {
    const c = stack.pop();
    let { x, y, angle } = c;
    const heading = angle; // cracks wander around one main direction
    let travelled = 0;
    while (travelled < c.length) {
      const segment = 6 + rand() * 18;
      angle = heading + (angle - heading) * 0.6 + (rand() - 0.5) * 0.9; // a sharp kink
      const w = c.width * (1 - (travelled / c.length) * 0.8); // thinner toward the end
      for (let s = 0; s < segment; s += 0.75) {
        x += Math.cos(angle) * 0.75 + (rand() - 0.5) * 0.4; // tiny jaggedness
        y += Math.sin(angle) * 0.75 + (rand() - 0.5) * 0.4;
        stamp(x, y, w);
      }
      travelled += segment;
      if (rand() < branchChance && w > 0.8) {
        const side = rand() < 0.5 ? -1 : 1;
        stack.push({ x, y, angle: angle + side * (0.5 + rand() * 0.6), length: (c.length - travelled) * (0.3 + rand() * 0.4), width: w * 0.55 });
      }
    }
  }
}

function blur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[y * size + ((k + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = sum / n;
      sum += src[y * size + ((x + radius + 1) % size)] - src[y * size + ((x - radius + size) % size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[((k + size) % size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / n;
      sum += tmp[((y + radius + 1) % size) * size + x] - tmp[((y - radius + size) % size) * size + x];
    }
  }
  return out;
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

async function save(name, size, channels, fill, quality = 90) {
  const data = Buffer.alloc(size * size * channels);
  for (let i = 0; i < size * size; i++) {
    const px = fill(i);
    for (let c = 0; c < channels; c++) data[i * channels + c] = Math.round(clamp01(px[c]) * 255);
  }
  await sharp(data, { raw: { width: size, height: size, channels } }).webp({ quality }).toFile(`${OUT}/${name}.webp`);
  console.log(`  wrote ${OUT}/${name}.webp`);
}

// Normal map from a height map. `strength` = how bumpy it looks.
function normalFromHeight(height, size, strength) {
  return (i) => {
    const x = i % size;
    const y = (i / size) | 0;
    const l = height[y * size + ((x - 1 + size) % size)];
    const r = height[y * size + ((x + 1) % size)];
    const u = height[((y - 1 + size) % size) * size + x];
    const d = height[((y + 1) % size) * size + x];
    let nx = -(r - l) * strength;
    let ny = (d - u) * strength; // image rows go down, texture "up" goes up
    let nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len;
    ny /= len;
    nz /= len;
    return [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5];
  };
}

// ---------- Cracked floor stone (2048 px covers 2 m) ----------
async function floorStone() {
  const S = 2048;
  const rand = random(11);
  console.log('Floor stone...');
  const big = field(S, (u, v) => fbm(u, v, 3, 3, 101));
  const grain = field(S, (u, v) => fbm(u, v, 24, 5, 202));
  const fine = field(S, (u, v) => fbm(u, v, 200, 2, 303));
  const lichen = field(S, (u, v) => fbm(u, v, 9, 5, 404));
  // Faint veins in the stone: thin lines where layered noise crosses the middle.
  const veins = field(S, (u, v) => 1 - smooth(0, 0.035, Math.abs(fbm(u, v, 5, 5, 505) - 0.5)));
  const cracks = new Float32Array(S * S);
  drawCracks(cracks, S, rand, { count: 5, length: 1400, width: 3, branchChance: 0.035 });
  const hairline = new Float32Array(S * S);
  drawCracks(hairline, S, rand, { count: 16, length: 380, width: 0.8, branchChance: 0.03 });
  // Chips, pits and mineral flecks.
  const pits = new Float32Array(S * S);
  const flecks = new Float32Array(S * S);
  const splat = (target, count, rMin, rMax, depth) => {
    for (let p = 0; p < count; p++) {
      const cx = rand() * S;
      const cy = rand() * S;
      const r = rMin + rand() * rand() * (rMax - rMin);
      const h = depth * (0.5 + rand() * 0.5) * (rand() < 0.5 ? -1 : 1);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const i = (((Math.round(cy + dy) % S) + S) % S) * S + (((Math.round(cx + dx) % S) + S) % S);
        const v = (1 - d * d) * h;
        if (Math.abs(v) > Math.abs(target[i])) target[i] = v;
      }
    }
  };
  splat(pits, 1400, 1.5, 12, 0.7);
  splat(flecks, 26000, 0.6, 2.2, 1);
  for (let i = 0; i < S * S; i++) pits[i] = Math.abs(pits[i]);

  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    height[i] = 0.35 * big[i] + 0.35 * grain[i] + 0.12 * fine[i] - 0.6 * cracks[i] - 0.2 * hairline[i] - 0.22 * pits[i] - 0.04 * veins[i];
  }
  const soft = blur(height, S, 6);
  const crevice = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) crevice[i] = clamp01((soft[i] - height[i]) * 7);

  await save('floor_color', S, 3, (i) => {
    let tone = mix(0.3, 0.44, smooth(0.25, 0.75, big[i]));
    tone *= 0.78 + 0.44 * grain[i]; // crisp grain
    tone *= 0.9 + 0.2 * fine[i];
    tone *= 1 + 0.18 * flecks[i]; // light and dark mineral flecks
    tone = mix(tone, tone * 1.18, veins[i] * 0.6);
    let r = tone * 1.03;
    let g = tone * 0.99;
    let b = tone * 0.93;
    const l = smooth(0.62, 0.76, lichen[i]) * 0.35 * (1 - cracks[i]); // a little dull lichen
    r = mix(r, r * 0.78, l);
    g = mix(g, g * 0.86, l);
    b = mix(b, b * 0.66, l);
    const dirt = Math.max(cracks[i], hairline[i] * 0.7, pits[i] * 0.8, crevice[i] * 0.55);
    return [mix(r, 0.05, dirt), mix(g, 0.045, dirt), mix(b, 0.04, dirt)];
  });
  await save('floor_normal', S, 3, normalFromHeight(height, S, 10), 95);
  await save('floor_orm', S, 3, (i) => {
    const ao = 1 - 0.8 * Math.max(cracks[i], crevice[i] * 0.8, pits[i] * 0.6);
    const rough = clamp01(0.72 + 0.16 * grain[i] + 0.2 * cracks[i] - 0.14 * smooth(0.6, 0.85, big[i]));
    return [ao, rough, 0];
  });
}

// Noise stretched along one direction (repeats every `fx` x `fy` cells, so it still tiles).
// Tall and thin: good for grime and rain streaks running down stone.
function streakNoise(u, v, fx, fy, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const x = u * fx;
    const y = v * fy;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const x0 = ((xi % fx) + fx) % fx;
    const y0 = ((yi % fy) + fy) % fy;
    const x1 = (x0 + 1) % fx;
    const y1 = (y0 + 1) % fy;
    const s = seed + o * 31;
    const a = hash(x0, y0, s);
    const b = hash(x1, y0, s);
    const c = hash(x0, y1, s);
    const d = hash(x1, y1, s);
    sum += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// Round dents of random size dropped onto `target` (pits and chips in the stone).
function splat(target, S, rand, count, rMin, rMax, depth) {
  for (let p = 0; p < count; p++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = rMin + rand() * rand() * (rMax - rMin);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d >= 1) continue;
      const i = (((Math.round(cy + dy) % S) + S) % S) * S + (((Math.round(cx + dx) % S) + S) % S);
      target[i] = Math.max(target[i], (1 - d * d) * depth);
    }
  }
}

// ---------- Wall blocks: old gothic masonry (2048 px covers 3 m) ----------
// Rows of different heights, blocks of different lengths, all close in colour (no
// checkerboard): the variety comes from weathering instead. Rounded, chipped edges,
// dark grime streaks running down from every joint, lichen and moss in the mortar.
async function wallStone() {
  const S = 2048;
  const rand = random(23);
  console.log('Wall stone...');
  // Row heights: 5 rows of uneven height that add up to the full texture.
  const weights = Array.from({ length: 5 }, () => 0.75 + rand() * 0.5);
  const total = weights.reduce((a, b) => a + b);
  const rowTop = [0];
  for (const w of weights) rowTop.push(rowTop[rowTop.length - 1] + (w / total) * S);
  rowTop[weights.length] = S;
  const joints = weights.map(() => {
    const n = 2 + Math.floor(rand() * 2);
    const offset = rand();
    return Array.from({ length: n }, (_, k) => ((k + offset + (rand() - 0.5) * 0.35) / n + 1) % 1).sort((a, b) => a - b);
  });
  const blockInfo = new Map();
  const blockOf = (x, y) => {
    let r = 0;
    while (y >= rowTop[r + 1]) r++;
    const top = rowTop[r];
    const h = rowTop[r + 1] - top;
    const u = x / S;
    const js = joints[r];
    let k = js.findIndex((j) => j > u);
    if (k < 0) k = 0;
    const left = js[(k - 1 + js.length) % js.length];
    const right = js[k];
    const dl = ((u - left) % 1 + 1) % 1;
    const dr = ((right - u) % 1 + 1) % 1;
    const id = r * 10 + k;
    if (!blockInfo.has(id)) blockInfo.set(id, { tone: rand(), warm: rand() });
    return { edge: Math.min(dl * S, dr * S, y - top, top + h - y), fromTop: (y - top) / h, ...blockInfo.get(id) };
  };

  const big = field(S, (u, v) => fbm(u, v, 3, 4, 606));
  const grain = field(S, (u, v) => fbm(u, v, 22, 5, 505));
  const fine = field(S, (u, v) => fbm(u, v, 180, 2, 515));
  const chips = field(S, (u, v) => fbm(u, v, 40, 4, 707));
  const lichen = field(S, (u, v) => fbm(u, v, 10, 5, 717));
  const streaks = field(S, (u, v) => streakNoise(u, v, 48, 3, 4, 727));
  const tooling = field(S, (u, v) => 0.5 + 0.5 * Math.sin((u * 1.0 + v * 0.55) * S * 0.11 + fbm(u, v, 14, 2, 808) * 10));
  const cracks = new Float32Array(S * S);
  drawCracks(cracks, S, rand, { count: 7, length: 520, width: 1.8, branchChance: 0.07 });
  const hairline = new Float32Array(S * S);
  drawCracks(hairline, S, rand, { count: 22, length: 160, width: 0.7, branchChance: 0.05 });
  const pits = new Float32Array(S * S);
  splat(pits, S, rand, 900, 1.5, 9, 1);

  const edge = new Float32Array(S * S);
  const tone = new Float32Array(S * S);
  const warm = new Float32Array(S * S);
  const fromTop = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const b = blockOf(x, y);
    const i = y * S + x;
    // Worn, chipped block edges: the joint line wobbles, and corners break away.
    edge[i] = b.edge + (grain[i] - 0.5) * 16 + (chips[i] - 0.5) * 34 - 6;
    tone[i] = b.tone;
    warm[i] = b.warm;
    fromTop[i] = b.fromTop;
  }
  const height = new Float32Array(S * S);
  const face = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    face[i] = smooth(1, 28, edge[i]); // rounded "pillowed" block faces, 0 in the joints
    const f = Math.sqrt(face[i]);
    height[i] = 0.75 * f + 0.22 * grain[i] * f + 0.06 * fine[i] + 0.025 * tooling[i] * f - 0.45 * cracks[i] * f - 0.18 * hairline[i] - 0.25 * pits[i];
  }
  const soft = blur(height, S, 7);

  await save('wall_color', S, 3, (i) => {
    const f = face[i];
    // All blocks are close in colour; big soft blotches matter more than block-to-block changes.
    let t = mix(0.27, 0.33, tone[i]) * (0.72 + 0.56 * big[i]) * (0.8 + 0.4 * grain[i]) * (0.94 + 0.12 * fine[i]);
    // Worn high spots (edges and bumps) are a little paler.
    t *= 1 + 0.25 * clamp01((height[i] - soft[i]) * 6);
    let r = t * (1.0 + 0.04 * warm[i]);
    let g = t * 0.985;
    let b = t * (0.95 - 0.04 * warm[i]);
    // Grime streaks: dark run-off below each joint, fading down the block.
    const run = smooth(0.45, 0.85, streaks[i]) * (1 - smooth(0, 0.9, fromTop[i])) * 0.7 + smooth(0.6, 0.9, streaks[i]) * 0.25;
    r = mix(r, r * 0.45, run);
    g = mix(g, g * 0.45, run);
    b = mix(b, b * 0.42, run);
    // Lichen: grey-green patches, mostly toward the joints.
    const l = smooth(0.58, 0.74, lichen[i]) * (0.35 + 0.65 * (1 - f)) * 0.6;
    r = mix(r, 0.13, l);
    g = mix(g, 0.15, l);
    b = mix(b, 0.1, l);
    // Joints full of dark soil and moss; cracks and pits hold dirt.
    const crevice = clamp01((soft[i] - height[i]) * 6);
    const dirt = Math.max((1 - f) * 0.9, cracks[i] * 0.85, hairline[i] * 0.55, pits[i] * 0.35, crevice * 0.5);
    const moss = smooth(0.5, 0.7, lichen[i]) * (1 - f);
    return [mix(r, mix(0.05, 0.06, moss), dirt), mix(g, mix(0.045, 0.075, moss), dirt), mix(b, mix(0.04, 0.035, moss), dirt)];
  });
  await save('wall_normal', S, 3, normalFromHeight(height, S, 9), 95);
  await save('wall_orm', S, 3, (i) => {
    const crevice = clamp01((soft[i] - height[i]) * 6);
    const ao = 1 - 0.75 * Math.max(1 - face[i], cracks[i], pits[i] * 0.6, crevice * 0.7);
    const rough = clamp01(0.78 + 0.12 * grain[i] + 0.12 * (1 - face[i]) - 0.1 * clamp01((height[i] - soft[i]) * 6));
    return [ao, rough, 0];
  });
}

// ---------- Pillars: fluted, weathered column drums ----------
// The texture wraps once around a column (14 flutes) and covers 2.4 m of its height:
// two stone drums with chipped joints, dark rain streaks running down the grooves,
// worn pale ridges, pits, cracks and lichen.
async function pillarStone() {
  const S = 2048;
  const rand = random(41);
  const FLUTES = 14;
  console.log('Pillar stone...');
  const big = field(S, (u, v) => fbm(u, v, 3, 4, 911));
  const grain = field(S, (u, v) => fbm(u, v, 22, 5, 922));
  const fine = field(S, (u, v) => fbm(u, v, 180, 2, 933));
  const chips = field(S, (u, v) => fbm(u, v, 40, 4, 944));
  const lichen = field(S, (u, v) => fbm(u, v, 9, 5, 955));
  const streaks = field(S, (u, v) => streakNoise(u, v, 56, 3, 4, 966));
  const erosion = field(S, (u, v) => fbm(u, v, 12, 4, 977));
  const cracks = new Float32Array(S * S);
  drawCracks(cracks, S, rand, { count: 5, length: 600, width: 1.8, branchChance: 0.06 });
  const hairline = new Float32Array(S * S);
  drawCracks(hairline, S, rand, { count: 18, length: 170, width: 0.7, branchChance: 0.05 });
  const pits = new Float32Array(S * S);
  splat(pits, S, rand, 800, 1.5, 9, 1);

  const height = new Float32Array(S * S);
  const joint = new Float32Array(S * S);
  const groove = new Float32Array(S * S);
  const fromTop = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    // Flute profile: a rounded groove, with a narrow flat ridge (fillet) between grooves.
    // The ridges are worn away in places.
    const f = ((x / S) * FLUTES) % 1;
    const c = (f - 0.5) / 0.4;
    const depth = Math.abs(c) < 1 ? Math.sqrt(1 - c * c) : 0;
    groove[i] = depth;
    const ridgeWear = smooth(0.5, 0.8, erosion[i]) * (1 - depth) * 0.6;
    // Two drums per texture: joints at the top and the middle, ragged and chipped.
    const yy = y % (S / 2);
    const jd = Math.min(yy, S / 2 - yy) + (chips[i] - 0.5) * 40 + (grain[i] - 0.5) * 14;
    joint[i] = 1 - smooth(2, 30, jd);
    fromTop[i] = yy / (S / 2);
    height[i] = -2.4 * depth * (1 - joint[i] * 0.5) - 0.8 * ridgeWear + 0.25 * grain[i] + 0.06 * fine[i] - 2 * joint[i]
      - 0.45 * cracks[i] - 0.18 * hairline[i] - 0.3 * pits[i] - 0.2 * smooth(0.55, 0.85, erosion[i]);
  }
  const soft = blur(height, S, 7);

  await save('pillar_color', S, 3, (i) => {
    let t = 0.3 * (0.74 + 0.52 * big[i]) * (0.8 + 0.4 * grain[i]) * (0.94 + 0.12 * fine[i]);
    t *= 1 + 0.35 * clamp01((height[i] - soft[i]) * 4); // ridges and edges rubbed paler
    let r = t * 1.01;
    let g = t * 0.985;
    let b = t * 0.95;
    // Rain runs down the grooves and leaves long dark streaks below each drum joint.
    const run = smooth(0.42, 0.82, streaks[i]) * (0.45 + 0.55 * groove[i]) * (1 - 0.6 * fromTop[i]);
    r = mix(r, r * 0.4, run * 0.85);
    g = mix(g, g * 0.4, run * 0.85);
    b = mix(b, b * 0.38, run * 0.85);
    const l = smooth(0.6, 0.76, lichen[i]) * 0.55;
    r = mix(r, 0.12, l);
    g = mix(g, 0.14, l);
    b = mix(b, 0.095, l);
    const crevice = clamp01((soft[i] - height[i]) * 3);
    const dirt = Math.max(joint[i] * 0.9, cracks[i] * 0.85, hairline[i] * 0.55, pits[i] * 0.35, crevice * 0.45);
    return [mix(r, 0.05, dirt), mix(g, 0.05, dirt), mix(b, 0.04, dirt)];
  });
  await save('pillar_normal', S, 3, normalFromHeight(height, S, 3), 95);
  await save('pillar_orm', S, 3, (i) => {
    const crevice = clamp01((soft[i] - height[i]) * 3);
    const ao = 1 - 0.75 * Math.max(joint[i], cracks[i], pits[i] * 0.6, crevice * 0.6, groove[i] * 0.25);
    return [ao, clamp01(0.8 + 0.12 * grain[i] - 0.12 * clamp01((height[i] - soft[i]) * 4)), 0];
  });
}

// ---------- Dirt and gravel between the slabs (1024 px covers 1 m) ----------
async function dirt() {
  const S = 1024;
  const rand = random(37);
  console.log('Dirt...');
  const soil = field(S, (u, v) => fbm(u, v, 8, 5, 707));
  const pebbles = new Float32Array(S * S);
  for (let p = 0; p < 1400; p++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 2 + rand() * rand() * 12;
    const h = 0.5 + rand() * 0.5;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d >= 1) continue;
      const i = (((Math.round(cy + dy) % S) + S) % S) * S + (((Math.round(cx + dx) % S) + S) % S);
      pebbles[i] = Math.max(pebbles[i], Math.sqrt(1 - d * d) * h);
    }
  }
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) height[i] = 0.4 * soil[i] + 0.6 * pebbles[i];
  await save('dirt_color', S, 3, (i) => {
    const s = 0.07 + 0.07 * soil[i];
    const t = pebbles[i] > 0.05 ? 0.1 + 0.14 * pebbles[i] * (0.6 + 0.8 * hash(i % 97, (i / 97) | 0, 9)) : s;
    return [t * 1.06, t, t * 0.9];
  });
  await save('dirt_normal', S, 3, normalFromHeight(height, S, 6), 95);
  await save('dirt_orm', S, 3, (i) => [1 - 0.5 * (pebbles[i] > 0 ? 0 : 1 - soil[i]) * 0.6, 0.95, 0]);
}

const only = process.argv[2]; // e.g. `node tools/make_textures.mjs pillar` makes just that set
if (!only || only === 'floor') await floorStone();
if (!only || only === 'wall') await wallStone();
if (!only || only === 'pillar') await pillarStone();
if (!only || only === 'dirt') await dirt();
console.log('Done.');
