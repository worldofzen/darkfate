// High-quality rendering: everything drawn on top of the basic 3D picture.
//
//   1. Environment light: soft reflections on armor and stone (from a built-in "photo studio" scene).
//   2. Ambient occlusion (GTAO): soft contact shadows where things meet — wall bases, slab gaps, folds.
//   3. Bloom: bright things (fire, the Site of Grace, the flask) glow into their surroundings.
//   4. Lens: shafts of moonlight streaming out from the moon through the clouds, and thin
//      horizontal streaks off the brightest lights (like a film camera's lens). Worked out at
//      half resolution, they're soft anyway.
//   5. Tone mapping and colour: film-like contrast, slightly desaturated, a little sharpening,
//      colour fringes toward the edges of the picture, vignette and fine grain.
// The picture is drawn with 4x anti-aliasing for smooth edges.
//
// Phones and tablets (MOBILE) get a lighter version: no ambient occlusion and no 4x anti-aliasing.
// Their graphics chips are slower, and their less precise depth buffers make the ambient
// occlusion smear dark patches along the triangles of walls and floors. They skip the lens too.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// A touch screen as the main pointer, or a phone/tablet browser.
export const MOBILE =
  window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export const LOOK = {
  environment: 0.17, // strength of the soft reflections
  exposure: 1.05,
  bloom: { strength: 0.55, radius: 0.6, threshold: 0.85 },
  ambientOcclusion: { radius: 0.5, intensity: 0.9 },
  shafts: 0.55, // moonlight shafts
  streaks: 0.22, // horizontal lens streaks off bright lights
  sharpen: 0.35,
  fringe: 0.0022, // colour fringing at the picture's edges
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
    sharpen: { value: LOOK.sharpen },
    fringe: { value: LOOK.fringe },
    texel: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, saturation, vignette, grain, sharpen, fringe;
    uniform vec2 texel;
    varying vec2 vUv;
    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      // Colour fringes: red and blue land slightly apart toward the edges, as through a real lens.
      vec2 d = vUv - 0.5;
      vec2 shift = d * dot(d, d) * fringe * 4.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv - shift).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + shift).b);
      // Sharpen: push each pixel away from the average of its neighbours (crisper stone and armor).
      vec3 around = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
                  + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
      c = max(c + (c - around * 0.25) * sharpen, 0.0);
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // Cool shadows, warm highlights.
      c += vec3(-0.006, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.35, luma));
      c += vec3(0.02, 0.008, -0.01) * smoothstep(0.5, 1.0, luma);
      // Darker toward the corners.
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d * vec2(1.1, 1.0)) * 1.25);
      // Fine moving film grain.
      c += (rand(vUv * 913.0 + time) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

// The lens pass: light shafts from the moon and horizontal streaks off bright lights, drawn at
// half resolution and then added on top of the picture (before tone mapping, while bright
// things are still brighter than white).
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    moon: { value: new THREE.Vector2() }, // where the moon is on screen (0..1, may be off it)
    shafts: { value: 0 }, // fades out as the moon leaves the screen
    streaks: { value: LOOK.streaks },
    aspect: { value: 1 },
    texel: { value: new THREE.Vector2() },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 moon, texel;
    uniform float shafts, streaks, aspect;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = vec3(0.0);
      // Shafts: walk from this pixel toward the moon, gathering the bright sky near it (the
      // moon, its halo, moonlit cloud edges). Walls and clouds in the way are dark, so they
      // leave gaps: the beams.
      if (shafts > 0.0) {
        const int STEPS = 28;
        vec2 step = (moon - vUv) * (0.85 / float(STEPS));
        vec2 p = vUv + step * rand(vUv * 731.0); // a random start hides the banding between steps
        float weight = 1.0;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 s = texture2D(tDiffuse, p).rgb;
          float nearMoon = 1.0 - smoothstep(0.0, 0.45, length((p - moon) * vec2(aspect, 1.0)));
          sum += s * smoothstep(0.12, 1.2, dot(s, LUMA)) * nearMoon * weight;
          weight *= 0.95;
          p += step;
        }
        c += sum * vec3(0.8, 0.9, 1.1) * (shafts / float(STEPS));
      }
      // Streaks: spread the brightest lights sideways, fading with distance, a little blue.
      vec3 streak = vec3(0.0);
      for (int i = 1; i <= 12; i++) {
        vec2 o = vec2(texel.x * float(i * i) * 0.9, 0.0);
        vec3 s = texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o).rgb;
        streak += max(s - 1.4, 0.0) * exp(-float(i) * 0.3);
      }
      c += streak * vec3(0.55, 0.7, 1.0) * streaks;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

class LensPass extends Pass {
  constructor(camera, moonDirection) {
    super();
    this.needsSwap = false; // adds onto the picture where it is
    this.camera = camera;
    this.moonDirection = moonDirection.clone().normalize();
    this.lens = new THREE.ShaderMaterial(LensShader);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.add = new THREE.MeshBasicMaterial({ map: this.target.texture, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.lens);
    this.point = new THREE.Vector3();
    this.forward = new THREE.Vector3();
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.target.setSize(w, h);
    this.lens.uniforms.texel.value.set(1 / w, 1 / h);
    this.lens.uniforms.aspect.value = width / height;
  }

  render(renderer, writeBuffer, readBuffer) {
    // Where the moon is on screen. The shafts fade out as it slides off the edge, and are off
    // altogether while it's behind the camera.
    const { camera, point } = this;
    point.copy(this.moonDirection).multiplyScalar(100).add(camera.position).project(camera);
    const facing = this.moonDirection.dot(camera.getWorldDirection(this.forward));
    const off = Math.max(Math.abs(point.x), Math.abs(point.y)) - 1; // > 0: beyond the screen's edge
    const u = this.lens.uniforms;
    u.moon.value.set(point.x * 0.5 + 0.5, point.y * 0.5 + 0.5);
    u.shafts.value = facing > 0 ? LOOK.shafts * (1 - THREE.MathUtils.smoothstep(off, 0, 0.6)) : 0;
    u.tDiffuse.value = readBuffer.texture;

    renderer.setRenderTarget(this.target);
    this.quad.material = this.lens;
    this.quad.render(renderer);

    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // keep the picture underneath
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.material = this.add;
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.target.dispose();
    this.lens.dispose();
    this.add.dispose();
    this.quad.dispose();
  }
}

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

export function createGraphics(renderer, scene, camera, { moonDirection }) {
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

  if (!MOBILE) composer.addPass(new LensPass(camera, moonDirection));

  composer.addPass(new OutputPass()); // tone mapping + converting to screen colours

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const sizeGrade = () => {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    grade.uniforms.texel.value.set(1 / s.x, 1 / s.y);
  };
  sizeGrade();

  return {
    renderTarget: composer.renderTarget1, // where the 3D scene is drawn, before the effects
    render(time) {
      grade.uniforms.time.value = time % 100;
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(width, height);
      sizeGrade();
    },
    // Call after renderer.setPixelRatio (fewer pixels drawn when the game runs slowly).
    setPixelRatio(ratio) {
      composer.setPixelRatio(ratio);
      sizeGrade();
    },
  };
}
