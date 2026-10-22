// Mist: big, soft, slowly drifting cloud puffs filling the chasm, hugging the arena edge
// and wrapping the base of the tower, so things fade into gloom.
import * as THREE from 'three';

function puffTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Lots of overlapping soft blobs make an irregular cloud.
  for (let i = 0; i < 40; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.5;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.35;
    const r = size * (0.12 + Math.random() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// `groups`: [{ count, center: Vector3, spread: [x, y, z], size: [min, max], opacity }]
export function createMist(groups, color = 0x7d8aa6) {
  const texture = puffTexture();
  const mist = new THREE.Group();
  const puffs = [];
  for (const g of groups) {
    for (let i = 0; i < g.count; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color,
        transparent: true,
        opacity: g.opacity * (0.6 + Math.random() * 0.4),
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const puff = new THREE.Sprite(material);
      const home = g.center.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * g.spread[0],
        (Math.random() - 0.5) * g.spread[1],
        (Math.random() - 0.5) * g.spread[2]
      ));
      puff.position.copy(home);
      puff.scale.setScalar(THREE.MathUtils.randFloat(...g.size));
      mist.add(puff);
      puffs.push({ puff, home, opacity: material.opacity, speed: 0.05 + Math.random() * 0.1, phase: Math.random() * 100, spin: (Math.random() - 0.5) * 0.02 });
    }
  }
  // `camera`: puffs fade away as the camera gets close (otherwise walking into one
  // would wash the whole screen white).
  mist.userData.update = (time, camera) => {
    for (const p of puffs) {
      const t = time * p.speed + p.phase;
      p.puff.position.set(p.home.x + Math.sin(t) * 3, p.home.y + Math.sin(t * 0.7) * 0.6, p.home.z + Math.cos(t * 0.8) * 3);
      p.puff.material.rotation += p.spin * 0.016;
      if (camera) {
        const reach = p.puff.scale.x * 0.6; // about the puff's radius
        const d = p.puff.position.distanceTo(camera.position);
        p.puff.material.opacity = p.opacity * THREE.MathUtils.smoothstep(d, reach * 0.6, reach * 1.6);
      }
    }
  };
  return mist;
}
