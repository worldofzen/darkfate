// A standing iron fire bowl with a flickering flame.
import * as THREE from 'three';

const iron = new THREE.MeshStandardMaterial({ color: 0x2b2622, metalness: 0.6, roughness: 0.6, side: THREE.DoubleSide });
const coals = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a10, emissiveIntensity: 2 });

// `light: false` makes a brazier that glows but doesn't light up its surroundings.
// Real lights are expensive, so we only give them to the braziers that matter most.
export function createBrazier(glowTexture, { light = true } = {}) {
  const group = new THREE.Group();

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.1, 8), iron);
  post.position.y = 0.55;
  post.castShadow = true;
  group.add(post);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.18, 0.32, 12, 1, true), iron);
  bowl.position.y = 1.2;
  bowl.castShadow = true;
  group.add(bowl);

  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12), coals);
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = 1.3;
  group.add(embers);

  const flameMaterial = { map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false };
  const outer = new THREE.Sprite(new THREE.SpriteMaterial({ ...flameMaterial, color: 0xff6a1a }));
  const inner = new THREE.Sprite(new THREE.SpriteMaterial({ ...flameMaterial, color: 0xffd27a }));
  outer.position.y = 1.7;
  inner.position.y = 1.55;
  group.add(outer, inner);

  // Sparks that float up out of the fire and fade.
  const SPARKS = 16;
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkColors = new Float32Array(SPARKS * 3);
  const sparks = Array.from({ length: SPARKS }, () => ({
    x: (Math.random() - 0.5) * 0.5,
    z: (Math.random() - 0.5) * 0.5,
    speed: 0.25 + Math.random() * 0.35,
    offset: Math.random(),
    sway: Math.random() * 6,
  }));
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  const sparkPoints = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({ ...flameMaterial, size: 0.06, vertexColors: true, transparent: true })
  );
  sparkPoints.frustumCulled = false;
  group.add(sparkPoints);

  let fireLight = null;
  if (light) {
    fireLight = new THREE.PointLight(0xff8a3d, 30, 18, 2);
    fireLight.position.y = 1.9;
    group.add(fireLight);
  }

  const seed = Math.random() * 100;
  group.userData.update = (time) => {
    const flicker = 0.85 + 0.1 * Math.sin(time * 13 + seed) + 0.05 * Math.sin(time * 31 + seed * 2);
    outer.scale.set(1.0 * flicker, 1.5 * flicker, 1);
    inner.scale.set(0.5 * flicker, 0.8 * flicker, 1);
    if (fireLight) fireLight.intensity = 30 * flicker;
    sparks.forEach((e, i) => {
      const life = (time * e.speed + e.offset) % 1;
      sparkPositions[i * 3] = e.x * (1 - life * 0.5) + Math.sin(time * 2 + e.sway) * 0.12 * life;
      sparkPositions[i * 3 + 1] = 1.45 + life * 2.2;
      sparkPositions[i * 3 + 2] = e.z * (1 - life * 0.5) + Math.cos(time * 1.7 + e.sway) * 0.12 * life;
      const glow = (1 - life) * (1 - life) * 3; // bright enough to bloom, fading out as it rises
      sparkColors[i * 3] = glow;
      sparkColors[i * 3 + 1] = glow * 0.38;
      sparkColors[i * 3 + 2] = glow * 0.08;
    });
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;
  };
  return group;
}
