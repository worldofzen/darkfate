// The fog wall that blocks the way into the boss arena.
// It's a see-through sheet with swirling mist drawn by a small GPU program (a "shader").
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = vec2(vUv.x * 3.0, vUv.y * 4.0);
    float warp = fbm(p * 0.8 + vec2(uTime * 0.07, -uTime * 0.05));
    float mist = fbm(p + warp * 1.5 + vec2(0.0, -uTime * 0.18));

    // Fade out at the edges so it blends into the stone archway.
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x)
               * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.9, vUv.y);

    vec3 grey = vec3(0.55, 0.58, 0.66);
    vec3 gold = vec3(1.0, 0.86, 0.55);
    vec3 color = mix(grey, gold, smoothstep(0.55, 0.8, mist));
    float alpha = smoothstep(0.3, 0.85, mist) * 0.7 * edge * uFade;
    // These colours are picked as screen colours; convert them to the linear light the renderer works in.
    gl_FragColor = vec4(pow(color, vec3(2.2)), alpha);
  }
`;

export function createFogGate(width, height) {
  const group = new THREE.Group();
  const layers = [];

  // Two layers at slightly different depths and speeds give the fog some thickness.
  for (let i = 0; i < 2; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: i * 37 }, uFade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    sheet.position.set(0, height / 2, i * 0.25);
    group.add(sheet);
    layers.push(material);
  }

  const light = new THREE.PointLight(0xdfe4ff, 6, 12, 2);
  light.position.set(0, 3, 1);
  group.add(light);

  // When the camera is right up against the fog (just after you walk through it,
  // the camera trails behind you), the fog fades so it doesn't cover the whole screen.
  const where = new THREE.Vector3();
  group.userData.update = (time, camera) => {
    let fade = 1;
    if (camera) {
      group.getWorldPosition(where);
      const distance = Math.abs(camera.position.z - where.z);
      const inFront = Math.abs(camera.position.x - where.x) < width / 2 + 1;
      if (inFront) fade = 0.12 + 0.88 * THREE.MathUtils.smoothstep(distance, 0.8, 4.5);
    }
    layers.forEach((m, i) => {
      m.uniforms.uTime.value = time * (1 + i * 0.3) + i * 37;
      m.uniforms.uFade.value = fade;
    });
  };
  return group;
}
