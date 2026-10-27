// The storm: a sky buried under heavy, churning storm cloud (no stars; the moon only a pale
// smudge where the deck thins), misty mountain ranges along the horizon, lightning that lights
// the clouds up from inside and the ruins below, and thunder that rolls in a moment later
// (sound made in code).
//
// The clouds are real 3D volumes: for each direction in the sky, a ray steps up through a
// thick layer of cloud (a kilometre deep, built from tiling 3D noise) and adds up how much
// cloud it passes and how it's lit. That's too much work to do for every pixel on screen, so
// it's worked out into a panorama of the sky (`cloudTarget`), a quarter of it each frame, and
// the sky dome looks up each pixel there. The panorama keeps the light from each source
// separately (dim overall light, light from above, and light from inside where lightning
// flashes), so a flash can light it instantly, anywhere, without working the clouds out again.
import * as THREE from 'three';
import { ARENA } from './layout.js';
import { MOBILE } from '../graphics.js';

export const STORM = {
  strikeEvery: [4, 9], // seconds between lightning strikes (random in this range)
  flickerEvery: [0.8, 3], // seconds between silent flickers deep in the clouds
  distance: [140, 280], // how far away strikes are (m); thunder arrives later from further away
  thunderVolume: 0.55,
  windVolume: 0.05,
  wind: [0.0035, 0.0012], // how fast the cloud drifts (noise tiles per second)
  panorama: MOBILE ? [1024, 256] : [2048, 512], // size of the worked-out sky (texels)
  slices: 4, // the panorama is redone a quarter at a time (one quarter per frame)
};

// --- Cloud noise: a 64x64x64 block of billowy noise that tiles in every direction ---
// Rounded "cauliflower" lumps (inverted Worley noise: bright at the centre of each cell)
// mixed with smooth value noise, at a few sizes.
function makeCloudNoise(size = 64) {
  let seed = 1337;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const wrap = (i, n) => ((i % n) + n) % n;

  function worleyField(cells) {
    const points = new Float32Array(cells ** 3 * 3).map(random);
    return (x, y, z) => {
      const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
      let best = 9;
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const n = (wrap(cx + i, cells) + wrap(cy + j, cells) * cells + wrap(cz + k, cells) * cells * cells) * 3;
        const dx = cx + i + points[n] - x, dy = cy + j + points[n + 1] - y, dz = cz + k + points[n + 2] - z;
        best = Math.min(best, dx * dx + dy * dy + dz * dz);
      }
      return Math.min(1, Math.sqrt(best));
    };
  }
  function valueField(cells) {
    const values = new Float32Array(cells ** 3).map(random);
    const at = (x, y, z) => values[wrap(x, cells) + wrap(y, cells) * cells + wrap(z, cells) * cells * cells];
    const ease = (t) => t * t * (3 - 2 * t);
    return (x, y, z) => {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const fx = ease(x - ix), fy = ease(y - iy), fz = ease(z - iz);
      const lerp = (a, b, t) => a + (b - a) * t;
      return lerp(
        lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), fx), lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), fx), fy),
        lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), fx), lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), fx), fy),
        fz
      );
    };
  }

  const lumps = [worleyField(4), worleyField(8), worleyField(16)];
  const smooth = [valueField(4), valueField(8), valueField(16)];
  const data = new Uint8Array(size ** 3);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size, w = (z + 0.5) / size;
    let billow = 0;
    let soft = 0;
    [4, 8, 16].forEach((cells, i) => {
      const weight = [0.6, 0.28, 0.12][i];
      billow += weight * (1 - lumps[i](u * cells, v * cells, w * cells));
      soft += weight * smooth[i](u * cells, v * cells, w * cells);
    });
    const value = THREE.MathUtils.clamp(billow * 0.65 + soft * 0.45 - 0.08, 0, 1);
    data[x + y * size + z * size * size] = value * 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

