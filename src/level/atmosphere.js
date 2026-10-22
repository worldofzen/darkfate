// Floating dust and ash: hundreds of tiny specks drifting slowly through the air.
import * as THREE from 'three';

const COUNT = 900;

export function createDust(glowTexture, bounds) {
  const positions = new Float32Array(COUNT * 3);
  const seeds = [];
  for (let i = 0; i < COUNT; i++) {
    seeds.push({
      x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
      y: 0.3 + Math.random() * 6,
      z: bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ),
      phase: Math.random() * 100,
      speed: 0.1 + Math.random() * 0.25,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: glowTexture,
      color: 0xb8ab94,
      size: 0.05,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  dust.frustumCulled = false;

  dust.userData.update = (time) => {
    const height = 6.3;
    seeds.forEach((s, i) => {
      const t = time * s.speed + s.phase;
      positions[i * 3] = s.x + Math.sin(t * 0.7) * 0.8;
      positions[i * 3 + 1] = 0.3 + ((s.y + time * s.speed * 0.15) % height);
      positions[i * 3 + 2] = s.z + Math.cos(t * 0.5) * 0.8;
    });
    geometry.attributes.position.needsUpdate = true;
  };
  return dust;
}
