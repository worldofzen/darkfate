// The storm: a moonlit night sky (stars, a haloed moon, broken clouds with silver linings) over misty mountain ranges, lightning that lights up
// the clouds and the ruins, and thunder that rolls in a moment later (sound made in code).
import * as THREE from 'three';
import { ARENA } from './layout.js';

export const STORM = {
  strikeEvery: [5, 12], // seconds between lightning strikes (random in this range)
  flickerEvery: [1.5, 5], // seconds between silent flickers deep in the clouds
  distance: [150, 280], // how far away strikes are (m); thunder arrives later from further away
  thunderVolume: 0.55,
  windVolume: 0.05,
};

// --- The sky dome ---
const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 horizon, zenith, moonDir, flashDir, glowDir;
  uniform float time, flash, glow;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8); // each layer of noise is rotated, so no grid shows
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = turn * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  // Cloud density at a point on the cloud layer: big rolling banks with gaps between them,
  // churned by noise bent through more noise ("domain warping") so they slowly boil.
  float clouds(vec2 p, float t) {
    vec2 q = vec2(fbm(p * 0.6 + vec2(0.0, t * 0.02)), fbm(p * 0.6 + vec2(5.2, 1.3) - t * 0.015));
    float n = fbm(p + 1.6 * q + vec2(t * 0.01, 0.0));
    return smoothstep(0.36, 0.66, n); // 0 = clear sky, 1 = thick cloud
  }

  // Stars: one possible star per small cell of the sky, most cells empty; each twinkles.
  float stars(vec3 d) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float h = hash3(cell);
    if (h < 0.965) return 0.0;
    vec3 offset = vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5;
    float r = length(fract(p) - 0.5 - offset * 0.6);
    float size = 0.06 + 0.1 * (h - 0.965) / 0.035;
    float twinkle = 0.65 + 0.35 * sin(time * (2.0 + h * 9.0) + h * 80.0);
    return smoothstep(size, 0.0, r) * twinkle * (0.3 + 2.5 * pow((h - 0.965) / 0.035, 3.0));
  }

  // A mountain range along the horizon: its height at each compass angle.
  float range(float angle, float scale, float seed) {
    return fbm(vec2(angle * scale, seed)) * 0.7 + fbm(vec2(angle * scale * 4.0, seed + 3.0)) * 0.3;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    float m = dot(d, moonDir);

    // Night sky: deep blue overhead, paler and hazier toward the horizon, brightest round the moon.
    vec3 c = mix(horizon * 1.6, zenith, pow(up, 0.5));
    c += vec3(0.05, 0.065, 0.1) * pow(max(m, 0.0), 6.0);  // wide glow of moonlit air
    c += vec3(0.08, 0.09, 0.12) * pow(max(m, 0.0), 60.0); // brighter close round the moon

    // Stars, fading out low down where the air is thick.
    c += vec3(0.75, 0.8, 1.0) * stars(d) * smoothstep(0.05, 0.35, d.y) * 0.9;

    // The moon: a bright disc with darker "seas" on its face, and a halo.
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), moonDir));
    vec3 north = cross(moonDir, east);
    vec2 face = vec2(dot(d, east), dot(d, north)) / 0.028; // 0..1 across the disc
    float disc = 1.0 - smoothstep(0.92, 1.0, length(face));
    float seas = fbm(face * 2.2 + 4.0);
    vec3 moon = vec3(1.0, 0.97, 0.9) * (1.15 - 0.45 * smoothstep(0.45, 0.7, seas)) * (1.0 - 0.25 * dot(face, face));
    c = mix(c, moon * 2.2, disc);
    c += vec3(0.35, 0.38, 0.45) * pow(max(m, 0.0), 2500.0); // the halo hugging the disc

    // Clouds on a high flat layer above the world, drifting with the wind.
    vec2 wind = vec2(0.6, 0.25);
    vec2 p = d.xz / (d.y + 0.12) * 0.95 + wind * time * 0.006;
    float cover = clouds(p, time);
    // Moonlight through the cloud: sample a little toward the moon; the more cloud between
    // here and the moon, the darker. Edges facing the moon get bright silver linings.
    vec2 toMoon = normalize(moonDir.xz + 1e-4) * 0.06;
    float shadow = clouds(p + toMoon, time);
    float lit = clamp(0.45 + (cover - shadow) * 4.0, 0.0, 1.0);
    float nearMoon = pow(max(m, 0.0), 5.0);
    vec3 dark = vec3(0.004, 0.005, 0.008);
    vec3 silver = vec3(0.09, 0.1, 0.125) * (1.0 + 3.0 * nearMoon);
    vec3 cloud = mix(dark, silver, lit * (1.0 - 0.6 * cover));
    // Thin cloud in front of the moon glows with light shining through it.
    cloud += vec3(0.5, 0.52, 0.58) * pow(max(m, 0.0), 300.0) * (1.0 - cover) * 2.0;
    float aboveHorizon = smoothstep(-0.02, 0.12, d.y);
    c = mix(c, cloud, cover * 0.92 * aboveHorizon);

    // Lightning lights the clouds from inside, brightest around the strike.
    float near = pow(max(dot(d, flashDir), 0.0), 3.0);
    c += vec3(0.55, 0.6, 0.8) * flash * (0.1 + 1.6 * near) * (0.2 + cover);
    float glowNear = pow(max(dot(d, glowDir), 0.0), 8.0);
    c += vec3(0.4, 0.45, 0.65) * glow * glowNear * cover * 1.4;

    // Haze toward the horizon, with a faint ember-red glow far off, as if distant lands burned.
    c = mix(c, horizon * 1.8, (1.0 - smoothstep(0.0, 0.18, up)) * 0.7);
    c += vec3(0.03, 0.008, 0.005) * pow(1.0 - up, 10.0);

    // Two ranges of mountains: a far, pale one half lost in the haze, and a nearer, darker one,
    // with mist pooled in the valleys between. Their moon-facing ridges catch a little light.
    float angle = atan(d.x, d.z);
    float farRidge = 0.035 + 0.11 * range(angle, 2.2, 1.7);
    float nearRidge = 0.01 + 0.075 * range(angle, 3.4, 8.3);
    float moonSide = 0.5 + 0.5 * dot(normalize(vec2(d.x, d.z)), normalize(moonDir.xz));
    if (d.y < farRidge) {
      vec3 far = horizon * 1.35 + vec3(0.012, 0.015, 0.025) * moonSide;
      c = mix(far, c, smoothstep(farRidge - 0.004, farRidge, d.y) * 0.6);
      c = mix(c, horizon * 1.9, smoothstep(farRidge - 0.06, farRidge - 0.01, d.y) * 0.0 + (1.0 - smoothstep(0.0, 0.05, d.y)) * 0.55);
    }
    if (d.y < nearRidge) {
      vec3 nearRock = horizon * 0.55 + vec3(0.006, 0.008, 0.014) * moonSide + vec3(0.02, 0.025, 0.04) * flash;
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
export function createStorm(scene, { horizonColor, moonDirection }) {
  const uniforms = {
    horizon: { value: new THREE.Color(horizonColor) },
    zenith: { value: new THREE.Color(0x05091a) },
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

  // The flash itself: a cold light from the sky, and a jagged bolt in the distance.
  const light = new THREE.DirectionalLight(0xc8d6ff, 0);
  scene.add(light, light.target);
  const boltMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(6, 6.5, 9), fog: false, transparent: true });
  let bolt = null;

  function makeBolt(from, to) {
    const points = [];
    const branches = [];
    const steps = 22;
    let p = from.clone();
    for (let i = 1; i <= steps; i++) {
      const next = from.clone().lerp(to, i / steps).add(new THREE.Vector3((Math.random() - 0.5) * 18, 0, (Math.random() - 0.5) * 18));
      points.push(p.clone(), next.clone());
      if (Math.random() < 0.25) {
        // A short side branch.
        let b = next.clone();
        for (let k = 0; k < 4; k++) {
          const bn = b.clone().add(new THREE.Vector3((Math.random() - 0.5) * 22, -10 - Math.random() * 10, (Math.random() - 0.5) * 22));
          branches.push(b.clone(), bn.clone());
          b = bn;
        }
      }
      p = next;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([...points, ...branches]);
    return new THREE.LineSegments(geometry, boltMaterial);
  }

  let sound = null;
  let nextStrike = 4;
  let strike = null; // { start, closeness, thunderAt }
  let nextFlicker = 2;
  let flicker = null; // { start, strength }

  function startStrike(time) {
    // Mostly somewhere ahead of the arena (toward -Z), so you see it over the tower.
    const azimuth = Math.PI + (Math.random() - 0.5) * 2.4;
    const distance = THREE.MathUtils.randFloat(...STORM.distance);
    const ground = new THREE.Vector3(Math.sin(azimuth) * distance, 0, ARENA.z + Math.cos(azimuth) * distance);
    const top = ground.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 160, (Math.random() - 0.5) * 60));
    uniforms.flashDir.value.copy(top).setY(top.y * 0.6).sub(new THREE.Vector3(0, 0, ARENA.z)).normalize();
    light.position.copy(top);
    light.target.position.set(0, 0, ARENA.z);
    if (bolt) scene.remove(bolt);
    bolt = makeBolt(top, ground);
    scene.add(bolt);
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
        uniforms.glowDir.value.set(Math.sin(a), 0.25 + Math.random() * 0.5, Math.cos(a)).normalize();
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
      light.intensity = flash * 7;
      if (bolt) bolt.visible = flash > 0.35;
      boltMaterial.opacity = Math.min(1, flash * 1.5);
    },
  };
}
