// The Flask of Crimson Tears: a small glass bottle of glowing red liquid, built from simple
// shapes (no model file needed). Its origin is where the hand grips it and +Y points to the cork.
import * as THREE from 'three';

// Half the outline of a round-bottomed bottle with a neck (x = radius, y = height), in meters.
const BOTTLE = [
  [0, -0.06], [0.03, -0.057], [0.045, -0.04], [0.048, -0.01], [0.04, 0.02],
  [0.022, 0.035], [0.014, 0.045], [0.014, 0.075], [0.018, 0.08], [0, 0.08],
];

export function createFlask() {
  const flask = new THREE.Group();
  const outline = (scale) => BOTTLE.map(([x, y]) => new THREE.Vector2(x * scale, y));

  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(outline(1), 20),
    new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 })
  );
  const liquid = new THREE.Mesh(
    new THREE.LatheGeometry(outline(0.85).filter((p) => p.y < 0.03), 20),
    new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0xc8141e, emissiveIntensity: 1.6, roughness: 0.3 })
  );
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.025, 10),
    new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 })
  );
  cork.position.y = 0.09;
  // A faint red glow on the knight's hand and face while drinking. It stays in the scene (just
  // dark) while the bottle is put away: the number of lights is built into every material's
  // shader, so a light coming and going would make them all rebuild (a freeze on the first sip).
  const glow = new THREE.PointLight(0xff2a1a, 0, 1.5, 2);
  const bottle = new THREE.Group();
  bottle.add(glass, liquid, cork);
  flask.add(bottle, glow);

  bottle.visible = false;
  flask.userData.show = (shown) => {
    bottle.visible = shown;
  };
  flask.userData.setGlow = (amount) => {
    glow.intensity = amount * 0.4;
    liquid.material.emissiveIntensity = 1.6 + amount * 2;
  };
  return flask;
}
