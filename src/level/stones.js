// Broken stones lying around the ruins: chunks of dressed masonry, a column drum, a wedge,
// a paving slab, a boulder and a heap of rocks. Deep cracks split each one into irregular
// pieces, the edges are chipped away, and moss grows in the cracks.
//
// Each shape is described by "how far outside the shape is this point" (a distance function).
// A finely divided box is shrink-wrapped onto that shape, then the cracks and chips are
// carved into it. All of it is built once, when the level loads: no model files.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEXTURE_METERS } from './materials.js';

const STEP = 0.02; // mesh spacing in meters: fine enough to cut 2 cm cracks
const ROUND = 0.03; // how rounded the edges are before they get chipped

// ---------- Noise ----------
function hash(x, y, z, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  const h = (i, j, k) => hash(xi + i, yi + j, zi + k, seed);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}

function fbm(p, frequency, seed) {
  let sum = 0;
  let amp = 0.5;
  for (let o = 0; o < 3; o++) {
    sum += amp * noise(p.x * frequency, p.y * frequency, p.z * frequency, seed + o * 31);
    amp *= 0.5;
    frequency *= 2;
  }
  return sum / 0.875;
}

// Splits space into irregular cells (the pieces a stone has cracked into). Returns how far
// the point is from the nearest crack between two cells (in meters) and which cell it's in.
const cellResult = { edge: 0, id: 0 };
function cells(p, size, seed) {
  const x = p.x / size;
  const y = p.y / size;
  const z = p.z / size;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  let d1 = Infinity;
  let d2 = Infinity;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  let id = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const gx = cx + i;
    const gy = cy + j;
    const gz = cz + k;
    const px = gx + hash(gx, gy, gz, seed);
    const py = gy + hash(gx, gy, gz, seed + 1);
    const pz = gz + hash(gx, gy, gz, seed + 2);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d < d1) {
      d2 = d1;
      b[0] = a[0], b[1] = a[1], b[2] = a[2];
      d1 = d;
      a[0] = px, a[1] = py, a[2] = pz;
      id = hash(gx, gy, gz, seed + 3);
    } else if (d < d2) {
      d2 = d;
      b[0] = px, b[1] = py, b[2] = pz;
    }
  }
  // Distance to the plane halfway between the two nearest cell centers.
  const nx = b[0] - a[0];
  const ny = b[1] - a[1];
  const nz = b[2] - a[2];
  const len = Math.hypot(nx, ny, nz);
  const mx = x - (a[0] + b[0]) / 2;
  const my = y - (a[1] + b[1]) / 2;
  const mz = z - (a[2] + b[2]) / 2;
  cellResult.edge = (-(mx * nx + my * ny + mz * nz) / len) * size;
  cellResult.id = id;
  return cellResult;
}

// ---------- Shapes ----------
// A shape gives the distances to each of its sides (`terms`: negative inside). The shape is
// where all of them are negative, with the corners rounded off. Where two sides are both
// close, the point is on an edge: that's where stone chips away.
const smoothMax = (ds) => {
  let m = -Infinity;
  for (const d of ds) m = Math.max(m, d);
  let sum = 0;
  for (const d of ds) sum += Math.exp((d - m) / ROUND);
  return m + ROUND * Math.log(sum);
};

const plane = (nx, ny, nz, through) => {
  const n = new THREE.Vector3(nx, ny, nz).normalize();
  const o = n.dot(through);
  return (p) => n.dot(p) - o;
};

const boxSides = (hx, hy, hz) => [
  (p) => p.x - hx, (p) => -p.x - hx,
  (p) => p.y - hy, (p) => -p.y - hy,
  (p) => p.z - hz, (p) => -p.z - hz,
];

// A groove `depth` deep and `width` wide, where `distance(p)` is 0.
const groove = (distance, width, depth) => (p) => depth * Math.max(0, 1 - Math.abs(distance(p)) / width);

