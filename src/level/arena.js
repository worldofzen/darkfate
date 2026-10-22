// The boss arena, modelled on the ruined colosseums of Elden Ring:
//
//   - a round stone platform (the paving itself is made in ground.js) with a low stone rim,
//     standing on a great drum of stone that drops into a chasm
//   - a stone bridge with balustrades from the fog gate across the chasm
//   - a two-tier ring of arches around the chasm, broken at the top, with a gallery behind
//   - stepped stands on the left and right, jagged rock spikes round the platform edge,
//     fire bowls on pedestals, hanging banners, statues, grass and vines
//
// Big repeated pieces (arches, stands, balusters, grass) are merged or "instanced",
// so the whole arena is only a few dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ARENA, BRIDGE, GATE_Z } from './layout.js';
import { wallStone, pillarStone, rockStone, dirtMeters, TEXTURE_METERS, worldScaleCylinderUVs, fluteUVs } from './materials.js';
import { stoneBox } from './ruins.js';
import { createBrazier } from './brazier.js';
import { addBox, addCircle, cameraBlockers, setWalkArea } from './colliders.js';

const CZ = ARENA.z;
const BAYS = 26; // arches around the ring
const BAY_ANGLE = (Math.PI * 2) / BAYS;
const LOWER_TOP = 7.2; // top of the lower arches
const CORNICE = 0.7; // the ledge between the tiers
const UPPER_TOP = 13;
const deg = THREE.MathUtils.degToRad;

// Is angle `a` (0 = toward the gate) inside one of the stand sectors?
const STAND_SECTORS = [[deg(100), deg(160)], [deg(200), deg(260)]];
const inStands = (a) => STAND_SECTORS.some(([s, e]) => a >= s && a <= e);

// A point at `angle` around the arena, `radius` from its center.
const around = (angle, radius, y = 0) => new THREE.Vector3(Math.sin(angle) * radius, y, CZ + Math.cos(angle) * radius);

// --- Geometry helpers ---

// A wall `width` wide and `height` tall with a round-topped opening cut through it.
// The opening starts `openingBottom` above the wall's base. `topEdge` (optional) is a list of
// heights across the top, for a broken, ruined top edge. Returns geometry centered on its depth.
function archWall(width, height, depth, { opening, openingBottom, springAt, topEdge }) {
  const w = width / 2;
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  if (topEdge) {
    topEdge.forEach((h, i) => s.lineTo(w - (i / (topEdge.length - 1)) * width, h));
  } else {
    s.lineTo(w, height);
    s.lineTo(-w, height);
  }
  s.closePath();
  if (opening) {
    const o = opening / 2;
    const hole = new THREE.Path();
    hole.moveTo(-o, openingBottom);
    hole.lineTo(o, openingBottom);
    hole.lineTo(o, openingBottom + springAt);
    hole.absarc(0, openingBottom + springAt, o, 0, Math.PI, false);
    hole.lineTo(-o, openingBottom);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  // Extruded shapes measure texture coordinates in meters; our textures cover 2 m.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / TEXTURE_METERS.wall, uv.getY(i) / TEXTURE_METERS.wall);
  return g;
}

// The raised stone band framing an arch (a U-shape following the opening), `band` meters wide.
function archTrim(opening, springAt, band, depth) {
  const o = opening / 2;
  const r = o + band;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(-r, springAt);
  s.absarc(0, springAt, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(o, 0);
  s.lineTo(o, springAt);
  s.absarc(0, springAt, o, 0, Math.PI, false);
  s.lineTo(-o, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / TEXTURE_METERS.wall, uv.getY(i) / TEXTURE_METERS.wall);
  return g;
}

// Place a geometry at `angle` around the arena, `radius` out, at height `y`,
// with its local +Z pointing outward and +X running along the ring.
function onRing(geometry, angle, radius, y) {
  const m = new THREE.Matrix4().makeRotationY(angle).setPosition(around(angle, radius, y));
  return geometry.applyMatrix4(m);
}

function addMerged(level, parts, material, { shadows = true, blocksCamera = false } = {}) {
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), material);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  level.add(mesh);
  if (blocksCamera) cameraBlockers.push(mesh);
  return mesh;
}

// A flat piece of dirt from a 2D outline (texture measured in meters).
function dirtFlat(shape, y) {
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), dirtMeters);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

const circleShape = (x, z, r) => new THREE.Shape().absarc(x, -z, r, 0, Math.PI * 2, false);

