// Visual effects for combat:
//   - particle bursts: blood when a blow lands, sparks when it's blocked, embers when the boss turns to ash
//   - a slash flash: a white-hot crescent where a blade cuts through
//   - a red flash on a character's body when hit
//   - disintegration: the dead boss's body crumbles away into glowing embers
import * as THREE from 'three';

// --- Particles ---
// One pool of particles per look (blood, sparks, embers). Each particle flies, falls (or rises)
// and fades. Colours have an alpha channel so particles can fade out.
function createParticles(scene, { max, size, blending, gravity, drag, texture }) {
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size, map: texture, vertexColors: true, transparent: true, depthWrite: false, blending })
  );
  points.frustumCulled = false;
  scene.add(points);
  const particles = Array.from({ length: max }, () => ({ life: 0, maxLife: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: new THREE.Color() }));
  let next = 0;

  return {
    // `count` particles from `origin`, flying mostly along `direction` (plus a random spread).
    burst(origin, direction, { count, speed, spread, life, color, colorVariation = 0 }) {
      for (let i = 0; i < count; i++) {
        const p = particles[next];
        next = (next + 1) % max;
        p.pos.copy(origin);
        p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread)
          .add(direction).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
        p.maxLife = p.life = life * (0.6 + Math.random() * 0.6);
        p.color.set(color).multiplyScalar(1 - colorVariation * Math.random());
      }
    },
    update(dt) {
      particles.forEach((p, i) => {
        if (p.life > 0) {
          p.life -= dt;
          p.vel.y -= gravity * dt;
          p.vel.multiplyScalar(1 - drag * dt);
          p.pos.addScaledVector(p.vel, dt);
        }
        positions[i * 3] = p.pos.x;
        positions[i * 3 + 1] = p.pos.y;
        positions[i * 3 + 2] = p.pos.z;
        colors[i * 4] = p.color.r;
        colors[i * 4 + 1] = p.color.g;
        colors[i * 4 + 2] = p.color.b;
        colors[i * 4 + 3] = Math.max(0, p.life / p.maxLife);
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// --- Slash flash: a bright crescent where a blade cuts through ---
// A flat card that always faces the camera, turned so its curved streak runs the way the
// blade was moving. The streak sweeps on from tail to head in a few hundredths of a second,
// glowing white-hot in its core and warm gold at its edges, then fades.
const slashVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const slashFragment = /* glsl */ `
  uniform float uAge;   // 0..1 over the flash's life
  uniform float uBend;  // how curved the streak is (and which way)
  varying vec2 vUv;
  void main() {
    float x = vUv.x;
    float along = 1.0 - x * x;
    float curve = uBend * along - uBend * 0.35;
    float width = 0.11 * pow(along, 0.8) + 0.004;
    float d = abs(vUv.y - curve);
    float core = 1.0 - smoothstep(0.0, width * 0.35, d);
    float glow = 1.0 - smoothstep(0.0, width, d);
    // Sweeps on from the tail (-x) to the head (+x), then burns away from the tail.
    float head = -1.0 + 2.6 * smoothstep(0.0, 0.3, uAge);
    float tail = -1.2 + 2.6 * smoothstep(0.25, 1.0, uAge);
    float shown = (1.0 - smoothstep(head - 0.25, head, x)) * smoothstep(tail, tail + 0.6, x);
    float bright = (0.5 + 0.5 * (x * 0.5 + 0.5)) * (1.0 - smoothstep(0.55, 1.0, uAge));
    vec3 color = vec3(3.2, 2.9, 2.5) * core + vec3(2.2, 1.1, 0.35) * glow;
    gl_FragColor = vec4(color * bright, max(core, glow * 0.8) * shown * bright);
  }
`;

function createSlashes(scene, camera, glowTexture) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const pool = Array.from({ length: 6 }, () => {
    const material = new THREE.ShaderMaterial({
      vertexShader: slashVertex,
      fragmentShader: slashFragment,
      uniforms: { uAge: { value: 1 }, uBend: { value: 0.3 } },
      transparent: true,
      depthTest: false, // drawn over the body it cuts through
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const card = new THREE.Mesh(geometry, material);
    card.renderOrder = 10;
    card.visible = false;
    card.frustumCulled = false;
    // A burst of light where the blade bites.
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: new THREE.Color(3, 2.4, 1.6), depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    star.renderOrder = 11;
    star.visible = false;
    scene.add(card, star);
    return { card, star, material, age: 1, life: 0.24, size: 2 };
  });
  let next = 0;
  const along = new THREE.Vector3();
  return {
    // `at`: where it cuts. `motion`: which way the blade was moving. `size`: length in meters.
    spawn(at, motion, size = 2.2) {
      const s = pool[next];
      next = (next + 1) % pool.length;
      s.age = 0;
      s.size = size;
      s.card.position.copy(at);
      s.star.position.copy(at);
      s.card.quaternion.copy(camera.quaternion);
      // The blade's movement as seen on screen sets which way the streak runs.
      along.copy(motion).transformDirection(camera.matrixWorldInverse);
      const roll = along.lengthSq() > 1e-6 ? Math.atan2(along.y, along.x) : (Math.random() < 0.5 ? 0.6 : 2.5);
      s.card.rotateZ(roll);
      s.material.uniforms.uBend.value = (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.12);
      s.card.visible = s.star.visible = true;
    },
    update(dt) {
      for (const s of pool) {
        if (!s.card.visible) continue;
        s.age += dt / s.life;
        if (s.age >= 1) {
          s.card.visible = s.star.visible = false;
          continue;
        }
        s.material.uniforms.uAge.value = s.age;
        const grow = 1 + s.age * 0.18;
        s.card.scale.set(s.size * grow, s.size * 0.55 * grow, 1);
        const pop = Math.min(1, s.age * 5) * (1 - s.age);
        s.star.scale.setScalar(0.3 + 0.9 * pop);
        s.star.material.opacity = 1 - s.age;
      }
    },
  };
}

// --- A red flash on a character's body when hit ---
export function createHitFlash(model, color = new THREE.Color(0.07, 0.004, 0.003)) {
  const materials = [];
  model.traverse((o) => {
    if (o.isMesh && o.material.emissive && !materials.includes(o.material)) materials.push(o.material);
  });
  let flash = 0;
  return {
    trigger(seconds = 0.18) {
      flash = seconds;
    },
    update(dt) {
      if (flash <= 0 && flash !== -1) return;
      flash = Math.max(0, flash - dt);
      const k = flash / 0.18;
      for (const m of materials) m.emissive.setRGB(color.r * k, color.g * k, color.b * k);
      if (flash === 0) flash = -1; // finished (skip work until the next hit)
    },
  };
}

// --- Disintegration ---
// Adds a "dissolve" to every material on `model`: patches of the body vanish, with glowing
// ember-coloured edges, as `progress` goes from 0 to 1. Returns a function to set progress.
function addDissolve(model) {
  const progress = { value: 0 };
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.solidMaterial ??= o.material; // kept, so `restore` can bring the model back
    o.material = o.material.clone();
    o.material.onBeforeCompile = (shader) => {
      shader.uniforms.dissolve = progress;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vDissolvePos;
          uniform float dissolve;
          float dHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float dNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p);
            vec3 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), u.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), u.x), u.y),
                       mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), u.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), u.x), u.y), u.z);
          }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float dn = dNoise(vDissolvePos * 2.6) * 0.65 + dNoise(vDissolvePos * 9.0) * 0.35;
          if (dn < dissolve * 1.15 - 0.05) discard;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float edge = 1.0 - smoothstep(0.0, 0.08, dn - (dissolve * 1.15 - 0.05));
          totalEmissiveRadiance += vec3(4.0, 1.6, 0.4) * edge * step(0.001, dissolve);`);
    };
    o.material.needsUpdate = true;
  });
  return progress;
}

export function createEffects(scene, camera) {
  const dot = softDot();
  const slashes = createSlashes(scene, camera, dot);
  const blood = createParticles(scene, { max: 400, size: 0.09, blending: THREE.NormalBlending, gravity: 9, drag: 1.5, texture: dot });
  const sparks = createParticles(scene, { max: 400, size: 0.05, blending: THREE.AdditiveBlending, gravity: 6, drag: 2, texture: dot });
  const embers = createParticles(scene, { max: 1500, size: 0.09, blending: THREE.AdditiveBlending, gravity: -0.9, drag: 0.6, texture: dot });
  const dissolving = [];
  const flashes = [];
  let hitStop = 0;

  return {
    // Freeze the action for a split second when a heavy blow lands (it makes hits feel weighty).
    hitStop(seconds) {
      hitStop = Math.max(hitStop, seconds);
    },
    // Use this on each frame's time step: almost zero while a hit-stop is on.
    gameTime(dt) {
      if (hitStop <= 0) return dt;
      hitStop -= dt;
      return dt * 0.05;
    },

    // A blow lands: a spray of dark blood, thrown away from the attacker.
    blood(at, awayFrom) {
      const dir = at.clone().sub(awayFrom).setY(0).normalize().add(new THREE.Vector3(0, 0.6, 0));
      blood.burst(at, dir, { count: 55, speed: 4, spread: 1.4, life: 0.8, color: 0x8a0a0a, colorVariation: 0.45 });
    },
    // A blow is blocked or glances off armour: bright metal sparks.
    sparks(at, awayFrom, count = 30) {
      const dir = at.clone().sub(awayFrom).setY(0).normalize().add(new THREE.Vector3(0, 0.8, 0));
      sparks.burst(at, dir, { count, speed: 7, spread: 1.8, life: 0.45, color: new THREE.Color(4, 2.2, 0.8), colorVariation: 0.4 });
    },

    // A blade cuts through: a white-hot crescent along the cut, and a spray of sparks.
    slash(at, motion, size) {
      slashes.spawn(at, motion, size);
      const dir = motion.clone().normalize().add(new THREE.Vector3(0, 0.4, 0));
      sparks.burst(at, dir, { count: 26, speed: 6, spread: 1.6, life: 0.35, color: new THREE.Color(4, 2.6, 1.2), colorVariation: 0.4 });
    },

    flash(model) {
      const f = createHitFlash(model);
      flashes.push(f);
      return f;
    },

    // The model crumbles away over `seconds`, shedding glowing embers from its bones,
    // then disappears. `onDone` runs at the end.
    disintegrate(model, seconds = 3.5, onDone) {
      const progress = addDissolve(model);
      model.traverse((o) => {
        if (o.isMesh) o.castShadow = false; // its shadow would stay solid otherwise
      });
      const bones = [];
      model.traverse((o) => o.isBone && bones.push(o));
      dissolving.push({ model, progress, bones, time: 0, seconds, onDone });
    },

    // Undo `disintegrate`: the model is whole and visible again.
    restore(model) {
      const i = dissolving.findIndex((d) => d.model === model);
      if (i >= 0) dissolving.splice(i, 1);
      model.traverse((o) => {
        if (!o.isMesh || !o.userData.solidMaterial) return;
        o.material.dispose();
        o.material = o.userData.solidMaterial;
        delete o.userData.solidMaterial;
        o.castShadow = true;
      });
      model.visible = true;
    },

    update(dt) {
      for (const f of flashes) f.update(dt);
      const where = new THREE.Vector3();
      for (let i = dissolving.length - 1; i >= 0; i--) {
        const d = dissolving[i];
        d.time += dt;
        d.progress.value = Math.min(1, d.time / d.seconds);
        // Embers drift up from all over the body while it crumbles.
        const perFrame = Math.round(14 * (1 - d.progress.value * 0.6));
        for (let k = 0; k < perFrame; k++) {
          d.bones[Math.floor(Math.random() * d.bones.length)].getWorldPosition(where);
          where.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
          embers.burst(where, new THREE.Vector3((Math.random() - 0.5) * 0.4, 1, (Math.random() - 0.5) * 0.4), {
            count: 1, speed: 0.9, spread: 0.6, life: 2.4, color: new THREE.Color(3.2, 1.3, 0.35), colorVariation: 0.5,
          });
        }
        if (d.progress.value >= 1) {
          d.model.visible = false;
          dissolving.splice(i, 1);
          d.onDone?.();
        }
      }
      slashes.update(dt);
      blood.update(dt);
      sparks.update(dt);
      embers.update(dt);
    },
  };
}
