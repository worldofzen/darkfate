// Puts weapons in characters' hands and straps shields to their forearms.
//
// Instead of hand-tuning angles, we work out where the hand is pointing from the
// character's own finger bones (in its resting pose): which way the fingers point,
// which way the thumb side faces, and which way the back of the hand faces.
// Both the knight and the boss use the same skeleton layout, so this works for both.
import * as THREE from 'three';

// Where each weapon's handle is, measured from the model files
// (both swords are modeled tip-down, so y = 0 is the tip).
export const WEAPONS = {
  knightSword: { gripY: 1.1, guardY: 0.97 }, // handle 1.02–1.22, crossguard 0.94–1.00
  bossSword: { gripY: 0.875, guardY: 0.7 }, // handle 0.84–0.92, crossguard 0.66–0.82
};

// Put `weapon` in the right hand, held by the handle with the blade out of the thumb side.
// Call before animations start (it uses the resting pose).
export function equipWeapon(character, weapon, { gripY }) {
  character.updateMatrixWorld(true);
  const hand = handFrame(character, 'r');
  // The crossguard runs along the knuckles; weapon +Y points from the tip to the pommel.
  const xAxis = hand.fingers;
  const yAxis = hand.thumbSide.clone().negate();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
  const rotation = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const handleSize = hand.wrist.distanceTo(hand.knuckles); // scales with the character
  const grip = hand.palm.clone().addScaledVector(hand.back, -0.15 * handleSize);
  const scale = new THREE.Vector3().setFromMatrixScale(hand.bone.matrixWorld);
  const origin = grip.clone().sub(new THREE.Vector3(0, gripY * scale.y, 0).applyMatrix4(rotation));
  attach(weapon, hand.bone, rotation, origin, scale);
}

// Strap `shield` to the left forearm: facing out from the back of the arm, top toward the thumb.
export function equipShield(character, shield) {
  character.updateMatrixWorld(true);
  const hand = handFrame(character, 'l');
  const forearm = character.getObjectByName('lowerarm_l');
  const zAxis = hand.back;
  const yAxis = hand.thumbSide;
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
  const elbow = forearm.getWorldPosition(new THREE.Vector3());
  const handSize = hand.wrist.distanceTo(hand.knuckles);
  const middle = elbow.lerp(hand.wrist, 0.6).addScaledVector(zAxis, 0.6 * handSize);
  const scale = new THREE.Vector3().setFromMatrixScale(forearm.matrixWorld);
  attach(shield, forearm, new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis), middle, scale);
}

// Hold a small item (like the flask) in the left fist, its top (+Y) poking out of the thumb side.
export function holdInLeftHand(character, item) {
  character.updateMatrixWorld(true);
  const hand = handFrame(character, 'l');
  const yAxis = hand.thumbSide;
  const xAxis = hand.fingers;
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
  const handSize = hand.wrist.distanceTo(hand.knuckles);
  const grip = hand.palm.clone().addScaledVector(hand.back, -0.3 * handSize);
  const scale = new THREE.Vector3().setFromMatrixScale(hand.bone.matrixWorld);
  attach(item, hand.bone, new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis), grip, scale);
}

// Directions of one hand in the world, measured in the rest pose.
function handFrame(character, side) {
  const get = (name) => character.getObjectByName(`${name}_${side}`).getWorldPosition(new THREE.Vector3());
  const bone = character.getObjectByName(`hand_${side}`);
  const wrist = get('hand');
  const knuckles = get('middle_01');
  const fingers = knuckles.clone().sub(wrist).normalize();
  const thumbSide = get('index_01').sub(get('pinky_01'));
  thumbSide.addScaledVector(fingers, -thumbSide.dot(fingers)).normalize(); // make it square to the fingers
  const back = new THREE.Vector3().crossVectors(fingers, thumbSide).normalize();
  // Pick the direction that points away from the body (the back of the hand, not the palm).
  const chest = character.getObjectByName('spine_03').getWorldPosition(new THREE.Vector3());
  const outward = wrist.clone().sub(chest);
  outward.y = 0;
  if (back.dot(outward) < 0) back.negate();
  const palm = wrist.clone().lerp(knuckles, 0.55);
  return { bone, wrist, knuckles, fingers, thumbSide, back, palm };
}

// Parent `item` to `bone` so it ends up with the given world rotation, position and size.
function attach(item, bone, rotation, position, scale) {
  const world = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromRotationMatrix(rotation), scale);
  const local = bone.matrixWorld.clone().invert().multiply(world);
  local.decompose(item.position, item.quaternion, item.scale);
  item.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // it moves with the animation
    }
  });
  bone.add(item);
}
