// The boss arena, modelled on the ruined colosseums of Elden Ring:
//
//   - the round stone platform (the Arena_center.glb model, with rune rings and rock spikes),
//     standing on a great drum of stone that drops into a chasm
//   - a stone bridge (Arena_walkway.glb) from the fog gate across the chasm
//   - a ring of two-storey arcaded walls (Dungeon_wall.glb sections) around the chasm, right
//     up to the gate, with a second ring of them dropping into the chasm below
//   - fire bowls on pedestals, grass and vines, and low fog rolling over the platform
//
// Big repeated pieces (grass, vines) are "instanced", so the whole arena is only a few
// dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA, BRIDGE, GATE_Z, GATE_TOP } from './layout.js';
import { dirtMeters } from './materials.js';
import { createBrazier } from './brazier.js';
import { addCircle, setWalkArea, setGroundMap, groundHeight } from './colliders.js';

const CZ = ARENA.z;
const deg = THREE.MathUtils.degToRad;

// A point at `angle` around the arena, `radius` from its center.
const around = (angle, radius, y = 0) => new THREE.Vector3(Math.sin(angle) * radius, y, CZ + Math.cos(angle) * radius);

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
  // The chasm floor far below.
  level.add(dirtFlat(circleShape(0, CZ, ARENA.chasm + 1), -ARENA.chasmDepth));
}

// --- The platform: the Arena_center.glb model ---
// Measured on the model (in its own units): the walkable top reaches out to about 0.47 from
// the middle, and the floor sits at about -0.0225. Scaled so that edge is the platform's edge,
// the model is about 13 m thick: its underside becomes the drum dropping into the chasm.
const PLATFORM_MODEL = { edge: 0.47, floorY: -0.0225 };
const GROUND_CELL = 0.25; // height map resolution (m)

function buildPlatform(level, loadModel) {
  return loadModel('models/Arena_center.glb').then((platform) => {
    const scale = ARENA.platform / PLATFORM_MODEL.edge;
    platform.scale.setScalar(scale);
    platform.position.set(0, -PLATFORM_MODEL.floorY * scale + 0.12, CZ); // a little raised: level with the bridge at the edge
    // The floor you fight on, seen up close all the time: its original 8192-pixel textures
    // replace the model's 4096-pixel ones once the game has loaded (see main.js).
    platform.userData.hiRes = { map: 'textures/arena_floor_color_8k.webp', normalMap: 'textures/arena_floor_normal_8k.webp' };
    level.add(platform);
    platform.updateMatrixWorld(true);
    return platform;
  });
}

// A height map of the platform's and walkway's top surfaces: for every 25 cm cell, the height of
// the highest triangle above it. Cells far above the floor (rock spikes, parapets) or with
// nothing there (broken edges) are marked solid, so you can't walk through them or fall off.
function groundMapFrom(models) {
  const half = ARENA.platform + 1.5;
  const cell = GROUND_CELL;
  const cols = Math.ceil((2 * half) / cell);
  const minX = -half;
  const minZ = CZ - half;
  const rows = Math.ceil((GATE_Z + 1 - minZ) / cell); // up to the gate, to cover the walkway
  const top = new Float32Array(cols * rows).fill(-Infinity);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const model of models) model.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const count = index ? index.count : pos.count;
    const vertex = (v, n) => v.fromBufferAttribute(pos, index ? index.getX(n) : n).applyMatrix4(o.matrixWorld);
    for (let t = 0; t < count; t += 3) {
      vertex(a, t);
      vertex(b, t + 1);
      vertex(c, t + 2);
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) continue; // a vertical face
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - minX) / cell - 0.5));
      const i1 = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / cell - 0.5));
      const k0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - minZ) / cell - 0.5));
      const k1 = Math.min(rows - 1, Math.floor((Math.max(a.z, b.z, c.z) - minZ) / cell - 0.5));
      for (let k = k0; k <= k1; k++) {
        const pz = minZ + (k + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = minX + (i + 0.5) * cell;
          const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
          const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          if (y > top[k * cols + i]) top[k * cols + i] = y;
        }
      }
    }
  });

  const SPIKE = 0.6; // higher than this above the floor: a rock you bump into
  const HOLE = -1.5; // lower than this (or nothing there): a gap you can't step into
  const walkable = (y) => y > HOLE && y < SPIKE;
  const height = new Float32Array(cols * rows);
  const solid = new Uint8Array(cols * rows);
  const onWalkway = (x, z) => Math.abs(x) < BRIDGE.halfWidth + 0.6 && z > CZ + ARENA.platform - 3 && z < GATE_Z;
  for (let k = 0; k < rows; k++) {
    for (let i = 0; i < cols; i++) {
      const j = k * cols + i;
      // The local floor level: the average of the walkable cells nearby (about 1.25 m across),
      // so narrow cracks don't swallow your feet.
      let sum = 0;
      let n = 0;
      for (let dk = -2; dk <= 2; dk++) {
        for (let di = -2; di <= 2; di++) {
          const kk = k + dk;
          const ii = i + di;
          if (kk < 0 || ii < 0 || kk >= rows || ii >= cols) continue;
          const y = top[kk * cols + ii];
          if (walkable(y)) {
            sum += y;
            n++;
          }
        }
      }
      const local = n ? sum / n : 0;
      const raw = top[j];
      height[j] = THREE.MathUtils.clamp(walkable(raw) ? Math.max(raw, local - 0.12) : local, -0.3, SPIKE); // wide cracks: sink a little, not into them
      const x = minX + (i + 0.5) * cell;
      const z = minZ + (k + 0.5) * cell;
      if (!walkable(raw) && (Math.hypot(x, z - CZ) < ARENA.platform + 0.5 || onWalkway(x, z))) solid[j] = 1;
    }
  }
  return { minX, minZ, cell, cols, rows, height, solid };
}

