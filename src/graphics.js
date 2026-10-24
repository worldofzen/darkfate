// High-quality rendering: everything drawn on top of the basic 3D picture.
//
//   1. Environment light: soft reflections on armor and stone (from a built-in "photo studio" scene).
//   2. Ambient occlusion (GTAO): soft contact shadows where things meet — wall bases, slab gaps, folds.
//   3. Bloom: bright things (fire, the Site of Grace, the flask) glow into their surroundings.
//   4. Tone mapping and colour: film-like contrast, slightly desaturated, vignette and fine grain.
// The picture is drawn with 4x anti-aliasing for smooth edges.
//
// Phones and tablets (MOBILE) get a lighter version: no ambient occlusion and no 4x anti-aliasing.
// Their graphics chips are slower, and their less precise depth buffers make the ambient
// occlusion smear dark patches along the triangles of walls and floors.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// A touch screen as the main pointer, or a phone/tablet browser.
export const MOBILE =
  window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export const LOOK = {
  environment: 0.22, // strength of the soft reflections
  exposure: 1.05,
  bloom: { strength: 0.55, radius: 0.6, threshold: 0.85 },
  ambientOcclusion: { radius: 0.5, intensity: 0.9 },
  saturation: 0.82, // 1 = unchanged
  vignette: 0.42,
  grain: 0.035,
};

// Colour grading, vignette and film grain (runs last, on the finished picture).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    saturation: { value: LOOK.saturation },
    vignette: { value: LOOK.vignette },
    grain: { value: LOOK.grain },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, saturation, vignette, grain;
    varying vec2 vUv;
    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // Cool shadows, warm highlights.
      c += vec3(-0.006, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.35, luma));
      c += vec3(0.02, 0.008, -0.01) * smoothstep(0.5, 1.0, luma);
      // Darker toward the corners.
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d * vec2(1.1, 1.0)) * 1.25);
      // Fine moving film grain.
      c += (rand(vUv * 913.0 + time) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

function addAmbientOcclusion(composer, scene, camera, size) {
  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.blendIntensity = LOOK.ambientOcclusion.intensity;
  ao.updateGtaoMaterial({ radius: LOOK.ambientOcclusion.radius, distanceExponent: 1, thickness: 1, scale: 1 });
  // Glows, sparks, fog and other see-through things must not cast ambient-occlusion shadows
  // (otherwise each glow gets a dark rectangle behind it), so hide them while the AO is worked out.
  const renderAO = ao.render.bind(ao);
  const hidden = [];
  ao.render = (...args) => {
    scene.traverseVisible((o) => {
      if (o.isSprite || o.isPoints || (o.material && o.material.transparent)) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    renderAO(...args);
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  };
  composer.addPass(ao);
}

export function createGraphics(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = LOOK.environment;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: MOBILE ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);

  composer.addPass(new RenderPass(scene, camera));

  if (!MOBILE) addAmbientOcclusion(composer, scene, camera, size);

  const { strength, radius, threshold } = LOOK.bloom;
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), strength, radius, threshold));

  composer.addPass(new OutputPass()); // tone mapping + converting to screen colours

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    render(time) {
      grade.uniforms.time.value = time % 100;
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
  };
}
