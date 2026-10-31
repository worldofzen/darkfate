// The fog wall that blocks the way into the boss arena, filling the gateway's arch.
//
// It's built from several see-through sheets stacked across the passage, each drawn by a
// small GPU program (a "shader") as slowly churning mist: big rolling shapes, fine streaks
// rising through them, a brighter warm core, and wispy edges where it meets the stone.
// Most sheets add light (so the veil glows in the dark), one behind them dims what's on the
// other side. Low mist pools on the floor and spills out both ways, motes of light drift up
// through it, and a soft light breathes on the stone around it.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Shared noise: smooth 3D noise, layered from big shapes to fine detail (each layer turned
// a little, so no grid lines show).
const noiseGLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  const mat3 turn = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p * 2.02; a *= 0.5; }
    return v;
  }
  // These colours are picked as screen colours; convert them to the linear light the renderer works in.
  vec3 linear(vec3 c) { return pow(c, vec3(2.2)); }
`;

const veilShader = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uLayer;   // 0..1: which sheet this is (each one churns differently)
  uniform float uStrength;
  uniform float uHalfWidth;
  uniform float uSpring;
  varying vec3 vLocal;
  ${noiseGLSL}

  void main() {
    vec2 p = vLocal.xy;
    float t = uTime;

    // How far inside the arch this point is, in meters.
    float side = uHalfWidth - abs(p.x);
    float inside = p.y < uSpring ? side : uHalfWidth - length(vec2(p.x, p.y - uSpring));

    // Big slow rolling shapes, bent by another layer of noise so they swirl.
    vec3 q = vec3(p.x * 0.55, p.y * 0.32 - t * 0.08, uLayer * 1.7 + t * 0.025);
    vec2 warp = vec2(fbm(q + vec3(0.0, 0.0, t * 0.04)), fbm(q + vec3(5.2, 1.3, 2.8 - t * 0.03)));
    float mist = fbm(q * 1.3 + vec3(warp * 2.0, 0.0));
    // Fine wisps rising through it, dragged sideways by the swirl.
    float streak = fbm(vec3(p.x * 1.4 + warp.x * 2.5, p.y * 0.28 - t * 0.32, uLayer * 3.1 + 7.0));
    float density = smoothstep(0.36, 0.78, mist) * (0.2 + 1.3 * smoothstep(0.35, 0.75, streak));
    // A faint shimmer, like heat haze.
    density *= 0.9 + 0.1 * sin(p.y * 6.0 + warp.y * 9.0 - t * 2.2);

    // Wispy edges: the border is eaten away by the noise, so it frays into the stone.
    float edge = smoothstep(0.0, 1.4, inside + (mist - 0.5) * 2.0 + (streak - 0.5) * 0.8);
    // Where it meets the stone, a thin brighter seam, as if the fog clings to the arch.
    float rim = smoothstep(-0.05, 0.25, inside) * (1.0 - smoothstep(0.2, 0.7, inside)) * smoothstep(0.4, 0.8, mist);
    // Thicker low down, thinner toward the top of the arch.
    float height = mix(1.15, 0.7, smoothstep(0.0, uSpring + uHalfWidth, p.y));

#ifdef BACKING
    // The dimming sheet: a grey haze that hides what's behind the veil.
    float a = (0.22 + 0.4 * smoothstep(0.3, 0.8, mist)) * smoothstep(0.0, 1.0, inside + (mist - 0.5) * 1.4) * uFade * uStrength;
    gl_FragColor = vec4(linear(vec3(0.3, 0.32, 0.36)), a);
#else
    vec3 cool = vec3(0.6, 0.64, 0.72);
    vec3 warm = vec3(1.0, 0.84, 0.56);
    vec3 color = mix(cool, warm, smoothstep(0.5, 0.85, mist + streak * 0.25));
    float a = (density * edge * height + rim * 0.2) * uFade * uStrength;
    gl_FragColor = vec4(linear(color), a);
#endif
  }
`;

// Mist pooled on the floor of the passage, rolling out to both sides of the veil.
const groundShader = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uStrength;
  uniform float uHalfWidth;
  uniform float uReach;
  varying vec3 vLocal;
  ${noiseGLSL}

  void main() {
    vec2 p = vLocal.xy; // (across the gateway, through it)
    float t = uTime;
    float away = abs(p.y);
    vec3 q = vec3(p.x * 0.45, away * 0.55 - t * 0.12, t * 0.03 + uStrength * 9.0);
    float mist = fbm(q + fbm(q * 1.7 + vec3(3.1, 0.0, t * 0.05)) * 1.4);
    float spread = smoothstep(uHalfWidth + 1.2, uHalfWidth - 0.6, abs(p.x) - away * 0.25) * smoothstep(uReach, 0.3, away);
    float a = smoothstep(0.32, 0.8, mist) * spread * uFade * uStrength;
    gl_FragColor = vec4(linear(mix(vec3(0.55, 0.58, 0.66), vec3(0.95, 0.85, 0.65), smoothstep(0.6, 0.85, mist))), a);
  }