// --- The parts of the arena ---

function buildGroundAndChasm(level) {
  // Dirt everywhere outside the colosseum, with a round hole for the chasm.
  const outside = new THREE.Shape();
  outside.moveTo(-220, -220);
  outside.lineTo(220, -220);
  outside.lineTo(220, 220);
  outside.lineTo(-220, 220);
  outside.closePath();
  outside.holes.push(new THREE.Path().absarc(0, -CZ, ARENA.chasm, 0, Math.PI * 2, true));
  level.add(dirtFlat(outside, -0.04));
  // Dirt under the platform paving, and the chasm floor far below.
  level.add(dirtFlat(circleShape(0, CZ, ARENA.platform + 0.2), -0.04));
  level.add(dirtFlat(circleShape(0, CZ, ARENA.chasm + 1), -ARENA.chasmDepth));

  // The great stone drum the platform stands on.
  const drum = new THREE.Mesh(
    worldScaleCylinderUVs(new THREE.CylinderGeometry(ARENA.platform + 0.3, ARENA.platform + 1.2, ARENA.chasmDepth, 96, 1, true), ARENA.platform + 0.6, ARENA.chasmDepth),
    wallStone
  );
  drum.position.set(0, -ARENA.chasmDepth / 2 - 0.05, CZ);
  drum.receiveShadow = true;
  level.add(drum);
}

function buildPlatformRim(level, rand) {
  const parts = [];
  const r = ARENA.platform + 0.05;
  const count = 64;
  for (let i = 0; i < count; i++) {
    const a = ((i + 0.5) / count) * Math.PI * 2;
    if (Math.min(a, Math.PI * 2 - a) < deg(8)) continue; // the bridge comes in here
    if (rand() < 0.12) continue; // broken away
    const length = (2 * Math.PI * r) / count - 0.06;
    const h = 0.3 + rand() * 0.15;
    parts.push(onRing(stoneBox(length, h, 0.7), a, r + 0.3, h / 2 - 0.02));
  }
  addMerged(level, parts, wallStone);
}

// A little turned stone column for balustrades.
function balusterGeometry() {
  return new THREE.LatheGeometry(
    [[0.07, 0], [0.09, 0.05], [0.05, 0.15], [0.09, 0.35], [0.1, 0.45], [0.06, 0.6], [0.08, 0.66], [0, 0.66]].map(([x, y]) => new THREE.Vector2(x, y)),
    8
  );
}

function buildBridge(level, rand) {
  const halfW = BRIDGE.halfWidth;
  const start = GATE_Z + 0.2;
  const end = CZ + ARENA.platform - 0.3;
  const length = start - end;
  const mid = (start + end) / 2;

  // The deck and the great arch holding it up, rising from the chasm floor.
  const deck = new THREE.Mesh(stoneBox(halfW * 2 + 0.4, 0.8, length), wallStone);
  deck.position.set(0, -0.45, mid);
  deck.receiveShadow = true;
  level.add(deck);
  const support = archWall(length, ARENA.chasmDepth - 0.85, halfW * 2, { opening: length - 2.4, openingBottom: 0.02, springAt: 6 });
  support.rotateY(Math.PI / 2);
  support.translate(0, -ARENA.chasmDepth, mid);
  addMerged(level, [support], wallStone);

  // Balustrades: a plinth, little turned columns and a top rail on each side.
  const baluster = balusterGeometry();
  const spots = [];
  const railParts = [];
  for (const side of [-1, 1]) {
    const x = side * (halfW + 0.05);
    railParts.push(stoneBox(0.36, 0.22, length).translate(x, 0.11, mid));
    railParts.push(stoneBox(0.3, 0.14, length).translate(x, 0.95, mid));
    for (let z = end + 0.2; z < start - 0.1; z += 0.34) spots.push([x, 0.22, z]);
    addBox(x, mid, 0.18, length / 2);
  }
  addMerged(level, railParts, wallStone);
  const balusters = new THREE.InstancedMesh(baluster, wallStone, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z], i) => balusters.setMatrixAt(i, m.makeTranslation(x, y, z)));
  balusters.castShadow = balusters.receiveShadow = true;
  level.add(balusters);
  return { start, end };
}

