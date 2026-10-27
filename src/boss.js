// The boss: a giant knight with a great sword who waits in the arena.
//
// What it does (a simple "state machine" — it's always in exactly one of these):
//   dormant   standing still until you come through the fog gate
//   intro     a menacing flex before the fight
//   chase     walks or runs at you; circles you while waiting to attack again
//   attack    swings at you (close-range swings, or leaping/spinning ones from further away)
//   recover   a short pause after attacking: your chance to hit back
//   stagger   flinches after taking enough damage in a short time
//   rage      the first health bar is empty: it roars, its body catches fire from within, and
//             a second, fresh health bar fills up (it can't be hurt while this happens)
//
// After `rage` comes the second phase: it glows red, swings faster and harder, and barely
// pauses between attacks.
//
// Every hit also makes it recoil (on top of whatever it's doing): its upper body snaps back
// away from the blow, it's shoved back half a step, and its body flashes white-hot, cooling
// to red. A giant doesn't drop its attack for one cut; only its poise breaking does that.
//   dead      falls and stays down
import * as THREE from 'three';
import { pushOut } from './level/colliders.js';

export const BOSS = {
  name: 'Warden of the Black Spire',
  scale: 1.6, // 1.6x the size of a person (about 3.1 m tall)
  maxHealth: 1400,
  body: { radius: 0.9, height: 3.0 }, // for sword hit detection and bumping into you
  walkSpeed: 1.7,
  runSpeed: 5.0,
  turnSpeed: 2.6, // radians per second: slow enough that you can get behind it
  runIfFurtherThan: 7,
  poise: 240, // this much damage within `poiseResetTime` seconds makes it stagger
  poiseResetTime: 4,
  recoverTime: [0.4, 1.1], // random pause after each attack (seconds)
  bladeCutSpeed: 5, // the blade hurts only while moving faster than this (m/s)
  flashTime: 0.16, // seconds the body glows after a hit
  recoil: { angle: 0.3, twist: 0.45, shove: 2.4 }, // radians (at full strength), share of that as a twist, m/s
  phase2: {
    name: 'Warden of the Black Spire, Unbound',
    maxHealth: 1100,
    speed: 1.2, // attacks and footwork play this much faster
    damage: 1.2, // times each attack's damage
    recoverTime: [0.15, 0.55],
    glowColor: [1.0, 0.07, 0.02], // the red fire inside it
  },
};

// `range` is the distance (m) at which the boss chooses that attack.
// `lunge` attacks travel forward toward you.
const ATTACKS = [
  { clip: 'slash', range: [0, 3.6], damage: 45 },
  { clip: 'attack', range: [0, 3.8], damage: 40 },
  { clip: 'slash_5', range: [0, 3.6], damage: 42 },
  { clip: 'slash_3', range: [0, 3.6], damage: 48 },
  { clip: 'high_spin_attack', range: [3.2, 8], damage: 52, lunge: true },
  { clip: 'slide_attack', range: [4, 9], damage: 50, lunge: true },
  { clip: 'jump_attack', range: [4.5, 11], damage: 62, lunge: true },
];

