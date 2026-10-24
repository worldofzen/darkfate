// Low fog rolling across the arena floor.
//
// A stack of thin, see-through layers from ankle to waist height, each drawn by a small GPU
// program as drifting patches of mist (the same patches run through all the layers, a little
// shifted, so together they look like a soft volume instead of flat sheets). It's thickest
// low down and thins out upward, and fades away near the camera so you never see a layer's
// flat edge slicing across the screen.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLayer; // 0 at the bottom, 1 at the top
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform vec3 uColor;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p * 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = vWorld.xz * 0.07;
    float t = uTime;
    // The fog drifts slowly one way while its patches churn.
    vec2 drift = vec2(t * 0.018, t * 0.007);
    vec2 warp = vec2(fbm(p * 0.7 + drift + uLayer * 0.3), fbm(p * 0.7 - drift.yx + 4.7));
    float mist = fbm(p + warp * 1.6 + drift * 2.0 + uLayer * 0.15);
    float density = smoothstep(0.3, 0.75, mist);
    // Higher layers only catch the thickest patches.
    density *= smoothstep(uLayer * 0.5, uLayer * 0.5 + 0.4, mist);

    // Fade out toward the edge of the area, and near the camera (no hard layer edges up close).
    float edge = 1.0 - smoothstep(uRadius * 0.75, uRadius, distance(vWorld.xz, uCenter.xz));
    float nearby = smoothstep(1.0, 9.0, distance(vWorld, cameraPosition));
    float a = density * edge * nearby * uOpacity;
    // A touch lighter where it's thick, like moonlight caught in it.
    vec3 color = uColor * (0.85 + 0.35 * density);
    gl_FragColor = vec4(color, a);
  }
`;

// `center` (Vector3, at floor level) and `radius`: the area to cover.
export function createGroundFog(center, radius, { layers = 7, top = 2.4, opacity = 0.22, color = new THREE.Color(0.2, 0.23, 0.31) } = {}) {
  const group = new THREE.Group();
  const geometry = new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2);
  const materials = [];
  for (let i = 0; i < layers; i++) {
    const layer = i / (layers - 1);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: opacity * (1.2 - layer * 0.7) },
        uLayer: { value: layer },
        uCenter: { value: center.clone() },
        uRadius: { value: radius },
        uColor: { value: color },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(center.x, center.y + 0.15 + layer * layer * top, center.z); // closer together low down
    mesh.renderOrder = 1;
    group.add(mesh);
    materials.push(material);
  }
  group.userData.update = (time) => {
    for (const m of materials) m.uniforms.uTime.value = time;
  };
  return group;
}
