// Firelight shadows: the knight and the boss throw flickering shadows from the brazier nearest
// the knight (the bonfire at the Site of Grace has its own, see siteOfGrace.js).
//
// A shadow from a point of fire is drawn six times (once each way: up, down and to four sides),
// so shadowing every brazier would be far too costly. Instead one shadow-casting light stands in
// for the nearest one: it takes that brazier's place, flicker and colour, while the brazier's
// own light is turned off underneath it, so the light on everything stays exactly the same.
// Only the characters (FIRE_SHADOW_LAYER) are drawn into its shadow.
import * as THREE from 'three';
import { FIRE_SHADOW_LAYER } from './siteOfGrace.js';

const SWITCH_CLOSER = 2; // meters: another brazier must be this much nearer before the shadow moves to it
const IN_REACH = 16; // meters: past this, no brazier's shadow would show

export function createFireShadow(scene) {
  const light = new THREE.PointLight(0xff8a3d, 0, 18, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.layers.set(FIRE_SHADOW_LAYER);
  light.shadow.bias = -0.002;
  scene.add(light); // from the start, so the shaders built while loading already include it

  const fires = []; // every brazier's light
  const at = new THREE.Vector3();
  let current = null;

  return {
    // Gather the braziers' lights (call again after more of the level has loaded).
    findFires(root) {
      root.traverse((o) => {
        const fire = o.userData.fireLight;
        if (fire && !fires.includes(fire)) fires.push(fire);
      });
    },
    // After the braziers have flickered this frame. `focus`: the knight's position.
    update(focus) {
      let nearest = current;
      let best = current ? current.getWorldPosition(at).distanceTo(focus) - SWITCH_CLOSER : Infinity;
      for (const fire of fires) {
        const distance = fire.getWorldPosition(at).distanceTo(focus);
        if (distance < best) {
          best = distance;
          nearest = fire;
        }
      }
      current = best < IN_REACH ? nearest : null;
      // (Never hidden: a light coming and going would make every shader be rebuilt, a stutter.
      // Out of reach it just goes dark and stops redrawing its shadow.)
      light.shadow.autoUpdate = !!current;
      if (!current) {
        light.intensity = 0;
        return;
      }
      current.getWorldPosition(light.position);
      light.color.copy(current.color);
      light.intensity = current.intensity;
      light.distance = current.distance;
      current.intensity = 0; // (the brazier sets it again next frame)
    },
  };
}