// --- The ring of arcaded walls: Dungeon_wall.glb sections ---
// Each section is curved like a slice of a colosseum (its two halves meet at an angle), with
// two storeys of arches on its inner (-Z) side, spanning about 46° when scaled to
// suit its radius (about 31x: some 30 m wide and 24 m tall).
// Above the platform they run right up to both sides of the gate; below it, a second ring of
// them (a lighter copy of the model, as it's mostly lost in the mist) drops into the chasm.
const WALL_MODEL = { innerFaceZ: -0.043, bottomY: -0.39, width: 0.98, height: 0.78, depth: 0.366 }; // measured on the model
const RING_SCALE = ((21 * (ARENA.chasm + 0.6)) / 26.6) * 1.04; // 4% over, so neighbours overlap at the seams
const GATE_SECTOR = deg(7.2); // half the gate's width, seen from the middle of the arena

function buildWallRing(level, wallModel, lowWallModel) {
  const sections = 8; // each spans about 46°: eight leave a little overlap at the seams
  const span = (Math.PI * 2 - 2 * GATE_SECTOR) / sections;
  const radius = ARENA.chasm + 0.6 - WALL_MODEL.innerFaceZ * RING_SCALE;
  const height = WALL_MODEL.height * RING_SCALE;
  const place = (source, a, bottom, shadows) => {
    const section = source.clone();
    section.scale.setScalar(RING_SCALE);
    section.position.copy(around(a, radius, bottom - WALL_MODEL.bottomY * RING_SCALE));
    section.rotation.y = a; // arches (-Z) facing the middle of the arena
    section.traverse((o) => o.isMesh && (o.castShadow = shadows));
    level.add(section);
  };
  wallModel.then((wall) => {
    for (let k = 0; k < sections; k++) place(wall, GATE_SECTOR + span * (k + 0.5), -1, true);
  });
  // Above the gate, which is only half as tall: two smaller storeys stacked up to the top, on
  // top of the gate. The model is arched on one face and curves back like a dome behind it, so
  // each storey is two thin slices back to back: arches toward the arena and toward the corridor.
  wallModel.then((wall) => {
    const width = 2 * radius * Math.sin(GATE_SECTOR) + 1.2;
    const bottom = GATE_TOP - 0.4;
    const each = (height - 1 - bottom) / 2;
    const slice = 1.2; // each slice's depth (m): thin, which also flattens the model's curve
    for (let k = 0; k < 2; k++) {
      for (const side of [-1, 1]) {
        const piece = wall.clone();
        piece.scale.set(width / WALL_MODEL.width, each / WALL_MODEL.height, slice / WALL_MODEL.depth);
        piece.rotation.y = side > 0 ? Math.PI : 0; // arches (-Z) facing out on this side
        piece.position.set(0, bottom + each * k - WALL_MODEL.bottomY * piece.scale.y, GATE_Z + side * slice / 2);
        level.add(piece);
      }
    }
  });
  // All the way round below, under the gate too; turned half a section so the seams don't line up.
  lowWallModel.then((wall) => {
    for (let k = 0; k < 9; k++) place(wall, ((k + 0.5) / 9) * Math.PI * 2, -1.3 - height, false); // nine: no gap left round the full circle
  });
}

