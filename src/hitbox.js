// Sword hit detection.
//
// We follow two points on the blade (near the crossguard and the tip) every frame.
// A blade only "cuts" while it's moving fast, which leaves out slow wind-ups and
// follow-throughs. It hits a body (an upright cylinder) if any point along the blade
// passes through it, checking a few in-between positions so a fast swing
// can't skip past the target from one frame to the next.
import * as THREE from 'three';

const POINTS_ALONG_BLADE = 6;
const IN_BETWEEN_STEPS = 4;

// `weapon` is the sword model; `guardY` and `tipY` are heights along it in the model file.
export function createBlade(weapon, { guardY, tipY = 0 }) {
  const base = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const lastBase = new THREE.Vector3();
  const lastTip = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const p = new THREE.Vector3();
  let started = false;
  let speed = 0;

  return {
    // Call once per frame, after the character's animation has been updated.
    update(dt) {
      lastBase.copy(base);
      lastTip.copy(tip);
      weapon.updateWorldMatrix(true, false);
      base.set(0, guardY, 0).applyMatrix4(weapon.matrixWorld);
      tip.set(0, tipY, 0).applyMatrix4(weapon.matrixWorld);
      if (!started) {
        lastBase.copy(base);
        lastTip.copy(tip);
        started = true;
      }
      speed = dt > 0 ? tip.distanceTo(lastTip) / dt : 0;
    },

    // How fast the tip is moving (m/s).
    get speed() {
      return speed;
    },

    // Did the blade pass through `body` ({ position, radius, height }) since last frame?
    hits(body) {
      const r2 = body.radius * body.radius;
      for (let s = 0; s <= IN_BETWEEN_STEPS; s++) {
        const f = s / IN_BETWEEN_STEPS;
        a.lerpVectors(lastBase, base, f);
        b.lerpVectors(lastTip, tip, f);
        for (let i = 0; i <= POINTS_ALONG_BLADE; i++) {
          p.lerpVectors(a, b, i / POINTS_ALONG_BLADE);
          const dx = p.x - body.position.x;
          const dz = p.z - body.position.z;
          if (dx * dx + dz * dz < r2 && p.y > body.position.y && p.y < body.position.y + body.height) return true;
        }
      }
      return false;
    },
  };
}
