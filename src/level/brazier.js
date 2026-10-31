// A stone fire bowl (the Dungeon_lamp.glb model) with a living fire in it:
//   - flames: three layers of animated fire drawn by a shader (white-hot core, yellow,
//     orange, dark-red tips), licking and flickering, always turned toward the camera
//   - an ember bed glowing among the charred logs in the bowl
//   - sparks swirling up out of the fire, and faint smoke above it
//   - a warm light that flickers unevenly, like a real fire (only on some lamps: lights are costly)
import * as THREE from 'three';

// Measured on the model (its own units; it's 0.98 tall, standing from y = -0.49):
// the bowl's floor, where the logs lie, is at y = 0.35, and the inside of the bowl is 0.3 across.
const LAMP = { height: 0.98, bottomY: -0.49, bowlFloorY: 0.35, bowlRadius: 0.3 };

// --- The flame shader ---
export const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Turn to face the camera around the vertical axis (flames stay upright).
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCamera = cameraPosition - center;
    toCamera.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCamera + vec3(1e-4, 0.0, 0.0))));
    float sx = length(modelMatrix[0].xyz);
    float sy = length(modelMatrix[1].xyz);
    vec3 world = center + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
export const flameFragment = /* glsl */ `
  uniform float time, seed, brightness;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    // Noise rushing upward, bent sideways a little, gives the licking tongues of flame.
    float t = time * 1.6 + seed;
    float bend = (fbm(vec2(uv.y * 2.0 - t * 0.7, seed)) - 0.5) * 0.25 * uv.y;
    float x = uv.x - 0.5 + bend;
    float n = fbm(vec2(x * 6.0 + seed, uv.y * 3.0 - t * 2.2)); // several tongues of flame side by side
    // A teardrop: wide at the base, narrowing to a point.
    float width = 0.42 * pow(1.0 - uv.y, 0.75) + 0.02;
    float shape = 1.0 - abs(x) / width;
    float heat = shape * 1.15 - uv.y * 0.9 + (n - 0.5) * 1.4;
    heat *= smoothstep(0.0, 0.12, uv.y); // soft bottom edge, inside the logs
    float flame = smoothstep(0.0, 0.35, heat);
    if (flame <= 0.001) discard;
    // Color by heat: deep red at the edges and tips, through orange and yellow, to a white-hot core.
    vec3 color = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.35, 0.03), smoothstep(0.0, 0.35, heat));
    color = mix(color, vec3(1.0, 0.62, 0.18), smoothstep(0.4, 0.8, heat));
    color = mix(color, vec3(1.0, 0.88, 0.6), smoothstep(0.9, 1.25, heat)); // only the very core
    gl_FragColor = vec4(color * flame * brightness, 1.0);
  }
`;

// --- The ember bed: glowing cracks among the coals, slowly pulsing ---
export const emberFragment = /* glsl */ `
  uniform float time, seed;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec2 p = vUv * 9.0 + seed;
    float n = noise(p) * 0.6 + noise(p * 2.3 + time * 0.15) * 0.4;
    float r = length(vUv - 0.5) * 2.0;
    float glow = smoothstep(0.45, 0.8, n) * (0.75 + 0.25 * sin(time * 2.0 + n * 12.0)) * (1.0 - smoothstep(0.6, 1.0, r));
    vec3 ash = vec3(0.03, 0.015, 0.01);
    vec3 hot = vec3(4.0, 1.1, 0.15);
    float alpha = 1.0 - smoothstep(0.85, 1.0, r);
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(mix(ash, hot, glow), alpha);
  }
`;
export const plainVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const flameGeometry = new THREE.PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0); // base at the bottom

