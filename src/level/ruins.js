// Building blocks for crumbling stone architecture: walls, pillars, rubble.
// (The floor is in ground.js.)
import * as THREE from 'three';
import { addBox, addCircle, cameraBlockers } from './colliders.js';
import { wallStone, brokenStone, worldScaleBoxUVs } from './materials.js';
import { stoneKinds } from './stones.js';
import { LAYERS } from '../layers.js';

export const wallMaterial = wallStone;

// Stone blocks get random texture offsets from their own little random generator
// (so the walls look the same every time without disturbing the level's layout).
let uvSeed = 99;
const uvRand = () => {
  uvSeed = (uvSeed * 16807) % 2147483647;
  return (uvSeed - 1) / 2147483646;
};

// A stone box whose texture is to scale on every face.
export function stoneBox(width, height, depth) {
  return worldScaleBoxUVs(new THREE.BoxGeometry(width, height, depth), width, height, depth, uvRand);
}

function solid(mesh, blocksCamera = true) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (blocksCamera) cameraBlockers.push(mesh);
  return mesh;
}

// A wall from (x1, z1) to (x2, z2), built from sections of the Dungeon_wall.glb model
// (`model` is the loading model, a promise). Each section is slightly curved, with arches on
// one side: they face the point `inside`. The collider and camera blocker are a plain
// `thickness`-thick box along the line, in place straight away.
const WALL_SECTION = { width: 0.98, height: 0.78, endFaceZ: -0.17, bottomY: -0.39 }; // measured on the model
export function wall(group, x1, z1, x2, z2, rand, model, { inside, height = 7, thickness = 1 } = {}) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const mid = new THREE.Vector3(x1 + dx / 2, 0, z1 + dz / 2);
  addBox(mid.x, mid.z, thickness / 2, length / 2, angle);
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, length));
  blocker.position.set(mid.x, height / 2, mid.z);
  blocker.rotation.y = angle;
  blocker.visible = false;
  group.add(blocker);
  cameraBlockers.push(blocker);

  // Turn the sections to run along the wall with their arches (-Z) toward `inside`.
  let turn = Math.atan2(-dz, dx);
  const inward = () => new THREE.Vector3(-Math.sin(turn), 0, -Math.cos(turn));
  if (inward().dot(new THREE.Vector3(inside[0] - mid.x, 0, inside[1] - mid.z)) < 0) turn += Math.PI;
  const n = inward();
  const count = Math.max(1, Math.round(length / (height * 1.2)));
  const sy = height / WALL_SECTION.height;
  const sz = sy * 0.6; // a bit shallower than the model, so the curve doesn't bulge too far
  const sx = (length / count / WALL_SECTION.width) * 1.02; // a little overlap hides the seams
  model.then((source) => {
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const section = source.clone();
      section.scale.set(sx, sy, sz);
      section.rotation.y = turn;
      // The section's ends line up with the wall's inner face; its middle curves back.
      section.position
        .set(x1 + dx * t, -WALL_SECTION.bottomY * sy - 0.15, z1 + dz * t)
        .addScaledVector(n, thickness / 2 + WALL_SECTION.endFaceZ * sz);
      section.traverse((o) => o.isMesh && solid(o, false));
      group.add(section);
    }
  });
}

// A carved dungeon pillar (the Dungeon_Pillar.glb model), standing at (x, z) and
// `height` meters tall. `model` is the loading model (a promise): the collider is in
// place straight away, and the pillar itself appears as soon as the model has loaded.
export const PILLAR = { height: 6.2 };
export function pillar(group, x, z, rand, model, { height = PILLAR.height } = {}) {
  const spot = new THREE.Group();
  spot.position.set(x, 0, z);
  spot.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2); // each one turned differently
  group.add(spot);
  // The model is about 0.31 m wide for every 1 m of height.
  const radius = height * 0.14;
  addCircle(x, z, radius);
  // The camera bumps into a simple invisible cylinder instead of the detailed model (much faster).
  const blocker = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12));
  blocker.position.y = height / 2;
  blocker.visible = false;
  spot.add(blocker);
  cameraBlockers.push(blocker);
  model.then((source) => {
    const copy = source.clone(); // shares the mesh and textures with the other pillars
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    copy.scale.setScalar(height / size.y);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(height / size.y);
    copy.position.set(-center.x, -box.min.y * (height / size.y), -center.z); // standing on the floor
    copy.traverse((o) => o.isMesh && solid(o, false));
    spot.add(copy);
  });
}

// Scatter broken stones (see stones.js) inside an area: mostly small pieces, some big
// blocks, none overlapping. The big ones are solid; one instanced mesh per kind of stone,
// in full detail on screen, plus a coarse copy for their shadows (see layers.js).
const SHADOW_STONE_STEP = 0.06;
export function rubble(group, count, rand, { minX, maxX, minZ, maxZ, keep = () => true }) {
  const kinds = stoneKinds();
  const shadowKinds = stoneKinds(SHADOW_STONE_STEP);
  const spots = kinds.map(() => []);
  const placed = [];
  for (let tries = 0; placed.length < count && tries < count * 30; tries++) {
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    if (!keep(x, z)) continue;
    const kind = Math.floor(rand() * kinds.length);
    const scale = rand() < 0.4 ? 0.8 + rand() * 0.35 : 0.4 + rand() * 0.3;
    const radius = kinds[kind].radius * scale;
    if (placed.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + radius + 0.15)) continue;
    placed.push({ x, z, radius });
    spots[kind].push({ x, z, scale });
    if (radius > 0.3) addCircle(x, z, radius * 0.8);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const turn = new THREE.Euler();
  kinds.forEach(({ geometry }, k) => {
    if (!spots[k].length) return;
    const stones = new THREE.InstancedMesh(geometry, brokenStone, spots[k].length);
    const shadow = new THREE.InstancedMesh(shadowKinds[k].geometry, brokenStone, spots[k].length);
    spots[k].forEach(({ x, z, scale }, i) => {
      turn.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12); // settled a little crooked
      m.compose(new THREE.Vector3(x, -0.03 * scale, z), q.setFromEuler(turn), new THREE.Vector3(scale, scale * (0.9 + rand() * 0.2), scale));
      stones.setMatrixAt(i, m);
      shadow.setMatrixAt(i, m);
    });
    stones.computeBoundingSphere();
    shadow.computeBoundingSphere();
    group.add(solid(stones, false));
    stones.layers.set(LAYERS.detail);
    shadow.layers.set(LAYERS.shadow);
    shadow.castShadow = true;
    group.add(shadow);
  });
}
