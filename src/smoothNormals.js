// Smooth shading for the scanned models.
//
// A model's surface is made of triangles that share corners ("vertices"), and each vertex has a
// "normal": the way the surface faces there, which decides how light falls on it. Where a model
// is cut apart for its texture (or was saved flat-shaded) the same corner is stored several
// times, each copy with its own normal, so the light changes abruptly there: hard creases and
// a faceted, polygonal look. This gives all the copies of a corner one shared, averaged normal,
// so the light flows smoothly across the surface. Only copies facing within `creaseAngle` of
// each other are averaged, so genuinely sharp edges (a blade's edge, a block's corner) stay crisp.
import * as THREE from 'three';

export function smoothNormals(geometry, creaseAngle = THREE.MathUtils.degToRad(70)) {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!normal) {
    geometry.computeVertexNormals();
    return;
  }
  // Group the copies of each corner by where they are.
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  const before = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    before[i * 3] = normal.getX(i);
    before[i * 3 + 1] = normal.getY(i);
    before[i * 3 + 2] = normal.getZ(i);
  }
  const after = new Float32Array(before);
  const minDot = Math.cos(creaseAngle);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const i of group) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of group) {
        const dot = before[i * 3] * before[j * 3] + before[i * 3 + 1] * before[j * 3 + 1] + before[i * 3 + 2] * before[j * 3 + 2];
        if (dot < minDot) continue; // across a sharp edge: keep it sharp
        x += before[j * 3];
        y += before[j * 3 + 1];
        z += before[j * 3 + 2];
      }
      const length = Math.hypot(x, y, z) || 1;
      after[i * 3] = x / length;
      after[i * 3 + 1] = y / length;
      after[i * 3 + 2] = z / length;
    }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(after, 3));
}
