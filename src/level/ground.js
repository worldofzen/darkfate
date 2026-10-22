// The broken stone floor: hundreds of separate slabs instead of one flat plane.
//
//   - Rectangular paving in the courtyard, corridor and bridge; concentric rings on the arena
//     platform, with a center medallion, a band of rough uneven stones and darker inlaid rings.
//   - Every slab sits at a slightly different height and tilt, with a bevelled top edge.
//   - Some slabs are cracked into sunken, tilted shards, and a few are missing,
//     so the dirt and gravel underneath shows through.
// All slabs are merged into ONE mesh, so the whole floor is drawn in a single go.
import * as THREE from 'three';
import { floorStone, TEXTURE_METERS } from './materials.js';

const GAP = 0.022; // gap between neighbouring slabs (m)
const BEVEL = 0.018; // width of the rounded-off top edge
const BEVEL_DROP = 0.012;
const BOTTOM = -0.12; // slab sides go down this far (hidden in the dirt)
const BROKEN = 0.14; // chance a slab is cracked into shards
const MISSING = 0.035; // chance a slab is gone

// --- Small polygon helpers (polygons are arrays of [x, z] corners) ---
function centroid(poly) {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

// Pull every corner `amount` meters toward the middle.
function shrink(poly, amount) {
  const c = centroid(poly);
  return poly.map(([x, z]) => {
    const dx = x - c[0];
    const dz = z - c[1];
    const d = Math.hypot(dx, dz);
    const k = d > amount ? (d - amount) / d : 0.01;
    return [c[0] + dx * k, c[1] + dz * k];
  });
}

// Cut a polygon in two along the line through `point` in direction `dir`.
function split(poly, point, dir) {
  const side = ([x, z]) => (x - point[0]) * dir[1] - (z - point[1]) * dir[0];
  const a = [];
  const b = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    (sp >= 0 ? a : b).push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      const cut = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      a.push(cut);
      b.push(cut);
    }
  }
  return [a, b].filter((piece) => piece.length >= 3);
}

function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
}

// --- Slab layouts ---
// Rows of rectangles, each row shifted like brickwork.
function pavingSlabs(minX, maxX, minZ, maxZ, rand) {
  const slabs = [];
  for (let z = minZ; z < maxZ; ) {
    const depth = 0.9 + rand() * 0.5;
    let x = minX - rand() * 1.2;
    while (x < maxX) {
      const width = 0.8 + rand() * 1.0;
      slabs.push({ poly: [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]], tint: 1 });
      x += width;
    }
    z += depth;
  }
  return slabs;
}

// One ring of curved slabs between radii r0 and r1, about `length` meters long each.
function ring(cx, cz, r0, r1, length, rand, tint) {
  const slabs = [];
  const count = Math.max(6, Math.round((Math.PI * (r0 + r1)) / length));
  const turn = rand() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a0 = turn + (i / count) * Math.PI * 2;
    const a1 = turn + ((i + 1) / count) * Math.PI * 2;
    const poly = [];
    for (let k = 0; k <= 2; k++) {
      const a = a0 + ((a1 - a0) * k) / 2;
      poly.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]);
    }
    for (let k = 2; k >= 0; k--) {
      const a = a0 + ((a1 - a0) * k) / 2;
      poly.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]);
    }
    slabs.push({ poly, tint: typeof tint === 'function' ? tint(i) : tint });
  }
  return slabs;
}

// The arena platform: a center medallion, then rings outward, with a band of rough stones
// and a couple of darker inlaid rings (like the arena in Elden Ring's colosseums).
function arenaSlabs(cx, cz, radius, rand) {
  const slabs = [];
  const disc = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    disc.push([cx + Math.cos(a) * 1.0, cz + Math.sin(a) * 1.0]);
  }
  slabs.push({ poly: disc, tint: 0.75 });
  slabs.push(...ring(cx, cz, 1.0, 2.3, 1.6, rand, 1.08)); // medallion petals
  slabs.push(...ring(cx, cz, 2.3, 2.9, 0.8, rand, 0.62)); // dark inlay
  for (let r = 2.9; r < 9.4; r += 1.3) slabs.push(...ring(cx, cz, r, r + 1.3, 1.7, rand, 1));
  // A band of rough, uneven stones: smaller and each a different weathered shade.
  slabs.push(...ring(cx, cz, 9.4, 10.15, 0.95, rand, () => 0.72 + rand() * 0.3));
  slabs.push(...ring(cx, cz, 10.15, 10.9, 1.15, rand, () => 0.72 + rand() * 0.3));
  for (let r = 10.9; r < 15.9; r += 1.25) slabs.push(...ring(cx, cz, r, r + 1.25, 1.7, rand, 1));
  slabs.push(...ring(cx, cz, 15.9, 16.5, 0.9, rand, 0.62)); // dark inlay
  for (let r = 16.5; r < radius - 0.01; r += 1.25) slabs.push(...ring(cx, cz, r, Math.min(radius, r + 1.25), 1.8, rand, 0.95));
  return slabs;
}

