// Builds the whole level: the entrance (where you spawn), the fog gate, the boss arena
// (see arena.js) and the tower looming behind it.
import * as THREE from 'three';
import { seededRandom, makeGlowTexture } from './textures.js';
import { wall, pillar, rubble, wallMaterial, stoneBox } from './ruins.js';
import { buildGround } from './ground.js';
import { buildArena } from './arena.js';
import { createBrazier } from './brazier.js';
import { createSiteOfGrace } from './siteOfGrace.js';
import { createFogGate } from './fogGate.js';
import { addBox, addCircle, cameraBlockers } from './colliders.js';
import { GRACE, COURTYARD, CORRIDOR, GATE_Z, ARENA, BRIDGE, TOWER_Z } from './layout.js';

const GATE_OPENING = { width: 5, height: 6.2 }; // the gate sits in the colosseum's lower tier

export function buildLevel(scene, loadModel) {
  const level = new THREE.Group();
  const animated = []; // things that move every frame (fire, sparks, fog)
  const rand = seededRandom(42);
  const glow = makeGlowTexture();

  // The stone paving (the dirt under it is laid by the arena builder).
  const { halfWidth: cw, back, front } = COURTYARD;
  const hw = CORRIDOR.halfWidth;
  const bridgeEnd = ARENA.z + ARENA.platform;
  const isPaved = (x, z) =>
    (Math.abs(x) < cw + 0.3 && z > front - 0.3 && z < back + 0.3) || // courtyard
    (Math.abs(x) < hw + 0.3 && z > GATE_Z - 0.4 && z <= front) || // corridor
    (Math.abs(x) < BRIDGE.halfWidth - 0.1 && z <= GATE_Z && z > bridgeEnd - 0.5); // bridge
  buildGround(level, rand, {
    bounds: { minX: -16, maxX: 16, minZ: bridgeEnd - 2, maxZ: back + 0.5 },
    arena: { x: 0, z: ARENA.z, radius: ARENA.platform },
    isFloor: isPaved,
  });

  buildEntrance(level, rand, glow, animated);
  const gate = buildGate(level, glow, animated);
  const arena = buildArena(level, rand, glow, animated, isPaved);

  // The tower looms far behind the arena, rising out of the mist.
  const towerReady = loadModel('models/BOSS_tower.glb').then((tower) => {
    tower.scale.setScalar(1.3);
    tower.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tower);
    const center = box.getCenter(new THREE.Vector3());
    tower.position.set(-center.x, -box.min.y - 2, TOWER_Z - center.z);
    level.add(tower);
    return tower;
  });

  scene.add(level);
  return {
    update(time, camera) {
      animated.forEach((obj) => obj.userData.update(time, camera));
    },
    towerReady,
    addStatues: arena.addStatues,
    // During a boss fight the fog can't be walked through (like Elden Ring).
    setFogGateSolid(solid) {
      gate.blocker.enabled = solid;
    },
    // After the boss dies, the fog disappears for good.
    removeFogGate() {
      gate.blocker.enabled = false;
      gate.fog.visible = false;
    },
    // Put the fog back (when you die and the fight resets).
    restoreFogGate() {
      gate.blocker.enabled = false;
      gate.fog.visible = true;
    },
  };
}

// --- The entrance: a ruined courtyard where you spawn, then a corridor to the gate ---
function buildEntrance(level, rand, glow, animated) {
  const { halfWidth: cw, back, front } = COURTYARD;
  const hw = CORRIDOR.halfWidth;

  // Floors

  // Courtyard walls
  wall(level, -cw, back, cw, back, rand);
  wall(level, -cw, back, -cw, front, rand);
  wall(level, cw, back, cw, front, rand);
  wall(level, -cw, front, -hw, front, rand, { ruined: 0 });
  wall(level, cw, front, hw, front, rand, { ruined: 0 });

  // Corridor walls
  wall(level, -hw, front, -hw, GATE_Z, rand);
  wall(level, hw, front, hw, GATE_Z, rand);

  // Columns: two in the courtyard corners, and a row down each side of the corridor.
  pillar(level, -5.5, 6.5, rand);
  pillar(level, 5.5, 6.5, rand, { broken: true });
  [-9, -14, -19, -24].forEach((z, i) => {
    pillar(level, -4.1, z, rand, { broken: i === 1 });
    pillar(level, 4.1, z, rand, { broken: i === 2 });
  });

  // The Site of Grace, right next to where you spawn.
  const grace = createSiteOfGrace(glow);
  grace.position.set(GRACE.x, 0, GRACE.z);
  level.add(grace);
  animated.push(grace);

  // Fire bowls lighting the way to the gate.
  const braziers = [
    [-5.5, -4.5],
    [5.5, -4.5],
    [-3, -11.5],
    [3, -21.5],
  ];
  braziers.forEach(([x, z]) => {
    const b = createBrazier(glow);
    b.position.set(x, 0, z);
    level.add(b);
    animated.push(b);
    addCircle(x, z, 0.45);
  });

  // Broken stones lying around near the walls.
  rubble(level, 45, rand, {
    minX: -cw + 0.8, maxX: cw - 0.8, minZ: GATE_Z + 1, maxZ: back - 0.8,
    keep: (x, z) => {
      const inCorridor = z < front;
      const limit = inCorridor ? hw - 0.8 : cw - 0.8;
      if (Math.abs(x) > limit) return false;
      return Math.abs(x) > limit - 1.5 || (!inCorridor && z > back - 2); // stay near walls, keep the path clear
    },
  });
}

// --- The stone archway with the fog wall inside it ---
function buildGate(level, glow, animated) {
  const { width, height } = GATE_OPENING;
  const pillarW = 2;
  const x = width / 2 + pillarW / 2;

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(stoneBox(pillarW, height + 0.5, 2.2), wallMaterial);
    post.position.set(side * x, (height + 0.5) / 2, GATE_Z);
    post.castShadow = post.receiveShadow = true;
    level.add(post);
    addBox(post.position.x, GATE_Z, pillarW / 2, 1.1);
    cameraBlockers.push(post);
  }
  const lintel = new THREE.Mesh(stoneBox(width + pillarW * 2 + 0.6, 1.6, 2.6), wallMaterial);
  lintel.position.set(0, height + 0.5 + 0.8, GATE_Z);
  lintel.castShadow = lintel.receiveShadow = true;
  level.add(lintel);
  cameraBlockers.push(lintel);

  const fog = createFogGate(width, height);
  fog.position.set(0, 0, GATE_Z);
  level.add(fog);
  animated.push(fog);

  // An invisible wall in the archway, switched on only during the boss fight.
  const blocker = addBox(0, GATE_Z, width / 2, 0.6);
  blocker.enabled = false;
  return { fog, blocker };
}