const SHAPES = {
  // A big squared block, laid in two courses (a seam runs round it a third of the way up).
  block: {
    bounds: [1, 0.85, 0.8],
    sides: boxSides(0.5, 0.425, 0.4),
    crackSize: 0.3,
    grooves: [groove((p) => p.y + 0.14, 0.03, 0.035)],
  },
  // A long block with a corner broken off.
  halfBlock: {
    bounds: [0.95, 0.5, 0.5],
    sides: [...boxSides(0.475, 0.25, 0.25), plane(0.8, 0.45, 0.4, new THREE.Vector3(0.3, 0.12, 0.1))],
    crackSize: 0.24,
    grooves: [],
  },
  // A column drum with two rings cut round its top, its base broken and ragged.
  drum: {
    bounds: [0.78, 0.62, 0.78],
    sides: [(p) => Math.hypot(p.x, p.z) - 0.38, (p) => p.y - 0.31, (p) => -p.y - 0.31],
    crackSize: 0.28,
    grooves: [groove((p) => p.y - 0.13, 0.025, 0.03), groove((p) => p.y - 0.2, 0.025, 0.03)],
    raggedBottom: true,
  },
  // A lopsided wedge of rock, like the broken-off top of something bigger.
  wedge: {
    bounds: [1.0, 0.86, 1.05],
    center: new THREE.Vector3(0.02, -0.16, 0.02),
    sides: (() => {
      const apex = new THREE.Vector3(0.1, 0.5, -0.05);
      return [
        (p) => -p.y - 0.36,
        plane(1, 0.78, 0, apex), plane(-1, 0.62, 0, apex),
        plane(0, 0.7, 1, apex), plane(0, 0.85, -1, apex),
        plane(-0.3, 1, 0.5, new THREE.Vector3(0.1, 0.38, -0.05)), // the point broken off
      ];
    })(),
    crackSize: 0.27,
    grooves: [],
  },
  // A thick paving slab, scored into four flags.
  slab: {
    bounds: [1.05, 0.24, 0.85],
    sides: boxSides(0.525, 0.12, 0.425),
    crackSize: 0.36,
    grooves: [groove((p) => p.x - 0.02, 0.03, 0.04), groove((p) => p.z + 0.03, 0.03, 0.04)],
  },
  // A rounded boulder.
  boulder: {
    bounds: [0.95, 0.78, 0.86],
    sides: [(p) => {
      const k = Math.hypot(p.x / 0.46, p.y / 0.38, p.z / 0.42);
      return (k - 1) * 0.38 + (fbm(p, 2.4, 71) - 0.5) * 0.16;
    }],
    crackSize: 0.28,
    grooves: [],
  },
  // A wall block, thinner, with its lower corner gone.
  wallBlock: {
    bounds: [1.0, 0.7, 0.42],
    sides: [...boxSides(0.5, 0.35, 0.21), plane(0.7, -0.6, 0.2, new THREE.Vector3(0.32, -0.2, 0))],
    crackSize: 0.26,
    grooves: [],
  },
};

// The small rough chunks a heap is made of.
const chunk = (hx, hy, hz, seed) => ({
  bounds: [hx * 2, hy * 2, hz * 2],
  sides: [...boxSides(hx, hy, hz), (p) => (fbm(p, 2.5, seed) - 0.5) * 0.08 + Math.hypot(p.x / hx, p.y / hy, p.z / hz) * 0.1 - 0.12],
  crackSize: 0.22,
  grooves: [],
});

// ---------- Building one stone ----------
const MOSS = [0.42, 0.55, 0.2];

