// Close-up stone detail for the big environment models.
//
// Each model has one texture stretched over the whole thing, and the arena reuses the wall
// model blown up about 30 times, so up close its stone turns to blur. This lays a fine,
// chisel-hammered stone texture over them, sized in meters in the world (a tile every
// 1 m whatever the model's scale): a little light and shade in the colour, and small bumps
// in the lighting. It's projected from the three axes and blended by which way each surface
// faces ("triplanar"), so it needs no texture coordinates of its own. It fades out in the
// distance, where it would only show up as a repeating pattern.
import * as THREE from 'three';

const DETAIL = {
  meters: 1, // size of one tile of the detail texture
  colour: 0.3, // how strongly it shades the colour (0 = not at all)
  bumps: 0.9, // how strongly it bends the lighting
  fade: [18, 45], // meters from the camera: full detail up to the first, none past the second
};

const loader = new THREE.TextureLoader();
function load(kind, srgb) {
  const texture = loader.load(`textures/rock_${kind}.webp`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
// Shared by every material that has the detail.
let uniforms = null;

const VERTEX = /* glsl */ `
  varying vec3 vDetailWorld;
  varying vec3 vDetailNormal;
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D detailColour, detailNormal;
  uniform float detailScale, detailColourStrength, detailBumps;
  uniform vec2 detailFade;
  varying vec3 vDetailWorld;
  varying vec3 vDetailNormal;
  vec3 detailWeights() {
    vec3 w = pow(abs(normalize(vDetailNormal)), vec3(4.0));
    return w / (w.x + w.y + w.z);
  }
  float detailNear() {
    return 1.0 - smoothstep(detailFade.x, detailFade.y, length(vViewPosition));
  }
`;

// Adds the detail to `material` (a MeshStandardMaterial, shared by every copy of the model).
export function addStoneDetail(material) {
  uniforms ??= {
    detailColour: { value: load('color', true) },
    detailNormal: { value: load('normal', false) },
    detailScale: { value: 1 / DETAIL.meters },
    detailColourStrength: { value: DETAIL.colour },
    detailBumps: { value: DETAIL.bumps },
    detailFade: { value: new THREE.Vector2(...DETAIL.fade) },
  };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vDetailNormal = mat3(modelMatrix) * objectNormal;`
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('varying vec3 vViewPosition;', 'varying vec3 vViewPosition;\n' + FRAGMENT)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           // Shade the colour by how light or dark the stone is here, compared with its average.
           vec3 w = detailWeights();
           vec3 p = vDetailWorld * detailScale;
           vec3 c = texture2D(detailColour, p.zy).rgb * w.x + texture2D(detailColour, p.xz).rgb * w.y + texture2D(detailColour, p.xy).rgb * w.z;
           vec3 average = textureLod(detailColour, vec2(0.5), 16.0).rgb;
           const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
           float shade = clamp(dot(c, LUMA) / max(dot(average, LUMA), 0.01), 0.45, 1.7);
           diffuseColor.rgb *= mix(1.0, shade, detailColourStrength * detailNear());
         }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // Tilt the surface by the detail's bumps, seen from each of the three sides.
           vec3 w = detailWeights();
           vec3 p = vDetailWorld * detailScale;
           vec2 nx = texture2D(detailNormal, p.zy).xy * 2.0 - 1.0;
           vec2 ny = texture2D(detailNormal, p.xz).xy * 2.0 - 1.0;
           vec2 nz = texture2D(detailNormal, p.xy).xy * 2.0 - 1.0;
           vec3 tilt = vec3(0.0, nx.y, nx.x) * w.x + vec3(ny.x, 0.0, ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z;
           normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz * detailBumps * detailNear());
         }`
      );
  };
  material.customProgramCacheKey = () => 'stone-detail';
  material.needsUpdate = true;
}
