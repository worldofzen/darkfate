// Render layers: which camera draws what.
//
// Shadows are drawn by re-drawing the scene from the light's point of view, and that was most
// of the cost of each frame. A shadow doesn't need a model's fine detail, only its outline, so
// the most detailed models come in two versions:
//   DETAIL  the full-quality model, seen by the main camera only (it casts no shadow)
//   SHADOW  a simplified copy that is never seen, only drawn into the moon's shadow
// Everything else stays on the default layer (0), which every camera sees.
export const LAYERS = { detail: 5, shadow: 3 };

// Models that have a simplified shadow copy saved beside them as models/<name>_shadow.glb.
export const SHADOW_STAND_INS = ['Dungeon_wall', 'Dungeon_Pillar', 'Dungeon_lamp', 'Arena_gate'];

// three.js picks what goes into a shadow by the layers of the camera *looking at the scene*,
// so every shadow would get the full-detail models (and the bonfire's shadow, drawn six
// times, would get everything near it). This makes each light's shadow use the layers of its
// own shadow camera instead: set those on `light.shadow.camera.layers`.
export function useShadowCameraLayers(renderer) {
  const renderShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (lights, scene, camera) => {
    const viewing = camera.layers.mask;
    const byMask = new Map();
    for (const light of lights) {
      const mask = light.shadow.camera.layers.mask;
      if (!byMask.has(mask)) byMask.set(mask, []);
      byMask.get(mask).push(light);
    }
    for (const [mask, group] of byMask) {
      camera.layers.mask = mask;
      renderShadows(group, scene, camera);
    }
    camera.layers.mask = viewing;
  };
}
