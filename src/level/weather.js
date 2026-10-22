// The storm: a sky of heavy, churning storm clouds (with fast low scud beneath) over a mountain ridge, lightning that lights up
// the clouds and the ruins, and thunder that rolls in a moment later (sound made in code).
import * as THREE from 'three';

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
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8); // each layer of noise is rotated, so no grid shows
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  // The storm deck: noise bent by more noise ("domain warping"), so the clouds roll and
  // churn as time passes instead of just sliding along, plus smaller lumps on top so
  // they look heavy and billowing.
  float stormClouds(vec2 p, float t) {
    vec2 q = vec2(fbm(p + vec2(0.0, t * 0.04)), fbm(p + vec2(5.2, 1.3) - t * 0.03));
    float body = fbm(p + 1.4 * q + vec2(t * 0.02, 0.0));
    float lumps = fbm(p * 4.0 + 2.0 * q - t * 0.05);
    return body * 0.75 + lumps * 0.25;
  }
  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    vec3 c = mix(horizon, zenith, pow(up, 0.45));

    // The moon, only glimpsed through gaps in the clouds.
    float m = dot(d, moonDir);
    c += vec3(0.8, 0.85, 1.0) * smoothstep(0.9993, 0.9996, m) * 0.9;
    c += vec3(0.05, 0.06, 0.1) * pow(max(m, 0.0), 40.0);

    // Clouds are drawn on a high flat layer above the world, blowing with the wind.
    vec2 wind = vec2(0.6, 0.25);
    vec2 p = d.xz / (d.y + 0.1) * 0.35;
    float n = stormClouds(p + wind * time * 0.03, time);
    float cover = smoothstep(0.3, 0.48, n); // almost fully overcast
    float thick = smoothstep(0.4, 0.62, n); // heavy, dark bellies
    // Even the gaps aren't clear: a dim, higher layer of cloud shows through.
    c = mix(c, vec3(0.016, 0.018, 0.026) * (0.6 + 0.8 * n), 0.85 * smoothstep(0.0, 0.15, up));
    float moonLight = pow(max(m, 0.0), 4.0);
    vec3 cloud = mix(vec3(0.042, 0.046, 0.062), vec3(0.005, 0.006, 0.009), thick);
    cloud += vec3(0.08, 0.095, 0.135) * moonLight * (1.0 - thick); // silver edges toward the moon
    float aboveHorizon = smoothstep(-0.02, 0.1, d.y);
    c = mix(c, cloud, cover * aboveHorizon);

    // Low ragged scud racing underneath, much faster than the deck above.
    vec2 ps = p * 2.2 + wind * time * 0.09;
    float s = fbm(ps + 1.5 * vec2(fbm(ps * 0.7 + time * 0.03), fbm(ps * 0.7 + 4.1 - time * 0.03)));
    float scud = smoothstep(0.5, 0.8, s) * aboveHorizon;
    c = mix(c, vec3(0.008, 0.009, 0.013) + vec3(0.04, 0.05, 0.07) * moonLight, scud * 0.75);

    // Haze toward the horizon, with a faint ember-red glow, as if distant lands were burning.
    c = mix(c, horizon, (1.0 - smoothstep(0.0, 0.2, up)) * 0.65);
    c += vec3(0.035, 0.009, 0.006) * pow(1.0 - up, 8.0) * (0.6 + 0.4 * n);

    // Lightning lights the clouds from inside, brightest around the strike.
    float near = pow(max(dot(d, flashDir), 0.0), 3.0);
    c += vec3(0.55, 0.6, 0.8) * flash * (0.15 + 1.8 * near) * (0.3 + cover * (1.0 - 0.5 * thick) + scud * 0.3);
    // Distant flickers deep inside the clouds (no bolt, no thunder).
    float glowNear = pow(max(dot(d, glowDir), 0.0), 8.0);
    c += vec3(0.4, 0.45, 0.65) * glow * glowNear * (0.15 + n * cover) * 1.6;

    // A dark mountain ridge along the horizon.
    float angle = atan(d.x, d.z);
    float ridge = 0.03 + 0.07 * fbm(vec2(angle * 3.0, 1.7)) + 0.03 * fbm(vec2(angle * 14.0, 5.1));
    if (d.y < ridge) {
      vec3 rock = horizon * 0.55 + vec3(0.02, 0.025, 0.04) * flash * (1.0 + near * 3.0);
      c = mix(rock, horizon, smoothstep(ridge - 0.08, ridge, d.y) * 0.25);
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
    zenith: { value: new THREE.Color(0x020308) },
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
    const ground = new THREE.Vector3(Math.sin(azimuth) * distance, 0, -52 + Math.cos(azimuth) * distance);
    const top = ground.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 160, (Math.random() - 0.5) * 60));
    uniforms.flashDir.value.copy(top).setY(top.y * 0.6).sub(new THREE.Vector3(0, 0, -52)).normalize();
    light.position.copy(top);
    light.target.position.set(0, 0, -52);
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