// --- The walkway: Arena_walkway.glb, a long stone bridge from the veil to the platform ---
// Measured on the model: it runs along its X axis (0.98 long), its paved deck sits at
// y = 0.003 between two low parapet walls, and it's about 0.17 wide. At 24x it is a 23.5 m
// bridge with a 3.1 m wide deck and parapets about 0.8 m tall. It starts in the gateway and
// reaches 2 m onto the platform. Underneath, a dungeon wall section stretched along it holds
// it up from the chasm floor like an aqueduct (squashed thin, which straightens its curve).
const WALKWAY = { scale: 24, halfLength: 0.49, deckY: 0.003, halfWidth: 0.085 };

function buildBridge(level, loadModel, wallModel) {
  const start = GATE_Z + 0.5;
  const length = WALKWAY.halfLength * 2 * WALKWAY.scale;
  const mid = start - length / 2;
  const end = CZ + ARENA.platform; // where it reaches the platform's edge

  // The model has arches on one face only, so two thin copies stand back to back.
  wallModel.then((wall) => {
    const deck = WALKWAY.halfWidth * 2 * WALKWAY.scale;
    const height = ARENA.chasmDepth + 0.5;
    for (const side of [-1, 1]) {
      const support = wall.clone();
      support.scale.set((start - end + 2) / WALL_MODEL.width, height / WALL_MODEL.height, (deck / 2 - 0.15) / WALL_MODEL.depth);
      support.rotation.y = -side * (Math.PI / 2); // arches (-Z) facing out to this side
      support.position.set(side * (deck / 4 - 0.05), -0.4 - height / 2, (start + end) / 2);
      support.traverse((o) => o.isMesh && (o.castShadow = false));
      level.add(support);
    }
  });

  const ready = loadModel('models/Arena_walkway.glb').then((walkway) => {
    walkway.scale.setScalar(WALKWAY.scale);
    walkway.rotation.y = Math.PI / 2; // its length (X) runs from the gate toward the arena (-Z)
    walkway.position.set(0, -WALKWAY.deckY * WALKWAY.scale, mid);
    level.add(walkway);
    walkway.updateMatrixWorld(true);
    return walkway;
  });
  return { start, end, ready };
}

// Eight big stone fire bowls (Dungeon_lamp.glb) round the platform, standing on the real floor.
function buildBraziers(level, glow, animated, loadModel) {
  const lit = new Set([0, 3, 4, 7]); // real lights are costly: only some bowls light their surroundings
  const lampModel = loadModel('models/Dungeon_lamp.glb');
  for (let i = 0; i < 8; i++) {
    const a = deg(22.5 + i * 45);
    const spot = around(a, ARENA.platform - 4.5);
    spot.y = groundHeight(spot.x, spot.z) - 0.05; // sunk a touch into the uneven floor
    const b = createBrazier(glow, { model: lampModel, height: 2.2, light: lit.has(i) });
    b.position.copy(spot);
    level.add(b);
    animated.push(b);
    addCircle(spot.x, spot.z, 0.85);
  }
}

