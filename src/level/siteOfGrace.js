// The Site of Grace: a bonfire where you rest (the spawn point, and where you return when you die).
//
//   - charred logs piled crosswise, glowing through the cracks in their bark where they burn
//   - a ring of broken stones round it (the same cracked stones as the rubble, see stones.js)
//   - a bed of embers pulsing among the ash
//   - flames: three layers of animated fire (the same shader as the fire bowls), each with its
//     own rhythm, always turned toward the camera
//   - embers swirling high up on the heat, and smoke rising and spreading above
//   - a warm light that flickers unevenly and casts shadows, so the knight resting beside it
//     throws a long shadow across the flagstones
import * as THREE from 'three';
import { flameVertex, flameFragment, emberFragment, plainVertex, flameGeometry } from './brazier.js';
import { stoneKinds } from './stones.js';
import { brokenStone } from './materials.js';

const RING = { radius: 0.6, stones: 15 };

// The firelight's shadow is drawn six times a frame (a point light looks every way), so only
// what's on this render layer goes into it: the knight resting by the fire (main.js puts him
// on it), the logs and the ring of stones. Everything else still gets lit, just not shadowed.
export const FIRE_SHADOW_LAYER = 2;
const EMBERS = 80;
const SMOKE = 9;

// Bark: dark, deeply furrowed, charred black. The glow map lights up the cracks toward the
// burning end of each log (the bottom of the texture).
function logTextures() {
  const w = 128;
  const h = 512;
  const bark = document.createElement('canvas');
  const glow = document.createElement('canvas');
  bark.width = glow.width = w;
  bark.height = glow.height = h;
  const b = bark.getContext('2d');
  const g = glow.getContext('2d');
  b.fillStyle = '#16100c';
  b.fillRect(0, 0, w, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    // Furrows running along the log.
    let x = Math.random() * w;
    const y0 = Math.random() * h;
    const length = 40 + Math.random() * 200;
    const shade = 18 + Math.random() * 30;
    b.strokeStyle = `rgb(${shade * 1.25}, ${shade}, ${shade * 0.8})`;
    b.lineWidth = 1 + Math.random() * 3;
    b.beginPath();
    b.moveTo(x, y0);
    for (let y = y0; y < y0 + length; y += 8) {
      x += (Math.random() - 0.5) * 3;
      b.lineTo(x, y);
    }
    b.stroke();
  }
  // Charred black patches, mostly at the burning end.
  for (let i = 0; i < 40; i++) {
    const y = h - Math.pow(Math.random(), 1.6) * h * 0.7;
    b.fillStyle = `rgba(6, 4, 3, ${0.5 + Math.random() * 0.5})`;
    b.fillRect(Math.random() * w, y, 6 + Math.random() * 30, 4 + Math.random() * 18);
  }
  // Glowing cracks: a web of short orange lines, denser toward the burning end.
  for (let i = 0; i < 110; i++) {
    const y = h - Math.pow(Math.random(), 2.6) * h * 0.45;
    const x = Math.random() * w;
    const heat = 1 - (h - y) / (h * 0.6);
    g.strokeStyle = `rgb(${255 * heat}, ${120 * heat * heat}, ${30 * heat ** 3})`;
    g.lineWidth = 0.6 + Math.random() * 1.4 * heat;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 22);
    g.stroke();
  }
  const map = new THREE.CanvasTexture(bark);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(glow);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