function buildColosseum(level, rand) {
  const lower = [];
  const upper = [];
  const gallery = [];
  const details = []; // arch trims and capitals
  const columns = []; // fluted half-columns on the piers
  const balusterSpots = [];
  const depth = 1.5;
  const inner = ARENA.chasm;
  const bayWidth = 2 * (inner + depth) * Math.tan(BAY_ANGLE / 2) + 0.05;
  const upperBays = [];

  for (let i = 0; i < BAYS; i++) {
    const a = i * BAY_ANGLE;
    const gateBay = i === 0;
    const nearGate = Math.min(a, Math.PI * 2 - a) < deg(13);

    // Lower tier: from the chasm floor up, with an arch at platform level.
    if (gateBay) {
      // Under the gate: solid wall down into the chasm.
      lower.push(onRing(archWall(bayWidth, ARENA.chasmDepth - 0.05, depth, {}), a, inner + depth / 2, -ARENA.chasmDepth));
    } else {
      lower.push(onRing(archWall(bayWidth, ARENA.chasmDepth + LOWER_TOP, depth, { opening: 4.2, openingBottom: ARENA.chasmDepth, springAt: 3.4 }), a, inner + depth / 2, -ARENA.chasmDepth));
      details.push(onRing(archTrim(4.2, 3.4, 0.4, 0.3), a, inner - 0.1, 0));
      // The ledge between the tiers, with a balustrade along its edge.
      lower.push(onRing(stoneBox(bayWidth + 0.1, CORNICE, depth + 0.8), a, inner + depth / 2 - 0.2, LOWER_TOP + CORNICE / 2));
      details.push(onRing(stoneBox(bayWidth + 0.1, 0.16, 0.34), a, inner - 0.42, LOWER_TOP + CORNICE + 0.08));
      details.push(onRing(stoneBox(bayWidth + 0.1, 0.12, 0.3), a, inner - 0.42, LOWER_TOP + CORNICE + 0.86));
      for (let k = 0; k < 18; k++) {
        const along = (k / 18 - 0.5) * bayWidth + bayWidth / 36;
        const spot = around(a, inner - 0.42, LOWER_TOP + CORNICE + 0.16);
        const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        if (rand() > 0.1) balusterSpots.push(spot.addScaledVector(tangent, along));
      }
      // A half-column on the pier between this arch and the next, with a square capital.
      const pier = a + BAY_ANGLE / 2;
      columns.push(onRing(fluteUVs(new THREE.CylinderGeometry(0.42, 0.48, LOWER_TOP - 0.6, 32), LOWER_TOP - 0.6), pier, inner - 0.05, (LOWER_TOP - 0.6) / 2));
      details.push(onRing(stoneBox(1.15, 0.5, 0.7), pier, inner - 0.05, LOWER_TOP - 0.35));
      details.push(onRing(stoneBox(1.2, 0.35, 0.75), pier, inner - 0.05, 0.17));
    }

    // The gallery behind the lower arches: a floor and a back wall (not where the corridor passes).
    if (!nearGate) {
      const galleryWidth = 2 * ARENA.gallery * Math.tan(BAY_ANGLE / 2) + 0.1;
      gallery.push(onRing(stoneBox(galleryWidth, 0.4, ARENA.gallery - inner - depth + 0.2), a, (inner + depth + ARENA.gallery) / 2, -0.2));
      gallery.push(onRing(archWall(galleryWidth + 0.6, LOWER_TOP + CORNICE, 1.2, { opening: 2.2, openingBottom: 0.02, springAt: 2.2 }), a, ARENA.gallery + 0.6, 0));
    }

    // Upper tier: smaller arches, with ruined, broken tops. Mostly gone above the stands.
    if (gateBay) continue;
    const gone = inStands(a) ? rand() < 0.7 : rand() < 0.12;
    if (gone) continue;
    const height = UPPER_TOP - LOWER_TOP - CORNICE;
    if (rand() < 0.4) {
      // Collapsed: just a broken stump of wall with a jagged top.
      const topEdge = Array.from({ length: 8 }, () => height * (0.15 + rand() * 0.55));
      upper.push(onRing(archWall(bayWidth, height, depth - 0.2, { topEdge }), a, inner + depth / 2, LOWER_TOP + CORNICE));
      continue;
    }
    upper.push(onRing(archWall(bayWidth, height, depth - 0.2, { opening: 3.0, openingBottom: 0.9, springAt: 2.4 }), a, inner + depth / 2, LOWER_TOP + CORNICE));
    details.push(onRing(archTrim(3.0, 2.4, 0.32, 0.26), a, inner - 0.05, LOWER_TOP + CORNICE + 0.9));
    upperBays.push(a);
  }
  addMerged(level, lower, wallStone, { blocksCamera: true });
  addMerged(level, upper, wallStone, { blocksCamera: true });
  addMerged(level, gallery, wallStone);
  addMerged(level, details, wallStone);
  addMerged(level, columns, pillarStone);
  const balusters = new THREE.InstancedMesh(balusterGeometry(), wallStone, balusterSpots.length);
  const m = new THREE.Matrix4();
  balusterSpots.forEach((p, i) => balusters.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  balusters.castShadow = balusters.receiveShadow = true;
  level.add(balusters);
  return { upperBays };
}

function buildStands(level, rand) {
  const block = stoneBox(1.25, 0.9, 0.78);
  const spots = [];
  for (const [startA, endA] of STAND_SECTORS) {
    for (let row = 0; row < 14; row++) {
      const r = ARENA.gallery + 1.2 + row * 0.75;
      const y = LOWER_TOP + CORNICE + row * 0.45 - 0.45;
      const count = Math.floor(((endA - startA) * r) / 1.28);
      for (let k = 0; k < count; k++) {
        if (rand() < 0.07) continue; // missing stone
        const a = startA + ((k + 0.5) / count) * (endA - startA);
        const fallen = rand() < 0.05;
        spots.push({ a, r, y: y - (fallen ? 0.25 + rand() * 0.3 : 0), tilt: fallen ? (rand() - 0.5) * 0.5 : 0 });
      }
    }
  }
  const stands = new THREE.InstancedMesh(block, wallStone, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  spots.forEach(({ a, r, y, tilt }, i) => {
    q.setFromEuler(e.set(tilt, a, tilt * 0.5));
    m.compose(around(a, r, y), q, new THREE.Vector3(1, 1, 1));
    stands.setMatrixAt(i, m);
  });
  stands.castShadow = stands.receiveShadow = true;
  level.add(stands);
}

// Jagged rock spikes breaking through round the platform edge.
function buildRockSpikes(level, rand) {
  const parts = [];
  for (const angleDeg of [48, 118, 196, 252, 318]) {
    const a = deg(angleDeg);
    const spikes = 5 + Math.floor(rand() * 4);
    for (let s = 0; s < spikes; s++) {
      const height = 1.2 + rand() * rand() * 4.5;
      const radius = 0.35 + rand() * 0.6;
      const g = new THREE.ConeGeometry(radius, height, 5, 4);
      const pos = g.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        if (pos.getY(v) > height / 2 - 0.01) continue; // keep the tip sharp
        pos.setXYZ(v, pos.getX(v) * (0.7 + rand() * 0.6), pos.getY(v) + (rand() - 0.5) * 0.2, pos.getZ(v) * (0.7 + rand() * 0.6));
      }
      g.computeVertexNormals();
      g.rotateZ((rand() - 0.5) * 0.5);
      g.rotateX(-0.15 - rand() * 0.35); // lean outward over the chasm
      g.rotateY(a + (rand() - 0.5) * 0.8);
      const spot = around(a + (rand() - 0.5) * 0.18, ARENA.platform + 0.3 + rand() * 1.4, height / 2 - 0.4);
      g.translate(spot.x, spot.y, spot.z);
      parts.push(g);
    }
  }
  addMerged(level, parts, rockStone);
}

function buildBraziers(level, glow, animated) {
  const lit = new Set([0, 3, 4, 7]); // real lights are costly: only some bowls light their surroundings
  for (let i = 0; i < 8; i++) {
    const a = deg(22.5 + i * 45);
    const spot = around(a, ARENA.platform - 1.7);
    const pedestal = new THREE.Mesh(stoneBox(0.8, 0.8, 0.8), wallStone);
    pedestal.position.set(spot.x, 0.4, spot.z);
    pedestal.castShadow = pedestal.receiveShadow = true;
    level.add(pedestal);
    const b = createBrazier(glow, { light: lit.has(i) });
    b.position.set(spot.x, 0.8, spot.z);
    level.add(b);
    animated.push(b);
    addCircle(spot.x, spot.z, 0.6);
  }
}

// Deep blue banners with a gold crest, hanging from the ledge and swaying a little.
function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, '#2f4590');
  g.addColorStop(1, '#1a2858');
  ctx.fillStyle = g;
  // Body with a ragged, torn bottom edge.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 0);
  let x = 256;
  ctx.lineTo(256, 860);
  while (x > 0) {
    x -= 12 + Math.random() * 20;
    ctx.lineTo(Math.max(0, x), 860 + Math.random() * 150);
  }
  ctx.lineTo(0, 860);
  ctx.closePath();
  ctx.fill();
  // Gold trim and a simple crest.
  ctx.strokeStyle = '#b8964a';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, 220, 820);
  ctx.fillStyle = '#c9a65a';
  ctx.save();
  ctx.translate(128, 330);
  ctx.beginPath();
  ctx.moveTo(0, -120);
  ctx.bezierCurveTo(40, -60, 40, -20, 0, 20);
  ctx.bezierCurveTo(-40, -20, -40, -60, 0, -120);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.bezierCurveTo(side * 90, -10, side * 100, -80, side * 60, -100);
    ctx.bezierCurveTo(side * 70, -60, side * 50, -20, 0, 30);
    ctx.fill();
  }
  ctx.fillRect(-60, 40, 120, 14);
  ctx.beginPath();
  ctx.moveTo(-14, 60);
  ctx.lineTo(14, 60);
  ctx.lineTo(0, 150);
  ctx.fill();
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildBanners(level, animated) {
  const material = new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.92 });
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = 'uniform float time;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float sway = (1.0 - uv.y);
       transformed.z += sin(time * 1.3 + position.y * 0.9 + modelMatrix[3].x) * 0.12 * sway * sway;
       transformed.x += sin(time * 0.9 + position.y * 1.7) * 0.04 * sway;`
    );
  };
  const geometry = new THREE.PlaneGeometry(1.5, 5.4, 1, 12);
  geometry.translate(0, -2.7, 0); // hang from the top edge
  for (const angleDeg of [40, 75, 105, 140, 220, 255, 285, 320]) {
    // Between two arches, on the pier.
    const a = Math.round(deg(angleDeg) / BAY_ANGLE) * BAY_ANGLE + BAY_ANGLE / 2;
    const banner = new THREE.Mesh(geometry, material);
    banner.position.copy(around(a, ARENA.chasm - 0.08, LOWER_TOP - 0.05));
    banner.rotation.y = a + Math.PI; // facing the middle of the arena
    banner.castShadow = true;
    level.add(banner);
  }
  const holder = new THREE.Object3D();
  holder.userData.update = (t) => (time.value = t);
  animated.push(holder);
}

// Grass: tufts of blades made from two crossed cards, swaying in the wind.
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const x = 30 + Math.random() * 196;
    const h = 120 + Math.random() * 130;
    const lean = (Math.random() - 0.5) * 90;
    const shade = 85 + Math.random() * 70;
    ctx.strokeStyle = `rgb(${shade * 0.78}, ${shade}, ${shade * 0.6})`;
    ctx.lineWidth = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function swayingMaterial(map, time, strength) {
  const material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = 'uniform float time;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 base = instanceMatrix[3].xyz;
       float bend = uv.y * uv.y * ${strength.toFixed(3)};
       transformed.x += sin(time * 1.6 + base.x * 0.7 + base.z * 0.5) * bend;
       transformed.z += cos(time * 1.3 + base.z * 0.6) * bend * 0.6;`
    );
  };
  return material;
}

