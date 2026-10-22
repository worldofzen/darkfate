// Building blocks for crumbling stone architecture: walls, pillars, rubble.
// (The floor is in ground.js.)
import * as THREE from 'three';
import { addBox, addCircle, cameraBlockers } from './colliders.js';
import { wallStone, pillarStone, rockStone, worldScaleBoxUVs, fluteUVs } from './materials.js';

export const wallMaterial = wallStone;
const pillarMaterial = pillarStone; // the fluted shafts; bases and tops are plain wall blocks

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

function stoneColumn(radiusTop, radiusBottom, height) {
  return fluteUVs(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 48), height);
}

function solid(mesh, blocksCamera = true) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (blocksCamera) cameraBlockers.push(mesh);
  return mesh;
}

// A wall from (x1, z1) to (x2, z2), made of ~2 m blocks.
// Some blocks are randomly shorter, so the wall looks ruined.
export function wall(group, x1, z1, x2, z2, rand, { height = 7, thickness = 1, ruined = 0.12 } = {}) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const count = Math.max(1, Math.round(length / 2));
  const seg = length / count;
  const angle = Math.atan2(dx, dz);
  for (let i = 0; i < count; i++) {
    let h = height * (0.85 + rand() * 0.15);
    if (rand() < ruined) h *= 0.35 + rand() * 0.2;
    const block = solid(new THREE.Mesh(stoneBox(thickness, h, seg + 0.02), wallMaterial));
    const t = (i + 0.5) / count;
    block.position.set(x1 + dx * t, h / 2, z1 + dz * t);
    block.rotation.y = angle;
    group.add(block);
    addBox(block.position.x, block.position.z, thickness / 2, seg / 2, angle);
  }
}

// A stone column with a square base and top. Broken ones leave a fallen chunk nearby.
export function pillar(group, x, z, rand, { height = 7, radius = 0.4, broken = false } = {}) {
  const h = broken ? height * (0.25 + rand() * 0.3) : height;

  const base = solid(new THREE.Mesh(stoneBox(radius * 2.8, 0.4, radius * 2.8), wallMaterial));
  base.position.set(x, 0.2, z);
  group.add(base);

  const shaft = solid(new THREE.Mesh(stoneColumn(radius, radius * 1.1, h), pillarMaterial));
  shaft.position.set(x, h / 2 + 0.4, z);
  group.add(shaft);
  addCircle(x, z, radius * 1.4);

  if (!broken) {
    const top = solid(new THREE.Mesh(stoneBox(radius * 2.8, 0.5, radius * 2.8), wallMaterial));
    top.position.set(x, h + 0.65, z);
    group.add(top);
  } else {
    const chunkLength = 1 + rand() * 1.5;
    const chunk = solid(new THREE.Mesh(stoneColumn(radius, radius, chunkLength), pillarMaterial));
    const a = rand() * Math.PI * 2;
    chunk.position.set(x + Math.cos(a) * 1.6, radius, z + Math.sin(a) * 1.6);
    chunk.rotation.set(0, a, Math.PI / 2);
    group.add(chunk);
    addBox(chunk.position.x, chunk.position.z, chunkLength / 2, radius, a);
  }
}

// Scatter some broken rocks inside an area.
export function rubble(group, count, rand, { minX, maxX, minZ, maxZ, keep = () => true }) {
  for (let placed = 0, tries = 0; placed < count && tries < count * 20; tries++) {
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    if (!keep(x, z)) continue;
    const size = 0.15 + rand() * 0.45;
    const rock = solid(new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockStone), false);
    rock.position.set(x, size * 0.5, z);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.scale.y = 0.6 + rand() * 0.4;
    group.add(rock);
    placed++;
  }
}