function buildStone(shape, seed, step = STEP) {
  const [w, h, d] = shape.bounds;
  const seg = (v) => Math.max(4, Math.ceil(v / step));
  let geometry = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  const pos = geometry.attributes.position;
  const center = shape.center ?? new THREE.Vector3();
  const sides = Array.isArray(shape.sides) ? shape.sides : [shape.sides];
  const terms = (p) => sides.map((side) => side(p));
  const sdf = (p) => smoothMax(terms(p));

  // 1. Shrink-wrap: slide each vertex along the line from the center until it sits on the surface.
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).sub(center);
    let lo = 0;
    let hi = 2.5;
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2;
      if (sdf(p.copy(center).addScaledVector(dir, mid)) < 0) lo = mid;
      else hi = mid;
    }
    p.copy(center).addScaledVector(dir, lo);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();

  // 2. Carve: cracks between the pieces, chipped edges, grooves; each piece sits a touch proud.
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(normal, i);
    const c = cells(p, shape.crackSize * 1.35, seed);
    const pieceId = c.id;
    const width = 0.012 + 0.02 * fbm(p, 3, seed + 5); // cracks open and close along their length
    const crack = Math.max(0, 1 - c.edge / width) ** 0.7; // steep-sided, so the pieces stay flat-faced
    const ds = terms(p).sort((a, b) => b - a);
    let edge = ds.length > 1 ? THREE.MathUtils.smoothstep(ds[1], -0.09, 0) : 0;
    if (shape.raggedBottom) edge = Math.max(edge, THREE.MathUtils.smoothstep(-p.y, 0.12, 0.3) * 0.8);
    const chip = edge * Math.max(0, fbm(p, 7, seed + 9) - 0.42) * 0.28;
    const grooveDepth = shape.grooves.reduce((sum, g) => Math.max(sum, g(p)), 0) * (1 - Math.abs(n.y) * 0.8);
    const lift = pieceId * 0.006 + (fbm(p, 14, seed + 13) - 0.5) * 0.006;
    p.addScaledVector(n, lift - crack * 0.035 - chip - grooveDepth);
    pos.setXYZ(i, p.x, p.y, p.z);

    // Colour: each piece a slightly different tone, dark in the cracks, fresh chips paler,
    // moss growing in the cracks and on the tops.
    const dark = Math.max(crack, grooveDepth / 0.035);
    let tone = (1.0 + 0.3 * pieceId) * (1 - 0.72 * Math.min(1, dark)) * (1 + Math.min(1, chip * 25) * 0.18);
    tone *= 0.85 + 0.15 * THREE.MathUtils.smoothstep(n.y, -1, 0.3); // underneath, in its own shade
    const mossy = Math.max(Math.min(1, dark) * 0.9, THREE.MathUtils.smoothstep(n.y, 0.5, 0.9) * 0.5) *
      THREE.MathUtils.smoothstep(fbm(p, 4, seed + 17), 0.48, 0.66);
    colors[i * 3] = THREE.MathUtils.lerp(tone, MOSS[0] * 0.7, mossy);
    colors[i * 3 + 1] = THREE.MathUtils.lerp(tone, MOSS[1] * 0.7, mossy);
    colors[i * 3 + 2] = THREE.MathUtils.lerp(tone, MOSS[2] * 0.7, mossy);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return boxProjectUVs(geometry.toNonIndexed());
}

// Texture coordinates: each triangle takes the texture from whichever side it faces most
// (the hammered texture hides the seams where that changes).
function boxProjectUVs(geometry) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const m = TEXTURE_METERS.rock;
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    const ax = Math.abs(face.x);
    const ay = Math.abs(face.y);
    const az = Math.abs(face.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u, w] = ax >= ay && ax >= az ? [v.z + 0.31, v.y] : ay >= az ? [v.x, v.z + 0.57] : [v.x + 0.13, v.y + 0.71];
      uv[(t + k) * 2] = u / m;
      uv[(t + k) * 2 + 1] = w / m;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// Stand a stone on the ground: its base at y = 0, centered over the origin.
function grounded(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  return { geometry, radius: Math.max(size.x, size.z) / 2 };
}

// A heap: two chunks side by side with a third resting on top.
function buildHeap(seed, step) {
  const parts = [
    [chunk(0.3, 0.24, 0.28, seed), -0.24, 0.22, 0.04],
    [chunk(0.28, 0.22, 0.27, seed + 1), 0.26, 0.2, -0.02],
    [chunk(0.22, 0.2, 0.21, seed + 2), 0.0, 0.52, 0.02],
  ].map(([shape, x, y, z], i) => buildStone(shape, seed + i * 7, step).rotateY(i * 1.3).translate(x, y, z));
  return mergeGeometries(parts);
}

// All the kinds of stone, built once for each mesh spacing: [{ geometry, radius }].
// Stones only ever seen small (a bonfire's ring) can use a much coarser `step`.
const built = new Map();
export function stoneKinds(step = STEP) {
  if (!built.has(step)) {
    const kinds = Object.values(SHAPES).map((shape, i) => grounded(buildStone(shape, 300 + i * 11, step)));
    kinds.push(grounded(buildHeap(500, step)));
    built.set(step, kinds);
  }
  return built.get(step);
}