// Grass: tufts of tapered, curving blades on three crossed cards, swaying in the wind.
// The colors are muted (olive, straw, dead brown) to sit in the gloom instead of glowing green.
function grassTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const tips = [
    [118, 134, 64], // olive
    [146, 150, 82], // pale olive
    [164, 146, 90], // straw
    [118, 96, 60], // dead brown
  ];
  const blade = (x, h, width, lean, tip, dim) => {
    const top = size - h;
    const g = ctx.createLinearGradient(0, size, 0, top);
    g.addColorStop(0, `rgb(${40 * dim}, ${46 * dim}, ${24 * dim})`);
    g.addColorStop(0.45, `rgb(${78 * dim}, ${90 * dim}, ${44 * dim})`);
    g.addColorStop(1, `rgb(${tip[0] * dim}, ${tip[1] * dim}, ${tip[2] * dim})`);
    ctx.fillStyle = g;
    // A narrow leaf: wide at the root, curving over to a sharp point.
    const tipX = x + lean;
    const midX = x + lean * 0.25;
    ctx.beginPath();
    ctx.moveTo(x - width, size);
    ctx.quadraticCurveTo(midX - width * 0.8, size - h * 0.55, tipX, top);
    ctx.quadraticCurveTo(midX + width * 0.8, size - h * 0.55, x + width, size);
    ctx.closePath();
    ctx.fill();
  };
  // Back blades first (darker), then the front ones over them.
  for (let layer = 0; layer < 2; layer++) {
    const count = layer ? 34 : 26;
    for (let i = 0; i < count; i++) {
      const fromCenter = (Math.random() - 0.5) * (Math.random() * 0.5 + 0.5); // bunched in the middle
      const x = size / 2 + fromCenter * size * 0.75;
      const h = size * (0.35 + Math.random() * 0.6) * (1 - Math.abs(fromCenter) * 0.9);
      const lean = fromCenter * size * 0.5 + (Math.random() - 0.5) * 70; // splay outward
      const tip = Math.random() < 0.18 ? tips[3] : tips[Math.floor(Math.random() * 3)];
      blade(x, h, 5 + Math.random() * 6, lean, tip, layer ? 0.9 + Math.random() * 0.25 : 0.65 + Math.random() * 0.2);
    }
  }
  // A few seed heads on tall stalks.
  for (let i = 0; i < 3; i++) {
    const x = size / 2 + (Math.random() - 0.5) * 140;
    const h = size * (0.82 + Math.random() * 0.15);
    const lean = (Math.random() - 0.5) * 60;
    ctx.strokeStyle = 'rgb(86, 78, 48)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 0.3, size - h * 0.6, x + lean, size - h);
    ctx.stroke();
    ctx.fillStyle = 'rgb(138, 120, 76)';
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.ellipse(x + lean + (Math.random() - 0.5) * 6, size - h + k * 7, 4, 7, lean * 0.004, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// `softNormals`: light the blades with the normals the mesh gives (tilted up), the same from
// both sides, so a tuft shades like a soft clump instead of flat cards flipping light to dark.
function swayingMaterial(map, time, strength, { softNormals = false, vertexColors = false, alphaTest = 0.4 } = {}) {
  const material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, alphaTest, roughness: 0.95, vertexColors });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = 'uniform float time;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 base = instanceMatrix[3].xyz;
       float bend = uv.y * uv.y * ${strength.toFixed(3)};
       float gust = 0.6 + 0.8 * (0.5 + 0.5 * sin(time * 0.45 + base.x * 0.12 + base.z * 0.09));
       float flutter = sin(time * 4.3 + base.x * 3.1 + base.z * 2.3 + uv.x * 2.0) * 0.15;
       transformed.x += (sin(time * 1.6 + base.x * 0.7 + base.z * 0.5) + flutter) * bend * gust;
       transformed.z += (cos(time * 1.3 + base.z * 0.6) + flutter) * bend * gust * 0.6;`
    );
    if (softNormals) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         normal = normalize(vNormal);`
      );
    }
  };
  return material;
}