// --- Turning slab outlines into 3D stone ---
function createBuilder() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  let shade = 1;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const n = new THREE.Vector3();

  function triangle(a, b, c, uvA, uvB, uvC, wantUp) {
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    n.crossVectors(tmpA, tmpB).normalize();
    // Make sure the face points the right way (up for tops, outward for sides).
    if (n.dot(wantUp) < 0) {
      [b, c] = [c, b];
      [uvB, uvC] = [uvC, uvB];
      n.negate();
    }
    for (const [p, t] of [[a, uvA], [b, uvB], [c, uvC]]) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(t[0], t[1]);
      colors.push(shade, shade * 0.99, shade * 0.97);
    }
  }

  // One slab: a flat (slightly tilted) top, a bevelled rim and four-ish sides.
  // `tint` darkens or lightens this stone (for the darker inlaid rings and the rough band).
  function slab(poly, height, tilt, rand, tint = 1) {
    shade = tint * (0.92 + rand() * 0.16); // every stone a slightly different shade
    const c = centroid(poly);
    const y = ([x, z], drop = 0) => height + tilt[0] * (x - c[0]) + tilt[1] * (z - c[1]) - drop;
    const v3 = (p, drop) => new THREE.Vector3(p[0], y(p, drop), p[1]);
    // Each slab shows a different random patch of the stone texture, at a random angle.
    const angle = rand() * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offU = rand() * 10;
    const offV = rand() * 10;
    const topUV = ([x, z]) => [(x * cos - z * sin) / TEXTURE_METERS.floor + offU, (x * sin + z * cos) / TEXTURE_METERS.floor + offV];
    const up = new THREE.Vector3(0, 1, 0);

    const outer = poly;
    const inner = shrink(poly, BEVEL);
    const middle = v3(c, 0);
    for (let i = 0; i < inner.length; i++) {
      const p = inner[i];
      const q = inner[(i + 1) % inner.length];
      triangle(middle, v3(p, 0), v3(q, 0), topUV(c), topUV(p), topUV(q), up);
    }
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      const ip = v3(inner[i], 0);
      const iq = v3(inner[j], 0);
      const op = v3(outer[i], BEVEL_DROP);
      const oq = v3(outer[j], BEVEL_DROP);
      // Which way is "outward" for this edge.
      const out = new THREE.Vector3((outer[i][0] + outer[j][0]) / 2 - c[0], 0, (outer[i][1] + outer[j][1]) / 2 - c[1]).normalize();
      const bevelDir = out.clone().add(up).normalize();
      triangle(ip, iq, oq, topUV(inner[i]), topUV(inner[j]), topUV(outer[j]), bevelDir);
      triangle(ip, oq, op, topUV(inner[i]), topUV(outer[j]), topUV(outer[i]), bevelDir);
      // Side wall down into the dirt.
      const len = Math.hypot(outer[j][0] - outer[i][0], outer[j][1] - outer[i][1]) / TEXTURE_METERS.floor;
      const bp = new THREE.Vector3(outer[i][0], BOTTOM, outer[i][1]);
      const bq = new THREE.Vector3(outer[j][0], BOTTOM, outer[j][1]);
      const sideUV = (u, yy) => [offU + u, offV + yy / TEXTURE_METERS.floor];
      triangle(op, oq, bq, sideUV(0, op.y), sideUV(len, oq.y), sideUV(len, BOTTOM), out);
      triangle(op, bq, bp, sideUV(0, op.y), sideUV(len, BOTTOM), sideUV(0, BOTTOM), out);
    }
  }

  function toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeBoundingSphere();
    return g;
  }

  return { slab, toGeometry };
}

// `isFloor(x, z)` says where paving belongs; `arena` is { x, z, radius } for the ring pattern.
export function buildGround(level, rand, { isFloor, bounds, arena }) {
  const builder = createBuilder();
  const inArena = (x, z) => Math.hypot(x - arena.x, z - arena.z) < arena.radius;
  const outlines = [
    ...pavingSlabs(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, rand).filter(({ poly }) => {
      const [x, z] = centroid(poly);
      return isFloor(x, z) && !inArena(x, z);
    }),
    ...arenaSlabs(arena.x, arena.z, arena.radius, rand),
  ];

  let count = 0;
  for (const { poly: outline, tint } of outlines) {
    if (rand() < MISSING) continue; // a gap where a slab used to be
    const base = shrink(outline, GAP / 2);
    const height = (rand() - 0.5) * 0.014;
    const tilt = [(rand() - 0.5) * 0.02, (rand() - 0.5) * 0.02];
    if (rand() < BROKEN && area(base) > 0.4) {
      // Cracked: cut into 2–3 shards that have each sunk and tipped a little.
      const c = centroid(base);
      const a = rand() * Math.PI;
      let shards = split(base, [c[0] + (rand() - 0.5) * 0.3, c[1] + (rand() - 0.5) * 0.3], [Math.cos(a), Math.sin(a)]);
      if (rand() < 0.5 && shards.length === 2) {
        const b = a + Math.PI / 2 + (rand() - 0.5);
        const sc = centroid(shards[0]);
        shards = [...split(shards[0], sc, [Math.cos(b), Math.sin(b)]), shards[1]];
      }
      for (const shard of shards) {
        builder.slab(shrink(shard, 0.012), height - 0.008 - rand() * 0.03, [(rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08], rand, tint);
        count++;
      }
    } else {
      builder.slab(base, height, tilt, rand, tint);
      count++;
    }
  }

  const mesh = new THREE.Mesh(builder.toGeometry(), floorStone);
  mesh.receiveShadow = true;
  level.add(mesh);
  return { slabs: count };
}