export function createBoss(boss, animator, blade, home) {
  let state = 'dormant';
  let stateTime = 0;
  let health = BOSS.maxHealth;
  let poiseDamage = 0;
  let sinceHit = 0;
  let current = null; // the attack or move being played
  let hitThisSwing = false;
  let waitLeft = 0;
  let strafeSide = 1;
  let flash = 0; // glows for a moment when hit
  let phase = 1;
  let glow = 0; // the second phase's red glow (0 = none, 1 = full)
  const toPlayer = new THREE.Vector3();
  const materials = [];
  boss.traverse((o) => {
    if (o.isMesh && o.material.emissive && !materials.includes(o.material)) materials.push(o.material);
  });

  // --- Glowing red (second phase) ---
  // A dim red over the whole body, burning brighter toward its outline (where you see the
  // surface edge-on), so it looks lit from inside; the bloom spreads it into the air. A red
  // light in its chest throws the glow onto the floor around it. (The light is there from the
  // start, just off, so switching it on doesn't make every material rebuild its shader.)
  const glowUniform = { value: 0 };
  const glowColor = new THREE.Vector3(...BOSS.phase2.glowColor);
  for (const m of materials) {
    const previous = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      previous?.call(m, shader, renderer);
      shader.uniforms.bossGlow = glowUniform;
      shader.uniforms.bossGlowColor = { value: glowColor };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float bossGlow;
          uniform vec3 bossGlowColor;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float edgeOn = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += bossGlowColor * bossGlow * (0.03 + 0.9 * pow(edgeOn, 3.0));`);
    };
  }
  const glowLight = new THREE.PointLight(0xff2010, 0, 9, 2);
  (boss.getObjectByName('spine_03') ?? boss).add(glowLight);

  // --- Glaring down at you ---
  // The animations look straight ahead, which for a 3 m giant means over your head. After
  // each frame's animation, the chest, neck and head each bend part of the way toward you.
  const LOOK_BONES = [['spine_03', 0.3], ['neck_01', 0.3], ['head', 0.4]]
    .map(([name, share]) => ({ bone: boss.getObjectByName(name), share }))
    .filter((b) => b.bone);
  const headBone = boss.getObjectByName('head');
  const LOOK_LIMIT = THREE.MathUtils.degToRad(55); // it can't bend further than this
  let lookWeight = 0; // 0 = plain animation, 1 = fully looking at you (eases in and out)
  const NO_TURN = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  const parentTurn = new THREE.Quaternion();
  const headAt = new THREE.Vector3();
  const toYou = new THREE.Vector3();
  const facing = new THREE.Vector3(); // where the head points now (its +z axis)
  const flatFacing = new THREE.Vector3();
  const flatToYou = new THREE.Vector3();
  const wantedDir = new THREE.Vector3();
  const headTurn = new THREE.Quaternion();

  function lookAtPlayer(player, dt) {
    const wanted = !player.alive || state === 'dormant' || state === 'dead' ? 0 : state === 'stagger' || state === 'rage' ? 0.3 : 1;
    lookWeight += (wanted - lookWeight) * Math.min(1, dt * 4);
    if (lookWeight < 0.01 || !headBone) return;
    boss.updateMatrixWorld(true);
    headBone.getWorldPosition(headAt);
    toYou.set(player.position.x, player.position.y + 1.3, player.position.z).sub(headAt).normalize(); // your chest
    // Mostly tilt down to your height; only turn partly sideways toward you, so the head
    // doesn't whip around during spinning attacks.
    facing.set(0, 0, 1).applyQuaternion(headBone.getWorldQuaternion(headTurn));
    flatFacing.set(facing.x, 0, facing.z).normalize();
    flatToYou.set(toYou.x, 0, toYou.z).normalize();
    flatFacing.lerp(flatToYou, 0.5).normalize();
    const down = Math.asin(THREE.MathUtils.clamp(-toYou.y, -1, 1));
    wantedDir.copy(flatFacing).multiplyScalar(Math.cos(down)).setY(-Math.sin(down));
    turn.setFromUnitVectors(facing, wantedDir);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    if (angle > LOOK_LIMIT) turn.slerpQuaternions(NO_TURN, turn, LOOK_LIMIT / angle);
    // Each bone takes its share of the turn (a turn in world space, converted to the bone's own space).
    for (const { bone, share } of LOOK_BONES) {
      part.slerpQuaternions(NO_TURN, turn, share * lookWeight);
      bone.parent.getWorldQuaternion(parentTurn);
      bone.quaternion.premultiply(parentTurn.clone().invert().multiply(part).multiply(parentTurn));
      bone.updateMatrixWorld(true);
    }
  }

  // --- Recoiling from a hit ---
  // The spine and head bend back away from the blow and twist a little: a sharp snap, then
  // settling back over half a second, added after the animation (like the glare above).
  const RECOIL_BONES = [['spine_01', 0.25], ['spine_02', 0.3], ['spine_03', 0.3], ['head', 0.15]]
    .map(([name, share]) => ({ bone: boss.getObjectByName(name), share }))
    .filter((b) => b.bone);
  const UP = new THREE.Vector3(0, 1, 0);
  const recoilAxis = new THREE.Vector3();
  const knock = new THREE.Vector3(); // shove velocity (m/s)
  const bend = new THREE.Quaternion();
  const twist = new THREE.Quaternion();
  let recoilTime = Infinity;
  let recoilStrength = 0;
  let recoilTwist = 0;

  function recoil(from, strength) {
    const away = new THREE.Vector3().subVectors(boss.position, from).setY(0);
    if (away.lengthSq() < 1e-6) away.copy(forward()).negate();
    away.normalize();
    recoilAxis.crossVectors(UP, away).normalize(); // turning about this tips the top away from you
    recoilTime = 0;
    recoilStrength = strength;
    recoilTwist = (Math.random() < 0.5 ? -1 : 1) * BOSS.recoil.twist;
    knock.copy(away).multiplyScalar(BOSS.recoil.shove * strength);
  }

  function applyRecoil(dt) {
    recoilTime += dt;
    const t = recoilTime;
    const amount = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 7); // snap, then settle
    if (amount < 0.01 || state === 'dead') return;
    const angle = BOSS.recoil.angle * recoilStrength * amount;
    bend.setFromAxisAngle(recoilAxis, angle).multiply(twist.setFromAxisAngle(UP, angle * recoilTwist));
    boss.updateMatrixWorld(true);
    for (const { bone, share } of RECOIL_BONES) {
      part.slerpQuaternions(NO_TURN, bend, share);
      bone.parent.getWorldQuaternion(parentTurn);
      bone.quaternion.premultiply(parentTurn.clone().invert().multiply(part).multiply(parentTurn));
      bone.updateMatrixWorld(true);
    }
  }

  function setState(next) {
    state = next;
    stateTime = 0;
  }

  function faceTowards(target, dt, speed = BOSS.turnSpeed) {
    const angle = Math.atan2(target.x - boss.position.x, target.z - boss.position.z);
    let diff = angle - boss.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const step = speed * dt;
    boss.rotation.y += THREE.MathUtils.clamp(diff, -step, step);
    return Math.abs(diff);
  }

  function forward() {
    return new THREE.Vector3(Math.sin(boss.rotation.y), 0, Math.cos(boss.rotation.y));
  }

  function chooseAttack(distance) {
    const options = ATTACKS.filter((a) => distance >= a.range[0] && distance <= a.range[1] && animator.has(a.clip));
    return options[Math.floor(Math.random() * options.length)] ?? null;
  }

  function startAttack(attack) {
    const enraged = phase === 2;
    current = { ...attack, ...animator.perform(attack.clip, { timeScale: enraged ? BOSS.phase2.speed : 1 }) };
    if (enraged) current.damage = Math.round(attack.damage * BOSS.phase2.damage);
    hitThisSwing = false;
    setState('attack');
  }

  function backToChase() {
    animator.release();
    setState('chase');
  }

  // --- Called by the fight every frame ---
  // `player` is { position, alive, takeHit(damage, from) } and `playerBody` its size.
  function update(dt, player, playerBody) {
    stateTime += dt;
    const pace = phase === 2 ? BOSS.phase2.speed : 1; // footwork
    sinceHit += dt;
    if (sinceHit > BOSS.poiseResetTime) poiseDamage = 0;
    toPlayer.subVectors(player.position, boss.position).setY(0);
    const distance = toPlayer.length();

    if (state === 'dormant') {
      animator.locomote('idle');
    } else if (state === 'intro') {
      faceTowards(player.position, dt);
      if (stateTime >= current.duration) backToChase();
    } else if (state === 'chase' && !player.alive) {
      animator.locomote('idle'); // you're down: it stands over you
    } else if (state === 'chase') {
      faceTowards(player.position, dt);
      waitLeft -= dt;
      const attack = waitLeft <= 0 && chooseAttack(distance);
      if (attack) {
        startAttack(attack);
      } else if (distance > BOSS.runIfFurtherThan) {
        boss.position.addScaledVector(forward(), BOSS.runSpeed * pace * dt);
        animator.locomote('run', BOSS.runSpeed * pace);
      } else if (distance > 3.0 || waitLeft <= 0) {
        boss.position.addScaledVector(forward(), BOSS.walkSpeed * pace * dt);
        animator.locomote('walk', BOSS.walkSpeed * pace);
      } else {
        // Close but still catching its breath: circle around you.
        if (stateTime > 2) {
          strafeSide = -strafeSide;
          stateTime = 0;
        }
        const side = new THREE.Vector3(toPlayer.z, 0, -toPlayer.x).normalize().multiplyScalar(strafeSide);
        boss.position.addScaledVector(side, BOSS.walkSpeed * 0.8 * dt);
        animator.locomote(strafeSide > 0 ? 'strafe_left' : 'strafe_right', BOSS.walkSpeed * 0.8);
      }
    } else if (state === 'attack') {
      const progress = stateTime / current.duration;
      if (progress < 0.3) faceTowards(player.position, dt); // tracks you during the wind-up
      if (current.lunge && progress < 0.8 && distance > BOSS.body.radius + playerBody.radius + 0.3) {
        boss.position.addScaledVector(forward(), current.speed * dt);
      }
      if (!hitThisSwing && progress > 0.1 && blade.speed > BOSS.bladeCutSpeed && blade.hits({ position: player.position, ...playerBody })) {
        hitThisSwing = true;
        player.takeHit(current.damage, boss.position);
      }
      if (progress >= 1) {
        animator.release();
        waitLeft = THREE.MathUtils.randFloat(...(phase === 2 ? BOSS.phase2.recoverTime : BOSS.recoverTime));
        setState('recover');
      }
    } else if (state === 'recover') {
      animator.locomote('idle');
      if (stateTime > 0.3) faceTowards(player.position, dt, BOSS.turnSpeed * 0.5);
      if (stateTime >= waitLeft) setState('chase');
    } else if (state === 'stagger') {
      if (stateTime >= current.duration) backToChase();
    } else if (state === 'rage') {
      faceTowards(player.position, dt, BOSS.turnSpeed * 0.5);
      if (stateTime >= current.duration) {
        phase = 2;
        health = BOSS.phase2.maxHealth;
        backToChase();
      }
    }

    // Shoved back by a hit (quickly slowing to a stop).
    if (state !== 'dead' && knock.lengthSq() > 1e-4) {
      boss.position.addScaledVector(knock, dt);
      knock.multiplyScalar(Math.max(0, 1 - dt * 9));
    }
    pushOut(boss.position, BOSS.body.radius);
    animator.update(dt);
    lookAtPlayer(player, dt);
    applyRecoil(dt);
    blade.update(dt);

    // The hit flash: white-hot at first, cooling through orange to dark red as it fades.
    flash = Math.max(0, flash - dt);
    const k = flash / BOSS.flashTime;
    for (const m of materials) m.emissive.setRGB(0.42 * k, 0.28 * k * k, 0.18 * k * k * k);

    // The red glow: catches during the roar, then throbs like a heartbeat; dies with it.
    const glowWanted = state === 'dead' ? 0 : state === 'rage' ? Math.min(1, (stateTime / current.duration) * 1.5) : phase === 2 ? 1 : 0;
    glow += (glowWanted - glow) * Math.min(1, dt * (state === 'dead' ? 1.5 : 4));
    const beat = 0.8 + 0.2 * Math.sin((performance.now() / 1000) * 4.5);
    glowUniform.value = glow * beat;
    glowLight.intensity = 14 * glow * beat;
  }

  // --- Things the fight tells the boss ---
  function wake() {
    if (state !== 'dormant') return;
    current = animator.perform('power_up', { timeScale: 1.2 }) ?? { duration: 0 };
    setState('intro');
  }

  // `from`: where the blow came from. Returns true if this hit killed it.
  function takeDamage(amount, from) {
    if (state === 'dead' || state === 'rage') return false;
    health = Math.max(0, health - amount);
    sinceHit = 0;
    flash = BOSS.flashTime;
    if (from && health > 0) recoil(from, THREE.MathUtils.clamp(amount / 55, 0.7, 1.4)); // harder blows rock it further
    if (health <= 0 && phase === 1) {
      // Not dead yet: the second phase begins.
      poiseDamage = 0;
      knock.set(0, 0, 0);
      current = animator.perform('power_up', { timeScale: 0.85 }) ?? { duration: 2 };
      setState('rage');
      return false;
    }
    if (health <= 0) {
      animator.perform('death');
      setState('dead');
      return true;
    }
    if (state === 'dormant') wake();
    poiseDamage += amount;
    if (poiseDamage >= BOSS.poise * phase && state !== 'intro') { // twice as hard to stagger once enraged
      poiseDamage = 0;
      const stagger = animator.perform('impact', { timeScale: 1.1 });
      if (stagger) {
        current = stagger;
        setState('stagger');
      }
    }
    return false;
  }

  // Back to the start, full health, waiting (used when you die and respawn).
  function reset() {
    health = BOSS.maxHealth;
    phase = 1;
    glow = 0;
    poiseDamage = 0;
    waitLeft = 0;
    boss.position.copy(home.position);
    boss.rotation.y = home.angle;
    lookWeight = 0;
    recoilTime = Infinity;
    knock.set(0, 0, 0);
    animator.release();
    animator.locomote('idle');
    setState('dormant');
  }

  return {
    update,
    wake,
    takeDamage,
    reset,
    get state() {
      return state;
    },
    // 1 or 2 (it becomes 2 as soon as the second health bar starts filling).
    get phase() {
      return state === 'rage' ? 2 : phase;
    },
    // Of the current phase's health bar. While it roars, the second bar fills up.
    get healthFraction() {
      if (state === 'rage') return Math.min(1, stateTime / current.duration);
      return health / (phase === 2 ? BOSS.phase2.maxHealth : BOSS.maxHealth);
    },
  };
}