function buildGrass(level, rand, animated, isPaved) {
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const tuft = mergeGeometries([card.clone(), card.clone().rotateY(Math.PI / 2)]);
  const time = { value: 0 };
  const spots = [];
  // Round the platform edge and in the gallery.
  for (let i = 0; i < 450; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.min(a, Math.PI * 2 - a) < deg(9)) continue;
    spots.push(around(a, ARENA.platform - 0.4 - rand() * rand() * 2.5));
  }
  for (let i = 0; i < 260; i++) spots.push(around(rand() * Math.PI * 2, ARENA.chasm + 1.8 + rand() * 2));
  // Pushing up through cracks in the platform paving.
  for (let i = 0; i < 50; i++) spots.push(around(rand() * Math.PI * 2, 2 + rand() * (ARENA.platform - 4)));
  // Along the walls of the courtyard and corridor.
  for (let i = 0; i < 900; i++) {
    const x = (rand() - 0.5) * 15;
    const z = 8.5 - rand() * 34;
    const edge = z > -6.5 ? 7.5 : 5;
    const nearWall = Math.abs(Math.abs(x) - edge) < 1.2 || z > 6.5;
    if (nearWall && isPaved(x, z)) spots.push(new THREE.Vector3(x, 0, z));
  }
  const grass = new THREE.InstancedMesh(tuft, swayingMaterial(grassTexture(), time, 0.12), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((p, i) => {
    const s = 0.35 + rand() * 0.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(p.setY(-0.02), q, new THREE.Vector3(s * 1.1, s, s * 1.1));
    grass.setMatrixAt(i, m);
  });
  grass.receiveShadow = true;
  level.add(grass);
  const holder = new THREE.Object3D();
  holder.userData.update = (t) => (time.value = t);
  animated.push(holder);
}