export function createSiteOfGrace(glowTexture) {
  const group = new THREE.Group();
  const seed = Math.random() * 100;

  // --- The logs ---
  const { map, emissiveMap } = logTextures();
  const logMaterial = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xff5a18, emissiveIntensity: 1.4, roughness: 0.95 });
  // [length, radius, position, rotation]: two lying crosswise, three leaning in over them.
  const logs = [
    [0.95, 0.065, [0, 0.07, 0.04], [0, 0.35, Math.PI / 2 - 0.06]],
    [0.9, 0.06, [0.02, 0.16, -0.02], [0, -0.95, Math.PI / 2 + 0.1]],
    [0.8, 0.055, [0.14, 0.24, 0.08], [0.5, 0.2, 0.75]],
    [0.78, 0.05, [-0.15, 0.22, 0.05], [-0.35, 0.1, -0.8]],
    [0.72, 0.05, [0.0, 0.22, -0.17], [-0.75, 0.0, 0.05]],
  ];
  for (const [length, radius, position, rotation] of logs) {
    const geometry = new THREE.CylinderGeometry(radius * 0.85, radius, length, 12, 6);
    // Knobbly: nudge the bark in and out a little.
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bump = 1 + (Math.sin(pos.getY(i) * 31 + i) * 0.5 + Math.random() - 0.5) * 0.1;
      pos.setX(i, pos.getX(i) * bump);
      pos.setZ(i, pos.getZ(i) * bump);
    }
    geometry.computeVertexNormals();
    const log = new THREE.Mesh(geometry, logMaterial);
    log.position.set(...position);
    log.rotation.set(...rotation);
    log.castShadow = log.receiveShadow = true;
    log.layers.enable(FIRE_SHADOW_LAYER);
    group.add(log);
  }

  // --- The ring of stones ---
  const kinds = stoneKinds(0.035); // a little coarser: these stones are small
  for (let i = 0; i < RING.stones; i++) {
    const a = (i / RING.stones) * Math.PI * 2 + Math.random() * 0.25;
    const kind = kinds[[5, 1, 6, 0, 5][i % 5]]; // boulders and broken blocks
    const stone = new THREE.Mesh(kind.geometry, brokenStone);
    const s = (0.08 + Math.random() * 0.05) / kind.radius;
    stone.scale.set(s, s * (0.7 + Math.random() * 0.4), s);
    stone.position.set(Math.cos(a) * RING.radius, -0.02, Math.sin(a) * RING.radius);
    stone.rotation.y = Math.random() * Math.PI * 2;
    stone.castShadow = stone.receiveShadow = true;
    stone.layers.enable(FIRE_SHADOW_LAYER);
    group.add(stone);
  }

  // --- The ember bed ---
  const emberUniforms = { time: { value: 0 }, seed: { value: seed } };
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.ShaderMaterial({ uniforms: emberUniforms, vertexShader: plainVertex, fragmentShader: emberFragment, transparent: true })
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.015;
  group.add(bed);

  // --- The flames ---
  const flames = [
    { w: 0.85, h: 1.25, brightness: 0.42, x: 0, z: 0 },
    { w: 0.6, h: 1.0, brightness: 0.5, x: 0.1, z: 0.05 },
    { w: 0.5, h: 0.8, brightness: 0.55, x: -0.11, z: -0.04 },
  ].map((f, i) => {
    const uniforms = { time: { value: 0 }, seed: { value: seed + i * 13.7 }, brightness: { value: f.brightness } };
    const mesh = new THREE.Mesh(
      flameGeometry,
      new THREE.ShaderMaterial({ uniforms, vertexShader: flameVertex, fragmentShader: flameFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    mesh.scale.set(f.w, f.h, 1);
    mesh.position.set(f.x, 0.04, f.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    return { mesh, uniforms, base: f };
  });

  // A soft glow round the fire, and warm light pooled on the ground around it.
  const additive = { map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true };
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive, color: new THREE.Color(1.0, 0.42, 0.1), opacity: 0.2 }));
  halo.position.y = 0.55;
  halo.scale.setScalar(1.8);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshBasicMaterial({ ...additive, color: new THREE.Color(0.9, 0.35, 0.08), opacity: 0.12 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  group.add(halo, pool);

  // --- Embers riding the heat: rising fast, slowing and drifting as they cool ---
  const emberPositions = new Float32Array(EMBERS * 3);
  const emberColors = new Float32Array(EMBERS * 3);
  const embers = Array.from({ length: EMBERS }, () => ({
    x: (Math.random() - 0.5) * 0.5,
    z: (Math.random() - 0.5) * 0.5,
    speed: 0.18 + Math.random() * 0.3,
    rise: 2 + Math.random() * 3.5,
    drift: (Math.random() - 0.3) * 1.2, // the breeze carries most of them one way
    swirl: 0.1 + Math.random() * 0.3,
    phase: Math.random() * 6.28,
    offset: Math.random(),
  }));
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  emberGeometry.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));
  const emberPoints = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ ...additive, size: 0.045, vertexColors: true }));
  emberPoints.frustumCulled = false;
  group.add(emberPoints);

  // --- Smoke: dim puffs rising from the flames, spreading and fading high up ---
  const smoke = Array.from({ length: SMOKE }, (_, i) => {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0 }));
    puff.renderOrder = 1;
    group.add(puff);
    return { puff, offset: i / SMOKE, drift: Math.random() * 6.28 };
  });

  // --- The firelight ---
  const light = new THREE.PointLight(0xff7a2e, 13, 16, 2);
  light.position.y = 0.75;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.layers.set(FIRE_SHADOW_LAYER);
  light.shadow.bias = -0.002;
  light.shadow.radius = 4;
  group.add(light);

  // Uneven flicker: several unrelated wobbles added up, with the odd sudden dip.
  const flickerAt = (t) =>
    0.82 + 0.08 * Math.sin(t * 9.3 + seed) + 0.06 * Math.sin(t * 17.7 + seed * 1.3) + 0.04 * Math.sin(t * 31.1 + seed * 2.1) -
    0.08 * Math.max(0, Math.sin(t * 2.3 + seed * 0.7)) ** 8;

  group.userData.update = (time) => {
    const flicker = flickerAt(time);
    emberUniforms.time.value = time;
    for (const f of flames) {
      f.uniforms.time.value = time;
      f.mesh.scale.y = f.base.h * (0.88 + 0.18 * flicker);
    }
    logMaterial.emissiveIntensity = 0.9 + 0.8 * flicker;
    halo.material.opacity = 0.14 + 0.08 * flicker;
    pool.material.opacity = 0.08 + 0.05 * flicker;
    light.intensity = 13 * flicker;
    light.color.setRGB(1, 0.46 + 0.06 * flicker, 0.17 + 0.04 * flicker);
    light.position.x = Math.sin(time * 7.1 + seed) * 0.04; // the shadows shiver as the flames move
    light.position.z = Math.cos(time * 5.3 + seed) * 0.04;

    embers.forEach((e, i) => {
      const life = (time * e.speed + e.offset) % 1;
      const height = e.rise * (1 - (1 - life) ** 2); // fast off the fire, slowing as it cools
      const swirl = e.swirl * life;
      emberPositions[i * 3] = e.x * (1 - life * 0.5) + Math.sin(time * 2.7 + e.phase + life * 7) * swirl + e.drift * life * life;
      emberPositions[i * 3 + 1] = 0.25 + height;
      emberPositions[i * 3 + 2] = e.z * (1 - life * 0.5) + Math.cos(time * 2.2 + e.phase + life * 7) * swirl;
      const glow = (1 - life) ** 1.5 * 3.2 * (0.55 + 0.45 * Math.sin(time * 18 + e.phase)); // twinkling, dimming as it cools
      emberColors[i * 3] = glow;
      emberColors[i * 3 + 1] = glow * (0.25 + 0.25 * (1 - life));
      emberColors[i * 3 + 2] = glow * 0.05;
    });
    emberGeometry.attributes.position.needsUpdate = true;
    emberGeometry.attributes.color.needsUpdate = true;

    for (const p of smoke) {
      const life = (time * 0.09 + p.offset) % 1;
      p.puff.position.set(Math.sin(time * 0.3 + p.drift) * 0.3 * life + life * life * 0.8, 1.0 + life * 4.5, Math.cos(time * 0.25 + p.drift) * 0.3 * life);
      p.puff.scale.setScalar(0.8 + life * 3.5);
      p.puff.material.opacity = 0.28 * Math.sin(life * Math.PI) * (1 - life * 0.5);
      p.puff.material.rotation = p.drift + life * 1.5;
    }
  };
  return group;
}