// --- Working out the clouds (into the sky panorama) ---
// Across the panorama: all the way round (compass direction); up it: from just below the
// horizon to straight up. For each texel: red = cloud lit by the dull storm light, green =
// lit from above (where the moon shines on the top of the deck), blue = lit from within
// (what a lightning flash inside the cloud lights up), alpha = how much sky shows through.
const cloudVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const cloudFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D noise;
  uniform float time;
  uniform vec2 wind;
  varying vec2 vUv;

  const float BASE = 420.0;  // the cloud deck's underside (m above you)
  const float TOP = 1700.0;  // and its top
  const float FAR = 14000.0; // nothing further than this

  float height01(vec3 p) { return clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0); }

  // How thick the cloud is at p: big rolling billows, a flat-ish base, lumpy tops, with
  // smaller lumps eating at the edges. Mostly covered, as a storm should be.
  float density(vec3 p) {
    vec3 q = p / 2300.0;
    q.xz += wind * time;
    float h = height01(p);
    float shape = texture(noise, q).r * 0.75 + texture(noise, q * 0.31 + 0.37).r * 0.45;
    float profile = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.5, 1.0, h));
    float d = shape * profile - 0.42 - 0.2 * h;
    if (d <= 0.0) return 0.0;
    float detail = texture(noise, q * 5.3 + vec3(0.0, time * 0.003, 0.0)).r;
    return max(0.0, d - detail * 0.16) * 7.0;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    float compass = (vUv.x - 0.5) * 6.2831853;
    float up = mix(-0.05, 1.0, vUv.y);
    float across = sqrt(max(0.0, 1.0 - up * up));
    vec3 dir = vec3(sin(compass) * across, up, cos(compass) * across);
    float rise = max(dir.y, 0.015);
    float t0 = min(BASE / rise, FAR);
    float t1 = min(min(TOP / rise, t0 + 7000.0), FAR);
    if (t0 >= FAR) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    const int STEPS = ${MOBILE ? 24 : 40};
    float dt = (t1 - t0) / float(STEPS);
    float t = t0 + dt * hash(vUv * 917.0); // a random start in each texel hides the steps
    float clear = 1.0;
    vec3 light = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = dir * t;
      float d = density(p);
      if (d > 0.0) {
        float h = height01(p);
        float above = density(p + vec3(0.0, 140.0, 0.0));
        float below = density(p - vec3(0.0, 110.0, 0.0));
        float a = 1.0 - exp(-d * dt * 0.006);
        light += clear * a * vec3(
          0.3 + 0.7 * h,                  // dull light: darkest underneath
          exp(-above * 7.0) * (0.15 + 1.2 * h), // lit from above: bright tops, dark folds
          exp(-below * 3.0) * (1.0 - 0.6 * h) // lit from within: bright billowing undersides
        );
        clear *= 1.0 - a;
        if (clear < 0.02) break;
      }
      t += dt;
    }
    // Far-off cloud fades into the haze near the horizon.
    float haze = 1.0 - exp(-t0 / 9000.0);
    gl_FragColor = vec4(light * (1.0 - haze), mix(clear, 1.0, haze * 0.6));
  }