// Hanging vines: long strands of dark leaves draped down the arches.
function vineTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  for (let strand = 0; strand < 4; strand++) {
    let x = 20 + Math.random() * 88;
    const length = 260 + Math.random() * 250;
    for (let y = 0; y < length; y += 5) {
      x += (Math.random() - 0.5) * 4;
      const size = 4 + Math.random() * 7 * (1 - y / 600);
      const shade = 30 + Math.random() * 40;
      ctx.fillStyle = `rgb(${shade * 0.8}, ${shade * 1.05}, ${shade * 0.65})`;
      ctx.beginPath();
      ctx.ellipse(x + (Math.random() - 0.5) * 14, y, size, size * 0.6, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildVines(level, rand, animated, upperBays) {
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, -0.5, 0); // hangs down from its top edge
  const time = { value: 0 };
  const vines = new THREE.InstancedMesh(card, swayingMaterial(vineTexture(), time, -0.06), 150);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 150; i++) {
    let a = rand() * Math.PI * 2;
    if (Math.min(a, Math.PI * 2 - a) < deg(10)) a += deg(20);
    const high = rand() < 0.4 && upperBays.length;
    if (high) a = upperBays[Math.floor(rand() * upperBays.length)] + (rand() - 0.5) * BAY_ANGLE;
    const top = high ? UPPER_TOP - 1 - rand() * 2 : LOWER_TOP + CORNICE;
    const length = 1.5 + rand() * (high ? 3 : 5);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI);
    m.compose(around(a, ARENA.chasm - 0.12 - rand() * 0.1, top), q, new THREE.Vector3(0.7 + rand() * 0.8, length, 1));
    vines.setMatrixAt(i, m);
  }
  level.add(vines);
  const holder = new THREE.Object3D();
  holder.userData.update = (t) => (time.value = t);
  animated.push(holder);
}

