// A Site of Grace: a golden glowing point with sparks drifting upward.
// This marks the spawn point (and later, the place you return to when you die).
import * as THREE from 'three';

const GOLD = new THREE.Color(0xffc861);
const SPARKS = 90;

export function createSiteOfGrace(glowTexture) {
  const group = new THREE.Group();
  const glow = { map: glowTexture, color: GOLD, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true };

  // Bright center and a softer halo around it.
  const core = new THREE.Sprite(new THREE.SpriteMaterial(glow));
  core.position.y = 0.9;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...glow, opacity: 0.3 }));
  halo.position.y = 0.9;
  halo.scale.setScalar(2.4);
  group.add(core, halo);

  // Warm pool of light on the ground.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ ...glow, opacity: 0.35 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.03;
  group.add(pool);

  const light = new THREE.PointLight(0xffc861, 8, 10, 2);
  light.position.y = 1;
  group.add(light);

  // Sparks: each one spirals upward, fades out, then starts again at the bottom.
  const positions = new Float32Array(SPARKS * 3);
  const colors = new Float32Array(SPARKS * 3);
  const sparks = Array.from({ length: SPARKS }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 0.1 + Math.random() * 0.5,
    speed: 0.15 + Math.random() * 0.25,
    offset: Math.random(),
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ map: glowTexture, size: 0.09, vertexColors: true, ...glow, color: 0xffffff })
  );
  group.add(points);

  group.userData.update = (time) => {
    const pulse = 1 + 0.08 * Math.sin(time * 2);
    core.scale.setScalar(0.6 * pulse);
    light.intensity = 8 * pulse;

    sparks.forEach((s, i) => {
      const life = (time * s.speed + s.offset) % 1; // 0 = just born, 1 = gone
      const a = s.angle + time * 0.6 + life * 2;
      const r = s.radius * (1 - life * 0.5);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.3 + life * 2.4;
      positions[i * 3 + 2] = Math.sin(a) * r;
      const brightness = Math.sin(life * Math.PI);
      colors[i * 3] = GOLD.r * brightness;
      colors[i * 3 + 1] = GOLD.g * brightness;
      colors[i * 3 + 2] = GOLD.b * brightness;
    });
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  };
  return group;
}