// One tuft: three cards at 60°, cut into rows so they curve when they bend. The vertex
// colors darken the roots (where the blades crowd together and the light can't reach).
function tuftGeometry() {
  const cards = [0, 1, 2].map((i) => {
    const card = new THREE.PlaneGeometry(1, 1, 1, 4);
    card.translate(0, 0.5, 0);
    card.rotateY((i * Math.PI) / 3);
    return card;
  });
  const tuft = mergeGeometries(cards);
  const uv = tuft.attributes.uv;
  const normal = tuft.attributes.normal;
  const colors = new Float32Array(uv.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < uv.count; i++) {
    const shade = 0.5 + 0.5 * Math.pow(uv.getY(i), 0.6);
    colors.set([shade, shade, shade], i * 3);
    n.fromBufferAttribute(normal, i).multiplyScalar(0.3).add(new THREE.Vector3(0, 1, 0)).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  tuft.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return tuft;
}

function buildGrass(level, rand, animated, isPaved) {
  const time = { value: 0 };
  const spots = [];
  const braziers = [[-5.5, -4.5], [5.5, -4.5], [-3, -11.5], [3, -21.5]];
  const clear = (x, z) => isPaved(x, z) && braziers.every(([bx, bz]) => Math.hypot(x - bx, z - bz) > 0.8);
  const clump = (cx, cz, count, spread, scale) => {
    for (let k = 0; k < count; k++) {
      const r = spread * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      // Bigger in the middle of a clump, smaller round its edge.
      if (clear(x, z)) spots.push({ x, z, s: scale * (1 - (0.5 * r) / spread) * (0.7 + rand() * 0.5) });
    }
  };
  // Clumps growing out from the foot of the walls of the courtyard and corridor.
  for (let i = 0; i < 110; i++) {
    const z = 8.5 - rand() * 34;
    const edge = z > -6.5 ? 7.5 : 5;
    const side = rand() < 0.5 ? -1 : 1;
    const backWall = z > 6.5 && rand() < 0.5;
    const x = backWall ? (rand() - 0.5) * 14 : side * (edge - 0.15 - rand() * rand() * 1.1);
    const zz = backWall ? 8.35 - rand() * rand() * 1.1 : z;
    clump(x, zz, 3 + Math.floor(rand() * 6), 0.25 + rand() * 0.35, 0.45 + rand() * 0.45);
  }
  // Around the feet of the pillars.
  for (const [px, pz] of [[-5.5, 6.5], [5.5, 6.5], ...[-9, -14, -19, -24].flatMap((z) => [[-3.75, z], [3.75, z]])]) {
    if (rand() < 0.75) clump(px + (rand() - 0.5) * 0.8, pz + (rand() - 0.5) * 0.8, 4 + Math.floor(rand() * 4), 0.4, 0.5);
  }
  // And a few small sprigs out in the open, poking through the cracks between the flagstones.
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 14;
    const z = 8 - rand() * 33;
    if (clear(x, z)) spots.push({ x, z, s: 0.18 + rand() * 0.2 });
  }

  const grass = new THREE.InstancedMesh(
    tuftGeometry(),
    swayingMaterial(grassTexture(), time, 0.14, { softNormals: true, vertexColors: true, alphaTest: 0.5 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Euler();
  spots.forEach(({ x, z, s }, i) => {
    tilt.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25); // not all bolt upright
    q.setFromEuler(tilt);
    const wide = 1 + rand() * 0.4;
    m.compose(new THREE.Vector3(x, -0.03, z), q, new THREE.Vector3(s * wide, s * (0.85 + rand() * 0.3), s * wide));
    grass.setMatrixAt(i, m);
  });
  grass.receiveShadow = true;
  level.add(grass);
  const holder = new THREE.Object3D();
  holder.userData.update = (t) => (time.value = t);
  animated.push(holder);
}

// Hanging vines: long strands of dark leaves draped down the arches.
const VINE_LEDGES = [11.2, 22.5]; // heights of the wall ring's ledges (m)
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

function buildVines(level, rand, animated) {
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, -0.5, 0); // hangs down from its top edge
  const time = { value: 0 };
  const vines = new THREE.InstancedMesh(card, swayingMaterial(vineTexture(), time, -0.06), 150);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 150; i++) {
    let a = rand() * Math.PI * 2;
    if (Math.min(a, Math.PI * 2 - a) < GATE_SECTOR + deg(2)) a += GATE_SECTOR * 2 + deg(4); // not over the gate
    // Draped from the ledges of the wall ring: the one between its storeys, and its top.
    const high = rand() < 0.35;
    const top = high ? VINE_LEDGES[1] - rand() * 1.5 : VINE_LEDGES[0] - rand() * 0.5;
    const length = 2 + rand() * (high ? 5 : 7);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI);
    m.compose(around(a, ARENA.chasm + 0.55 + rand() * 0.15, top), q, new THREE.Vector3(0.9 + rand() * 1.1, length, 1));
    vines.setMatrixAt(i, m);
  }
  level.add(vines);
  const holder = new THREE.Object3D();
  holder.userData.update = (t) => (time.value = t);
  animated.push(holder);
}

export function buildArena(level, rand, glow, animated, isPaved, loadModel) {
  buildGroundAndChasm(level);
  const wallModel = loadModel('models/Dungeon_wall.glb');
  const lowWallModel = loadModel('models/Dungeon_wall_low.glb');
  const bridge = buildBridge(level, loadModel, wallModel);
  // Once the platform and walkway have loaded: their height map, then the fire bowls on the real floor.
  Promise.all([buildPlatform(level, loadModel), bridge.ready]).then((models) => {
    setGroundMap(groundMapFrom(models));
    buildBraziers(level, glow, animated, loadModel);
  });
  buildWallRing(level, wallModel, lowWallModel);
  buildGrass(level, rand, animated, isPaved);
  buildVines(level, rand, animated);

  // A sea of mist filling the chasm a little below the platform's rim, out to the horizon: a dark surface that the
  // ground mist (see heightFog.js) buries, so it shows as thick, drifting mist with nothing
  // under it showing through.
  const sea = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.platform - 1, 150, 96, 4).rotateX(-Math.PI / 2),
    // ("transparent" keeps it out of the ambient occlusion, which would draw a dark crease where it meets the walls)
    new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true })
  );
  sea.position.set(0, -2.2, CZ);
  level.add(sea);

  // You can only stand on the platform and the bridge (the rest is a long drop).
  setWalkArea((x, z) => z < GATE_Z - 0.2, [
    { x: 0, z: CZ, radius: ARENA.platform },
    { minX: -BRIDGE.halfWidth, maxX: BRIDGE.halfWidth, minZ: bridge.end - 1, maxZ: GATE_Z + 0.5 },
  ]);
}