// `model`: the loading Dungeon_lamp.glb (a promise). `height`: how tall the lamp stands (m).
// `light: false` makes a lamp that burns but doesn't light up its surroundings.
export function createBrazier(glowTexture, { model, height = 1.6, light = true } = {}) {
  const group = new THREE.Group();
  const s = height / LAMP.height;
  const fireY = (LAMP.bowlFloorY - LAMP.bottomY) * s; // the bowl's floor, above the ground
  const bowl = LAMP.bowlRadius * s;
  const seed = Math.random() * 100;

  model.then((source) => {
    const lamp = source.clone();
    lamp.scale.setScalar(s);
    lamp.position.y = -LAMP.bottomY * s;
    group.add(lamp);
  });

  // The ember bed among the logs.
  const emberUniforms = { time: { value: 0 }, seed: { value: seed } };
  const embers = new THREE.Mesh(
    new THREE.CircleGeometry(bowl * 0.95, 24),
    new THREE.ShaderMaterial({ uniforms: emberUniforms, vertexShader: plainVertex, fragmentShader: emberFragment, transparent: true })
  );
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = fireY + 0.02 * s;
  group.add(embers);

  // Three flame layers: a big outer one and two smaller, brighter ones, each with its own rhythm.
  const flames = [
    { w: 2.3, h: 2.1, brightness: 0.8, x: 0, z: 0 },
    { w: 1.5, h: 1.6, brightness: 1.0, x: 0.3, z: 0.15 },
    { w: 1.4, h: 1.4, brightness: 1.0, x: -0.3, z: -0.15 },
  ].map((f, i) => {
    const uniforms = { time: { value: 0 }, seed: { value: seed + i * 17.3 }, brightness: { value: f.brightness } };
    const mesh = new THREE.Mesh(
      flameGeometry,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    mesh.scale.set(bowl * f.w, bowl * f.h, 1);
    mesh.position.set(f.x * bowl, fireY - 0.02 * s, f.z * bowl);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    return { mesh, uniforms, base: f };
  });

  // A soft glow round the fire (the bloom effect spreads it further).
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: new THREE.Color(1.0, 0.45, 0.12), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 })
  );
  halo.position.y = fireY + bowl * 0.9;
  halo.scale.setScalar(bowl * 4);
  group.add(halo);

  // Sparks swirling up out of the fire.
  const SPARKS = 40;
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkColors = new Float32Array(SPARKS * 3);
  const sparks = Array.from({ length: SPARKS }, () => ({
    x: (Math.random() - 0.5) * bowl * 1.2,
    z: (Math.random() - 0.5) * bowl * 1.2,
    speed: 0.3 + Math.random() * 0.5,
    rise: (1.5 + Math.random() * 2.5) * (s / 1.6),
    offset: Math.random(),
    swirl: 0.1 + Math.random() * 0.35,
    phase: Math.random() * 6.28,
  }));
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  const sparkPoints = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({ map: glowTexture, size: 0.05 * (s / 1.6) + 0.02, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  sparkPoints.frustumCulled = false;
  group.add(sparkPoints);

  // Faint smoke drifting up above the flames.
  const SMOKE = 5;
  const smoke = Array.from({ length: SMOKE }, (_, i) => {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, color: 0x15110e, transparent: true, depthWrite: false, opacity: 0 })
    );
    group.add(puff);
    return { puff, offset: i / SMOKE, drift: Math.random() * 6.28 };
  });

  let fireLight = null;
  if (light) {
    fireLight = new THREE.PointLight(0xff8a3d, 30, 18, 2);
    fireLight.position.y = fireY + bowl * 3.5; // above the flames, so it doesn't blind the rim
    group.add(fireLight);
    group.userData.fireLight = fireLight; // (its shadows come from fireShadow.js)
  }

  // Uneven flicker: several unrelated wobbles added up, with the odd sudden dip.
  const flickerAt = (t) =>
    0.82 + 0.08 * Math.sin(t * 9.3 + seed) + 0.06 * Math.sin(t * 17.7 + seed * 1.3) + 0.04 * Math.sin(t * 31.1 + seed * 2.1) -
    0.08 * Math.max(0, Math.sin(t * 2.3 + seed * 0.7)) ** 8;

  group.userData.update = (time) => {
    const flicker = flickerAt(time);
    emberUniforms.time.value = time;
    for (const f of flames) {
      f.uniforms.time.value = time;
      f.mesh.scale.y = bowl * f.base.h * (0.9 + 0.15 * flicker);
    }
    halo.material.opacity = 0.22 + 0.1 * flicker;
    if (fireLight) {
      fireLight.intensity = 30 * flicker;
      fireLight.color.setRGB(1, 0.5 + 0.06 * flicker, 0.2 + 0.05 * flicker);
    }

    sparks.forEach((e, i) => {
      const life = (time * e.speed + e.offset) % 1;
      const swirl = e.swirl * life;
      sparkPositions[i * 3] = e.x * (1 - life * 0.6) + Math.sin(time * 3 + e.phase + life * 6) * swirl;
      sparkPositions[i * 3 + 1] = fireY + bowl * 0.4 + life * e.rise;
      sparkPositions[i * 3 + 2] = e.z * (1 - life * 0.6) + Math.cos(time * 2.6 + e.phase + life * 6) * swirl;
      const glow = (1 - life) ** 2 * 3.5 * (0.6 + 0.4 * Math.sin(time * 20 + e.phase)); // twinkling, fading as it rises
      sparkColors[i * 3] = glow;
      sparkColors[i * 3 + 1] = glow * 0.4;
      sparkColors[i * 3 + 2] = glow * 0.08;
    });
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;

    for (const p of smoke) {
      const life = (time * 0.12 + p.offset) % 1;
      p.puff.position.set(Math.sin(time * 0.4 + p.drift) * 0.3 * life, fireY + bowl * 2.4 + life * 2.5 * (s / 1.6), Math.cos(time * 0.3 + p.drift) * 0.3 * life);
      p.puff.scale.setScalar(bowl * (1.5 + life * 4));
      p.puff.material.opacity = 0.35 * Math.sin(life * Math.PI);
    }
  };
  return group;
}
