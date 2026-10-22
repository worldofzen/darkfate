// The boss: a giant knight with a great sword who waits in the arena.
//
// What it does (a simple "state machine" — it's always in exactly one of these):
//   dormant   standing still until you come through the fog gate
//   intro     a menacing flex before the fight
//   chase     walks or runs at you; circles you while waiting to attack again
//   attack    swings at you (close-range swings, or leaping/spinning ones from further away)
//   recover   a short pause after attacking: your chance to hit back
//   stagger   flinches after taking enough damage in a short time
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
  let flash = 0; // glows red for a moment when hit
  const toPlayer = new THREE.Vector3();
  const materials = [];
  boss.traverse((o) => {
    if (o.isMesh && o.material.emissive && !materials.includes(o.material)) materials.push(o.material);
  });

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
    const wanted = !player.alive || state === 'dormant' || state === 'dead' ? 0 : state === 'stagger' ? 0.3 : 1;
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
    current = { ...attack, ...animator.perform(attack.clip) };
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
        boss.position.addScaledVector(forward(), BOSS.runSpeed * dt);
        animator.locomote('run', BOSS.runSpeed);
      } else if (distance > 3.0 || waitLeft <= 0) {
        boss.position.addScaledVector(forward(), BOSS.walkSpeed * dt);
        animator.locomote('walk', BOSS.walkSpeed);
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
        waitLeft = THREE.MathUtils.randFloat(...BOSS.recoverTime);
        setState('recover');
      }
    } else if (state === 'recover') {
      animator.locomote('idle');
      if (stateTime > 0.3) faceTowards(player.position, dt, BOSS.turnSpeed * 0.5);
      if (stateTime >= waitLeft) setState('chase');
    } else if (state === 'stagger') {
      if (stateTime >= current.duration) backToChase();
    }

    pushOut(boss.position, BOSS.body.radius);
    animator.update(dt);
    lookAtPlayer(player, dt);
    blade.update(dt);

    flash = Math.max(0, flash - dt);
    for (const m of materials) m.emissive.setRGB(flash * 3, flash * 0.4, 0);
  }

  // --- Things the fight tells the boss ---
  function wake() {
    if (state !== 'dormant') return;
    current = animator.perform('power_up', { timeScale: 1.2 }) ?? { duration: 0 };
    setState('intro');
  }

  // Returns true if this hit killed it.
  function takeDamage(amount) {
    if (state === 'dead') return false;
    health = Math.max(0, health - amount);
    sinceHit = 0;
    flash = 0.15;
    if (health <= 0) {
      animator.perform('death');
      setState('dead');
      return true;
    }
    if (state === 'dormant') wake();
    poiseDamage += amount;
    if (poiseDamage >= BOSS.poise && state !== 'intro') {
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
    poiseDamage = 0;
    waitLeft = 0;
    boss.position.copy(home.position);
    boss.rotation.y = home.angle;
    lookWeight = 0;
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
    get healthFraction() {
      return health / BOSS.maxHealth;
    },
  };
}