export function buildArena(level, rand, glow, animated, isPaved) {
  buildGroundAndChasm(level);
  buildPlatformRim(level, rand);
  const bridge = buildBridge(level, rand);
  const { upperBays } = buildColosseum(level, rand);
  buildStands(level, rand);
  buildRockSpikes(level, rand);
  buildBraziers(level, glow, animated);
  buildBanners(level, animated);
  buildGrass(level, rand, animated, isPaved);
  buildVines(level, rand, animated, upperBays);

  // You can only stand on the platform and the bridge (the rest is a long drop).
  setWalkArea((x, z) => z < GATE_Z - 0.2, [
    { x: 0, z: CZ, radius: ARENA.platform },
    { minX: -BRIDGE.halfWidth, maxX: BRIDGE.halfWidth, minZ: bridge.end - 1, maxZ: GATE_Z + 0.5 },
  ]);

  // Statues of knights standing in some of the upper arches (added once the knight model has loaded).
  const statueBays = upperBays.filter((a) => !inStands(a) && Math.min(a, Math.PI * 2 - a) > deg(40));
  return {
    addStatues(knightModel, idleClip) {
      const picks = [deg(180), deg(80), deg(280), deg(165), deg(195)]
        .map((want) => statueBays.reduce((best, a) => (Math.abs(a - want) < Math.abs(best - want) ? a : best), statueBays[0]))
        .filter((a, i, all) => a !== undefined && all.indexOf(a) === i)
        .slice(0, 4);
      for (const a of picks) {
        const statue = SkeletonUtils.clone(knightModel);
        statue.traverse((o) => {
          if (o.isMesh) {
            o.material = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.88, normalMap: o.material.normalMap });
            o.castShadow = o.receiveShadow = true;
          }
        });
        if (idleClip) {
          const mixer = new THREE.AnimationMixer(statue);
          mixer.clipAction(idleClip).play();
          mixer.setTime(idleClip.duration * 0.4); // frozen in a guarded pose
        }
        statue.scale.setScalar(1.35);
        statue.position.copy(around(a, ARENA.chasm + 0.75, LOWER_TOP + CORNICE + 0.9));
        statue.rotation.y = a + Math.PI;
        level.add(statue);
      }
    },
  };
}
