// Stone and dirt materials, using the texture sets made by tools/make_textures.mjs.
// Each set has a colour map, a normal map (small bumps) and an "ORM" map
// (red = ambient occlusion, green = roughness).
import * as THREE from 'three';

// Texture sizes in the world: the floor and wall textures each cover 2 x 2 m, dirt 1 x 1 m.
export const TEXTURE_METERS = { floor: 2, wall: 3, dirt: 1 }; // wall blocks come out ~1.5 x 0.75 m

const loader = new THREE.TextureLoader();

function stoneMaterial(name, { repeat = 1, ...options } = {}) {
  const load = (kind, srgb) => {
    const tex = loader.load(`textures/${name}_${kind}.webp`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 16; // keeps the floor sharp at grazing angles (three.js caps this to what the GPU allows)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const orm = load('orm', false);
  return new THREE.MeshStandardMaterial({
    map: load('color', true),
    normalMap: load('normal', false),
    roughnessMap: orm,
    aoMap: orm,
    aoMapIntensity: 1,
    metalness: 0,
    ...options,
  });
}

// The floor slabs carry their own shade (vertex colours) for patterns and variety.
export const floorStone = stoneMaterial('floor', { color: 0xc4c0b8, vertexColors: true });
export const wallStone = stoneMaterial('wall');
// Fluted, weathered column stone: the texture wraps once around a column (see fluteUVs).
export const pillarStone = stoneMaterial('pillar');
export const rockStone = stoneMaterial('floor', { flatShading: true });
// Dirt for flat ground whose texture coordinates are measured in meters (the texture covers 1 m).
export const dirtMeters = stoneMaterial('dirt');

// Re-map a box's texture coordinates so the texture is the same size on every block
// (instead of being stretched to fit each face), starting at a random spot.
export function worldScaleBoxUVs(geometry, width, height, depth, rand, meters = TEXTURE_METERS.wall) {
  const uv = geometry.attributes.uv;
  // Box faces come in this order: +x, -x, +y, -y, +z, -z (4 corners each).
  const sizes = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
  for (let face = 0; face < 6; face++) {
    const offU = rand();
    const offV = rand();
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uv.getX(i) * (sizes[face][0] / meters) + offU, uv.getY(i) * (sizes[face][1] / meters) + offV);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

// Same idea for a column (cylinder): wrap the texture around its circumference.
export function worldScaleCylinderUVs(geometry, radius, height, meters = TEXTURE_METERS.wall) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * ((2 * Math.PI * radius) / meters), uv.getY(i) * (height / meters));
  }
  uv.needsUpdate = true;
  return geometry;
}

// Column shafts: the fluted pillar texture wraps exactly once around (so the flutes meet
// up with no seam) and repeats every 2.4 m up the shaft.
export function fluteUVs(geometry, height, meters = 2.4) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (height / meters));
  uv.needsUpdate = true;
  return geometry;
}