`;

// --- The sky dome ---
const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler2D clouds;
  uniform sampler3D noise;
  uniform vec3 horizon, zenith, moonDir, flashDir, glowDir;
  uniform float time, flash, glow;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise2(p); p = turn * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  // A mountain range along the horizon: its height at each compass angle.
  float range(float angle, float scale, float seed) {
    return fbm(vec2(angle * scale, seed)) * 0.7 + fbm(vec2(angle * scale * 4.0, seed + 3.0)) * 0.3;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    float m = max(dot(d, moonDir), 0.0);

    // Behind the cloud: a dark sky, a little paler toward the horizon and round the hidden moon.
    vec3 behind = mix(horizon * 1.5, zenith, pow(up, 0.5));
    behind += vec3(0.06, 0.07, 0.09) * pow(m, 8.0) + vec3(0.12, 0.13, 0.15) * pow(m, 90.0);

    // The worked-out clouds for this direction (see cloudFragment).
    float compass = atan(d.x, d.z);
    vec2 at = vec2(compass / 6.2831853 + 0.5, (d.y + 0.05) / 1.05);
    vec4 cloud = texture2D(clouds, at);
    // Fine wisps, too small for the panorama, drawn straight onto the dome.
    vec2 plane = d.xz / (d.y + 0.08);
    float wisp = texture(noise, vec3(plane * 0.35 + time * vec2(0.0035, 0.0012) * 3.0, time * 0.002)).r;
    float fine = 0.7 + 0.6 * wisp;

    vec3 dull = vec3(0.012, 0.014, 0.02);                                  // the gloom under the storm
    vec3 fromAbove = vec3(0.075, 0.082, 0.1) * (1.0 + 5.0 * pow(m, 6.0)); // silvered round the moon
    vec3 c = behind * cloud.a + (cloud.r * dull + cloud.g * fromAbove) * fine;

    // Lightning lights the clouds from inside: brightest round the strike, spreading through
    // the whole deck. Silent flickers light up one patch somewhere else.
    vec3 cold = vec3(0.62, 0.68, 0.95);
    float near = pow(max(dot(d, flashDir), 0.0), 4.0);
    c += cold * flash * (cloud.b * (0.25 + 3.2 * near) + cloud.r * 0.25 + (1.0 - cloud.a) * 0.05) * fine;
    float glowNear = pow(max(dot(d, glowDir), 0.0), 14.0);
    c += cold * glow * glowNear * cloud.b * 2.2 * fine;

    // Haze toward the horizon, with a faint ember-red glow far off, as if distant lands burned.
    c = mix(c, horizon * 1.7, (1.0 - smoothstep(0.0, 0.14, up)) * 0.65);
    c += vec3(0.03, 0.008, 0.005) * pow(1.0 - up, 10.0);

    // Two ranges of mountains: a far, pale one half lost in the haze, and a nearer, darker one,
    // with mist pooled in the valleys between. Lightning shows their outlines for a moment.
    float angle = atan(d.x, d.z);
    float farRidge = 0.035 + 0.11 * range(angle, 2.2, 1.7);
    float nearRidge = 0.01 + 0.075 * range(angle, 3.4, 8.3);
    if (d.y < farRidge) {
      vec3 far = horizon * 1.3 + cold * 0.03 * flash;
      c = mix(far, c, smoothstep(farRidge - 0.004, farRidge, d.y) * 0.6);
      c = mix(c, horizon * 1.8, (1.0 - smoothstep(0.0, 0.05, d.y)) * 0.55);
    }
    if (d.y < nearRidge) {
      vec3 nearRock = horizon * 0.5 + cold * 0.02 * flash;
      c = mix(nearRock, c, smoothstep(nearRidge - 0.003, nearRidge, d.y) * 0.5);
      c = mix(c, horizon * 1.4, (1.0 - smoothstep(-0.02, 0.03, d.y)) * 0.6); // valley mist
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

// --- Thunder and wind, made with the Web Audio API (no sound files) ---
function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02; // "brown" noise: deep and rumbly
    data[i] = brown * 3.5;
  }
  return buffer;
}

// Wind goes to the mixer's ambience channel and thunder to its effects channel (see audio.js).
function createSound(mixer) {
  const { ctx } = mixer;
  const rumble = noiseBuffer(ctx, 6);

  // Wind: quiet rumbly noise, slowly swelling and fading.
  const wind = ctx.createBufferSource();
  wind.buffer = rumble;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 420;
  windFilter.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = STORM.windVolume;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = STORM.windVolume * 0.7;
  lfo.connect(lfoGain).connect(windGain.gain);
  wind.connect(windFilter).connect(windGain).connect(mixer.ambience);
  wind.start();
  lfo.start();

  return {
    // A close strike cracks sharply; a far one is a low, long rumble.
    thunder(closeness) {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = rumble;
      source.playbackRate.value = 0.7 + Math.random() * 0.3;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300 + 1400 * closeness, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + 3.5);
      const gain = ctx.createGain();
      const peak = STORM.thunderVolume * (0.4 + 0.6 * closeness);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.05 + (1 - closeness) * 0.4);
      gain.gain.exponentialRampToValueAtTime(peak * 0.5, now + 1.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);
      source.connect(filter).connect(gain).connect(mixer.effects);
      source.start(now, Math.random() * 1.5);
      source.stop(now + 6);
    },
  };
}


// --- The storm ---
// `renderer` works out the clouds (see cloudFragment).
export function createStorm(scene, { horizonColor, moonDirection, renderer }) {
  const noise = makeCloudNoise();
  const [width, height] = STORM.panorama;
  const cloudTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, // all the way round, so the seam joins up
    depthBuffer: false,
  });
  const cloudUniforms = {
    noise: { value: noise },
    time: { value: 0 },
    wind: { value: new THREE.Vector2(...STORM.wind) },
  };
  const cloudScene = new THREE.Scene();
  const cloudQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: cloudUniforms, vertexShader: cloudVertex, fragmentShader: cloudFragment, depthTest: false, depthWrite: false })
  );
  cloudQuad.frustumCulled = false;
  cloudScene.add(cloudQuad);
  const cloudCamera = new THREE.OrthographicCamera();
  let slice = 0;
  let filled = false;

  // Redo one slice of the panorama (or all of it, the first time).
  function workOutClouds(time) {
    cloudUniforms.time.value = time;
    const previous = renderer.getRenderTarget();
    const sliceWidth = Math.ceil(width / STORM.slices);
    const count = filled ? 1 : STORM.slices;
    for (let i = 0; i < count; i++) {
      cloudTarget.scissor.set(slice * sliceWidth, 0, sliceWidth, height);
      cloudTarget.scissorTest = true;
      renderer.setRenderTarget(cloudTarget);
      renderer.render(cloudScene, cloudCamera);
      slice = (slice + 1) % STORM.slices;
    }
    filled = true;
    renderer.setRenderTarget(previous);
  }

  const uniforms = {
    clouds: { value: cloudTarget.texture },
    noise: { value: noise },
    horizon: { value: new THREE.Color(horizonColor) },
    zenith: { value: new THREE.Color(0x04060d) },
    moonDir: { value: moonDirection.clone().normalize() },
    flashDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    time: { value: 0 },
    flash: { value: 0 },
    glow: { value: 0 },
    glowDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 64, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  // The sky always surrounds the camera, so it's never further away than the camera can see.
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };
  scene.add(sky);

  // The flash itself: a cold light from the sky, and a jagged bolt in the distance. The bolt
  // is made of thin glowing rods (white-hot, so the bloom haloes them), brightest where it
  // meets the ground and fading as it climbs back into the cloud. It's always in the scene
  // (just empty between strikes), so its shader is built while the game loads.
  const light = new THREE.DirectionalLight(0xc8d6ff, 0);
  scene.add(light, light.target);
  const MAX_RODS = 200;
  const rodGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const bolt = new THREE.InstancedMesh(
    rodGeometry,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7.5, 11), fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAX_RODS
  );
  bolt.count = 0;
  bolt.frustumCulled = false;
  bolt.setColorAt(0, new THREE.Color(1, 1, 1)); // (so it has per-rod brightness from the start)
  scene.add(bolt);

  const rod = new THREE.Object3D();
  const along = new THREE.Vector3();
  const shade = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  function addRod(a, b, radius, brightness) {
    if (bolt.count >= MAX_RODS) return;
    along.subVectors(b, a);
    rod.position.copy(a).addScaledVector(along, 0.5);
    rod.quaternion.setFromUnitVectors(Y, along.clone().normalize());
    rod.scale.set(radius, along.length(), radius);
    rod.updateMatrix();
    bolt.setMatrixAt(bolt.count, rod.matrix);
    bolt.setColorAt(bolt.count, shade.setScalar(brightness));
    bolt.count++;
  }

  // A jagged channel from the cloud base down to the ground, with forked side branches. Its
  // thickness grows with distance, so it stays a few pixels wide (thinner than a pixel, it
  // would break up into dashes).
  function makeBolt(from, to, distance) {
    const thick = Math.max(0.55, distance * 0.004);
    bolt.count = 0;
    const steps = 26;
    let p = from.clone();
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const next = from.clone().lerp(to, k).add(new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 16));
      const brightness = Math.min(1, 0.15 + k * 1.4); // fading up into the cloud
      addRod(p, next, thick, brightness);
      if (Math.random() < 0.3 && k < 0.85) {
        let b = next.clone();
        const sideways = new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize();
        const length = 3 + Math.floor(Math.random() * 4);
        for (let j = 0; j < length; j++) {
          const bn = b.clone().addScaledVector(sideways, 6 + Math.random() * 8).add(new THREE.Vector3((Math.random() - 0.5) * 8, -6 - Math.random() * 8, (Math.random() - 0.5) * 8));
          addRod(b, bn, thick * 0.5, brightness * (1 - j / length) * 0.8);
          b = bn;
        }
      }
      p = next;
    }
    bolt.instanceMatrix.needsUpdate = true;
    bolt.instanceColor.needsUpdate = true;
  }

  let sound = null;
  let nextStrike = 3;
  let strike = null; // { start, closeness, thunderAt }
  let nextFlicker = 1.5;
  let flicker = null; // { start, strength }

  function startStrike(time) {
    // Mostly somewhere ahead of the arena (toward -Z), so you see it over the tower.
    const azimuth = Math.PI + (Math.random() - 0.5) * 2.6;
    const distance = THREE.MathUtils.randFloat(...STORM.distance);
    const ground = new THREE.Vector3(Math.sin(azimuth) * distance, 0, ARENA.z + Math.cos(azimuth) * distance);
    const top = ground.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 230, (Math.random() - 0.5) * 60));
    uniforms.flashDir.value.copy(top).setY(top.y * 0.8).sub(new THREE.Vector3(0, 0, ARENA.z)).normalize();
    light.position.copy(top);
    light.target.position.set(0, 0, ARENA.z);
    makeBolt(top, ground, distance);
    const closeness = 1 - (distance - STORM.distance[0]) / (STORM.distance[1] - STORM.distance[0]);
    strike = { start: time, closeness, thunderAt: time + distance / 340 + 0.3, thundered: false };
    nextStrike = time + THREE.MathUtils.randFloat(...STORM.strikeEvery);
  }

  // Brightness of a strike over time: a few quick flickers, then a fade.
  function flashAt(t) {
    const pulse = (at, width, height) => height * Math.max(0, 1 - Math.abs(t - at) / width);
    return Math.max(pulse(0.03, 0.05, 1), pulse(0.16, 0.05, 0.7), pulse(0.3, 0.08, 0.9)) + (t > 0.3 && t < 1.2 ? 0.25 * (1 - (t - 0.3) / 0.9) : 0);
  }

  return {
    // Sound can only start after a click (browsers' rule), so this is called from the Start button.
    enableSound(mixer) {
      if (!sound) sound = createSound(mixer);
    },
    update(time) {
      uniforms.time.value = time;
      workOutClouds(time);
      if (time > nextStrike) startStrike(time);
      let flash = 0;
      if (strike) {
        const t = time - strike.start;
        flash = flashAt(t) * (0.5 + 0.5 * strike.closeness);
        if (!strike.thundered && time >= strike.thunderAt) {
          strike.thundered = true;
          sound?.thunder(strike.closeness);
        }
        if (t > 1.3 && strike.thundered) strike = null;
      }
      // Silent flickers: a cloud somewhere lights up from inside for a moment.
      if (time > nextFlicker) {
        const a = Math.random() * Math.PI * 2;
        uniforms.glowDir.value.set(Math.sin(a), 0.2 + Math.random() * 0.5, Math.cos(a)).normalize();
        flicker = { start: time, strength: 0.4 + Math.random() * 0.6 };
        nextFlicker = time + THREE.MathUtils.randFloat(...STORM.flickerEvery);
      }
      let glow = 0;
      if (flicker) {
        glow = flashAt((time - flicker.start) * 1.4) * flicker.strength;
        if (time - flicker.start > 1) flicker = null;
      }
      uniforms.glow.value = glow;
      uniforms.flash.value = flash;
      light.intensity = flash * 8;
      bolt.material.opacity = flash > 0.3 ? Math.min(1, flash * 1.5) : 0;
    },
  };
}
