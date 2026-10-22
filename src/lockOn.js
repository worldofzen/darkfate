// Lock-on, Elden Ring style.
//
// Press the lock button to lock onto the enemy you're looking toward: a small marker
// appears on it, the camera keeps it in view, and the knight faces it (see player.js).
// The lock lets go when you press the button again, the enemy dies, or it gets too far away.
// Pressing the button with nothing to lock onto just swings the camera behind you.
import * as THREE from 'three';

const MAX_DISTANCE = 25; // can only lock onto enemies closer than this (m)
const BREAK_DISTANCE = 32; // the lock lets go beyond this
const MAX_ANGLE = THREE.MathUtils.degToRad(70); // enemy must be roughly where the camera is looking

function makeMarkerTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.18, 'rgba(255,240,230,1)');
  glow.addColorStop(0.3, 'rgba(220,60,40,0.55)');
  glow.addColorStop(1, 'rgba(160,20,10,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createLockOn(scene, knight) {
  const targets = []; // { point: Object3D to aim at, alive: () => boolean }
  let current = null;
  const position = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  // A small glowing dot that stays the same size on screen and shows through everything.
  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeMarkerTexture(), depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false })
  );
  marker.scale.setScalar(0.035);
  marker.renderOrder = 999;
  marker.visible = false;
  scene.add(marker);

  function pointOf(target) {
    return target.point.getWorldPosition(position);
  }

  // The living enemy closest to where the camera is looking (or null).
  function pick(cameraDirection) {
    let best = null;
    let bestAngle = MAX_ANGLE;
    for (const target of targets) {
      if (!target.alive()) continue;
      toTarget.subVectors(pointOf(target), knight.position);
      if (toTarget.length() > MAX_DISTANCE) continue;
      const angle = toTarget.setY(0).angleTo(new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z));
      if (angle < bestAngle) {
        best = target;
        bestAngle = angle;
      }
    }
    return best;
  }

  return {
    // `point` is the part of the enemy to aim at (e.g. its chest bone); `alive()` says if it can be targeted.
    addTarget(point, alive) {
      targets.push({ point, alive });
    },

    // Lock on (or let go). Returns true if now locked.
    toggle(cameraDirection) {
      current = current ? null : pick(cameraDirection);
      return !!current;
    },

    release() {
      current = null;
    },

    update() {
      if (current && (!current.alive() || pointOf(current).distanceTo(knight.position) > BREAK_DISTANCE)) current = null;
      marker.visible = !!current;
      if (current) marker.position.copy(pointOf(current));
    },

    // Where the locked-on enemy is (a fresh Vector3), or null if not locked.
    get target() {
      return current ? pointOf(current).clone() : null;
    },
  };
}
