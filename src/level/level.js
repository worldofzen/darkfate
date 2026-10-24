// Builds the whole level: the entrance (where you spawn), the fog gate, the boss arena
// (see arena.js) and the tower looming behind it.
import * as THREE from 'three';
import { seededRandom, makeGlowTexture } from './textures.js';
import { wall, pillar, rubble } from './ruins.js';
import { buildArena } from './arena.js';
import { createBrazier } from './brazier.js';
import { createSiteOfGrace } from './siteOfGrace.js';
import { createFogGate } from './fogGate.js';
import { addBox, addCircle, cameraBlockers } from './colliders.js';
import { GRACE, COURTYARD, CORRIDOR, GATE_Z, ARENA, BRIDGE, TOWER_Z } from './layout.js';

export function buildLevel(scene, loadModel) {
  const level = new THREE.Group();
  const animated = []; // things that move every frame (fire, sparks, fog)
  const rand = seededRandom(42);
  const glow = makeGlowTexture();

  // The stone floor of the courtyard and corridor (the dirt outside is laid by the arena builder).
  const { halfWidth: cw, back, front } = COURTYARD;
  const hw = CORRIDOR.halfWidth;
  const isPaved = (x, z) =>
    (Math.abs(x) < cw + 0.3 && z > front - 0.3 && z < back + 0.3) || // courtyard
    (Math.abs(x) < hw + 0.3 && z > GATE_Z - 0.4 && z <= front); // corridor (the walkway is a model)
  buildFloor(level, seededRandom(7), loadModel);

  buildEntrance(level, rand, glow, animated, loadModel);
  const gate = buildGate(level, glow, animated, loadModel);
  buildArena(level, rand, glow, animated, isPaved, loadModel);

  // The tower looms far behind the arena, rising out of the mist.
  const towerReady = loadModel('models/BOSS_tower.glb').then((tower) => {
    tower.scale.setScalar(1.8); // big enough to loom well above the arena walls
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

// --- The floor: tiles of the Dungeon_floor.glb model (flagstones with grass in the cracks) ---
// A grid of tiles over the courtyard and another down the corridor. Each tile gets a random
// quarter turn, so the pattern doesn't visibly repeat. The model's top is flat (within about
// 2 cm), so it sits with its top at floor level and you simply walk on it.
const FLOOR_TILE = { size: 0.98, topY: 0.0512 }; // measured on the model
function buildFloor(level, rand, loadModel) {
  const { halfWidth: cw, back, front } = COURTYARD;
  const hw = CORRIDOR.halfWidth;
  const areas = [
    { minX: -cw, maxX: cw, minZ: front, maxZ: back, cols: 4, rows: 4 }, // courtyard: 3.75 m tiles
    { minX: -hw, maxX: hw, minZ: GATE_Z - 0.3, maxZ: front, cols: 3, rows: 5 }, // corridor
  ];
  loadModel('models/Dungeon_floor.glb').then((source) => {
    for (const a of areas) {
      const w = (a.maxX - a.minX) / a.cols;
      const d = (a.maxZ - a.minZ) / a.rows;
      for (let i = 0; i < a.cols; i++) {
        for (let k = 0; k < a.rows; k++) {
          const tile = source.clone();
          const turn = Math.floor(rand() * 4);
          const [along, across] = turn % 2 ? [d, w] : [w, d]; // a quarter turn swaps width and depth
          const thick = (w + d) / 2 / FLOOR_TILE.size;
          tile.scale.set((along / FLOOR_TILE.size) * 1.01, thick, (across / FLOOR_TILE.size) * 1.01); // 1% overlap hides seams
          tile.rotation.y = (turn * Math.PI) / 2;
          tile.position.set(a.minX + (i + 0.5) * w, -FLOOR_TILE.topY * thick, a.minZ + (k + 0.5) * d);
          tile.traverse((o) => {
            if (o.isMesh) o.castShadow = false; // it only receives shadows
          });
          level.add(tile);
        }
      }
    }
  });
}

// --- The entrance: a ruined courtyard where you spawn, then a corridor to the gate ---
function buildEntrance(level, rand, glow, animated, loadModel) {
  const { halfWidth: cw, back, front } = COURTYARD;
  const hw = CORRIDOR.halfWidth;

  // Floors

  // Walls: arcaded sections of the Dungeon_wall.glb model, arches facing inward.
  const wallModel = loadModel('models/Dungeon_wall.glb');
  const courtyard = { inside: [0, (back + front) / 2] };
  const corridor = { inside: [0, (front + GATE_Z) / 2] };
  wall(level, -cw, back, cw, back, rand, wallModel, courtyard);
  wall(level, -cw, back, -cw, front, rand, wallModel, courtyard);
  wall(level, cw, back, cw, front, rand, wallModel, courtyard);
  wall(level, -cw, front, -hw, front, rand, wallModel, courtyard);
  wall(level, cw, front, hw, front, rand, wallModel, courtyard);
  wall(level, -hw, front, -hw, GATE_Z, rand, wallModel, corridor);
  wall(level, hw, front, hw, GATE_Z, rand, wallModel, corridor);

  // Carved pillars: two in the courtyard corners, and a row down each side of the corridor.
  const pillarModel = loadModel('models/Dungeon_Pillar.glb');
  pillar(level, -5.5, 6.5, rand, pillarModel);
  pillar(level, 5.5, 6.5, rand, pillarModel);
  [-9, -14, -19, -24].forEach((z) => {
    pillar(level, -3.75, z, rand, pillarModel);
    pillar(level, 3.75, z, rand, pillarModel);
  });

  // The Site of Grace: a bonfire, right in front of where you spawn (you can't walk into it).
  const grace = createSiteOfGrace(glow);
  grace.position.set(GRACE.x, 0, GRACE.z);
  level.add(grace);
  animated.push(grace);
  addCircle(GRACE.x, GRACE.z, 0.75);

  // Stone fire bowls (Dungeon_lamp.glb) lighting the way to the gate.
  const lampModel = loadModel('models/Dungeon_lamp.glb');
  const braziers = [
    [-5.5, -4.5],
    [5.5, -4.5],
    [-3, -11.5],
    [3, -21.5],
  ];
  braziers.forEach(([x, z]) => {
    const b = createBrazier(glow, { model: lampModel, height: 1.6 });
    b.position.set(x, 0, z);
    level.add(b);
    animated.push(b);
    addCircle(x, z, 0.6);
  });

  // Broken stones lying around near the walls.
  const inTheWay = [...braziers, [-5.5, 6.5], [5.5, 6.5], ...[-9, -14, -19, -24].flatMap((z) => [[-3.75, z], [3.75, z]])];
  rubble(level, 30, rand, {
    minX: -cw + 0.8, maxX: cw - 0.8, minZ: GATE_Z + 1, maxZ: back - 0.8,
    keep: (x, z) => {
      if (inTheWay.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.3)) return false; // clear of pillars and fire bowls
      if (Math.hypot(x - GRACE.x, z - GRACE.z) < 1.5) return false;
      const inCorridor = z < front;
      const limit = inCorridor ? hw - 0.8 : cw - 0.8;
      if (Math.abs(x) > limit) return false;
      return Math.abs(x) > limit - 1.5 || (!inCorridor && z > back - 2); // stay near walls, keep the path clear
    },
  });
}

// --- The gateway (Arena_gate.glb) with the fog wall inside its arch ---
// Measured on the model, in its own units: its width and depth, the floor of the passage
// through it, and the opening (straight sides up to `spring`, then a half circle on top).
const GATE_MODEL = { width: 0.86, depth: 0.365, top: 0.49, floorY: -0.432, halfWidth: 0.2, spring: 0.1 };
const GATE_SCALE = 11.7; // fills one bay of the colosseum, about 10 m wide and 11.5 m tall
function buildGate(level, glow, animated, loadModel) {
  const s = GATE_SCALE;
  const lift = -GATE_MODEL.floorY * s + 0.02; // the passage floor just above the ground
  const opening = { halfWidth: GATE_MODEL.halfWidth * s, spring: (GATE_MODEL.spring - GATE_MODEL.floorY) * s };
  const crown = opening.spring + opening.halfWidth;
  const outer = (GATE_MODEL.width / 2) * s;
  const halfDepth = (GATE_MODEL.depth / 2) * s;

  loadModel('models/Arena_gate.glb').then((model) => {
    model.scale.setScalar(s);
    model.position.set(0, lift, GATE_Z);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    level.add(model);
  });

  // The two sides of the gateway are solid; the camera bumps into simple invisible boxes
  // (much faster than the detailed model).
  const side = outer - opening.halfWidth;
  const height = (GATE_MODEL.top - GATE_MODEL.floorY) * s;
  const box = (w, h, x, y) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, halfDepth * 2));
    mesh.position.set(x, y, GATE_Z);
    mesh.visible = false;
    level.add(mesh);
    cameraBlockers.push(mesh);
  };
  for (const sign of [-1, 1]) {
    const x = sign * (opening.halfWidth + side / 2);
    addBox(x, GATE_Z, side / 2, halfDepth);
    box(side, height, x, height / 2);
  }
  box(opening.halfWidth * 2, height - crown, 0, (height + crown) / 2); // above the arch

  const fog = createFogGate(opening, glow);
  fog.position.set(0, 0, GATE_Z);
  level.add(fog);
  animated.push(fog);

  // An invisible wall in the archway, switched on only during the boss fight.
  const blocker = addBox(0, GATE_Z, opening.halfWidth, 0.6);
  blocker.enabled = false;
  return { fog, blocker };
}