`;

const SHEETS = 6; // sheets of mist across the passage (the first one is the dimming one)
const THICKNESS = 0.9; // meters from the first sheet to the last
const MOTES = 70;

export function createFogGate({ halfWidth, spring }, glow) {
  const group = new THREE.Group();
  const crown = spring + halfWidth;
  const materials = [];
  const uniforms = (extra) => ({ uTime: { value: 0 }, uFade: { value: 1 }, uHalfWidth: { value: halfWidth }, ...extra });

  // The veil: a stack of sheets the shape of the arch's opening (a little bigger, so the
  // frayed edges tuck in behind the stone).
  const sheet = new THREE.PlaneGeometry(halfWidth * 2 + 0.4, crown + 0.3, 1, 1);
  sheet.translate(0, (crown + 0.3) / 2 - 0.05, 0);
  for (let i = 0; i < SHEETS; i++) {
    const backing = i === 0;
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: veilShader,
      defines: backing ? { BACKING: '' } : {},
      uniforms: uniforms({
        uLayer: { value: i / SHEETS },
        uSpring: { value: spring },
        uStrength: { value: backing ? 0.8 : 0.4 },
      }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: backing ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(sheet, material);
    // The dimming sheet sits in the middle; the glowing ones spread out in front and behind it.
    mesh.position.z = backing ? 0 : ((i - 1) / (SHEETS - 2) - 0.5) * THICKNESS;
    mesh.renderOrder = backing ? 1 : 2;
    group.add(mesh);
    materials.push({ material, speed: 1 + i * 0.13, offset: i * 23 });
  }

  // Floor mist: two thin layers, spilling out a few meters on both sides.
  const reach = 3.2;
  for (let i = 0; i < 2; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: groundShader,
      uniforms: uniforms({ uStrength: { value: i ? 0.22 : 0.35 }, uReach: { value: reach } }),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 2 + 3, reach * 2), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.08 + i * 0.32;
    floor.renderOrder = 2;
    group.add(floor);
    materials.push({ material, speed: 1 + i * 0.4, offset: i * 51 });
  }

  // Motes of light drifting up through the veil.
  const motePositions = new Float32Array(MOTES * 3);
  const motes = Array.from({ length: MOTES }, () => ({ x: 0, y: 0, z: 0, speed: 0, phase: Math.random() * 10 }));
  const respawn = (m, anywhere) => {
    m.x = (Math.random() * 2 - 1) * (halfWidth - 0.3);
    m.y = anywhere ? Math.random() * crown : Math.random() * 0.5;
    m.z = (Math.random() - 0.5) * (THICKNESS + 0.4);
    m.speed = 0.15 + Math.random() * 0.35;
  };
  motes.forEach((m) => respawn(m, true));
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({
    map: glow,
    color: 0xffe2a8,
    size: 0.09,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(moteGeometry, moteMaterial);
  points.frustumCulled = false;
  points.renderOrder = 3;
  group.add(points);

  // A soft light that slowly breathes, washing the stone of the arch.
  const light = new THREE.PointLight(0xdfe2ff, 6, 13, 2);
  light.position.set(0, 3, 1.2);
  group.add(light);

  // When the camera is right up against the fog (just after you walk through it,
  // the camera trails behind you), the fog fades so it doesn't cover the whole screen.
  const where = new THREE.Vector3();
  let last = 0;
  group.userData.update = (time, camera) => {
    const dt = Math.min(0.1, Math.max(0, time - last));
    last = time;
    let fade = 1;
    if (camera) {
      group.getWorldPosition(where);
      const distance = Math.abs(camera.position.z - where.z);
      const inFront = Math.abs(camera.position.x - where.x) < halfWidth + 1;
      if (inFront) fade = 0.12 + 0.88 * THREE.MathUtils.smoothstep(distance, 0.8, 4.5);
    }
    for (const { material, speed, offset } of materials) {
      material.uniforms.uTime.value = time * speed + offset;
      material.uniforms.uFade.value = fade;
    }
    motes.forEach((m, i) => {
      m.y += m.speed * dt;
      const sway = Math.sin(time * 0.9 + m.phase) * 0.25;
      const x = m.x + sway;
      // Back to the bottom once it rises past the arch.
      const overArch = m.y > spring && Math.hypot(x, m.y - spring) > halfWidth - 0.2;
      if (m.y > crown || overArch) respawn(m, false);
      motePositions.set([x, m.y, m.z + Math.cos(time * 0.7 + m.phase) * 0.1], i * 3);
    });
    moteGeometry.attributes.position.needsUpdate = true;
    moteMaterial.opacity = (0.6 + 0.4 * Math.sin(time * 1.3)) * fade;
    light.intensity = present ? (5.5 + Math.sin(time * 0.8) * 0.8 + Math.sin(time * 2.3) * 0.3) * (0.4 + 0.6 * fade) : 0;
  };
  // Clear the gate away (false) or bring it back. Everything but the light is hidden; the light
  // only goes dark, because a light leaving the scene makes every shader be rebuilt: a freeze
  // of several seconds.
  let present = true;
  group.userData.setPresent = (on) => {
    present = on;
    for (const child of group.children) if (child !== light) child.visible = on;
  };
  return group;
}
