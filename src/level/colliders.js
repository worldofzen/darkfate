// Invisible shapes that stop the player from walking through things.
// We only care about the ground plan (seen from above), so every obstacle is
// either a circle (columns, fire bowls), a rotated rectangle (walls, fallen stones)
// or a solid cell of a height map (rock spikes on the arena floor).

const circles = [];
const boxes = [];
let walkArea = null;

// Solid meshes the camera shouldn't pass through (filled in as the level is built).
export const cameraBlockers = [];

export function addCircle(x, z, radius) {
  circles.push({ x, z, radius });
}

// A rectangle centered at (x, z), `halfWidth` along its local X, `halfDepth` along its local Z,
// turned by `angle` (same as a mesh's rotation.y). Set `.enabled = false` on the returned
// box to let things pass through it (used for the fog gate).
export function addBox(x, z, halfWidth, halfDepth, angle = 0) {
  const box = { x, z, halfWidth, halfDepth, cos: Math.cos(angle), sin: Math.sin(angle), enabled: true };
  boxes.push(box);
  return box;
}

// Somewhere you must stay INSIDE (the arena, ringed by a chasm). Inside the `zone`
// (a test on x, z), only the given circles { x, z, radius } and rectangles
// { minX, maxX, minZ, maxZ } can be walked on; step off and you're put back on the edge.
export function setWalkArea(zone, areas) {
  walkArea = { zone, areas };
}

function keepOnWalkArea(pos, radius) {
  if (!walkArea || !walkArea.zone(pos.x, pos.z)) return;
  let best = null;
  let bestDist = Infinity;
  for (const a of walkArea.areas) {
    let x;
    let z;
    if (a.radius !== undefined) {
      const dx = pos.x - a.x;
      const dz = pos.z - a.z;
      const d = Math.hypot(dx, dz);
      const limit = a.radius - radius;
      if (d <= limit) return; // standing on it
      x = a.x + (dx / d) * limit;
      z = a.z + (dz / d) * limit;
    } else {
      x = Math.min(Math.max(pos.x, a.minX + radius), a.maxX - radius);
      z = Math.min(Math.max(pos.z, a.minZ), a.maxZ);
      if (x === pos.x && z === pos.z) return; // standing on it
    }
    const dist = Math.hypot(x - pos.x, z - pos.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = [x, z];
    }
  }
  if (best) {
    pos.x = best[0];
    pos.z = best[1];
  }
}

// --- Uneven ground ---
// A height map (a grid of floor heights, seen from above) for floors that aren't flat, like
// the arena platform. Cells can also be marked solid: rock spikes, broken-away edges.
// `map` is { minX, minZ, cell, cols, rows, height: Float32Array, solid: Uint8Array }.
let ground = null;
export function setGroundMap(map) {
  ground = map;
}

// How high the floor is at (x, z): 0 except where the height map says otherwise.
export function groundHeight(x, z) {
  if (!ground) return 0;
  const gx = (x - ground.minX) / ground.cell - 0.5;
  const gz = (z - ground.minZ) / ground.cell - 0.5;
  if (gx < 0 || gz < 0 || gx >= ground.cols - 1 || gz >= ground.rows - 1) return 0;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h = (i, k) => ground.height[k * ground.cols + i];
  return (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz;
}

// Each solid cell of the height map acts like a small post.
function pushOutOfSolidCells(pos, radius) {
  if (!ground) return;
  const { minX, minZ, cell, cols, rows, solid } = ground;
  const post = cell * 0.6;
  const reach = Math.ceil((radius + post) / cell);
  const ci = Math.floor((pos.x - minX) / cell);
  const ck = Math.floor((pos.z - minZ) / cell);
  for (let k = Math.max(0, ck - reach); k <= Math.min(rows - 1, ck + reach); k++) {
    for (let i = Math.max(0, ci - reach); i <= Math.min(cols - 1, ci + reach); i++) {
      if (!solid[k * cols + i]) continue;
      const dx = pos.x - (minX + (i + 0.5) * cell);
      const dz = pos.z - (minZ + (k + 0.5) * cell);
      const dist = Math.hypot(dx, dz);
      const min = radius + post;
      if (dist < min && dist > 1e-6) {
        pos.x += (dx / dist) * (min - dist);
        pos.z += (dz / dist) * (min - dist);
      }
    }
  }
}

// Moves `pos` (a Vector3) out of any obstacle it overlaps, treating the player as a circle.
export function pushOut(pos, radius) {
  keepOnWalkArea(pos, radius);
  for (let pass = 0; pass < 3; pass++) {
    pushOutOfSolidCells(pos, radius);
    for (const c of circles) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const min = radius + c.radius;
      const dist = Math.hypot(dx, dz);
      if (dist < min && dist > 1e-6) {
        pos.x = c.x + (dx / dist) * min;
        pos.z = c.z + (dz / dist) * min;
      }
    }

    for (const b of boxes) {
      if (!b.enabled) continue;
      // Look at the player from the box's point of view (as if the box weren't rotated).
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;

      let px;
      let pz;
      const inside = Math.abs(lx) < b.halfWidth && Math.abs(lz) < b.halfDepth;
      if (inside) {
        // Center is inside the box: push out through the nearest side.
        const outX = b.halfWidth - Math.abs(lx);
        const outZ = b.halfDepth - Math.abs(lz);
        if (outX < outZ) {
          px = Math.sign(lx) * (b.halfWidth + radius);
          pz = lz;
        } else {
          px = lx;
          pz = Math.sign(lz) * (b.halfDepth + radius);
        }
      } else {
        const cx = Math.max(-b.halfWidth, Math.min(b.halfWidth, lx));
        const cz = Math.max(-b.halfDepth, Math.min(b.halfDepth, lz));
        const ox = lx - cx;
        const oz = lz - cz;
        const dist = Math.hypot(ox, oz);
        if (dist >= radius) continue;
        px = cx + (ox / dist) * radius;
        pz = cz + (oz / dist) * radius;
      }

      // Back to world space.
      pos.x = b.x + px * b.cos + pz * b.sin;
      pos.z = b.z - px * b.sin + pz * b.cos;
    }
  }
}
