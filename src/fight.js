// The boss fight, from start to finish:
//   - it starts when you walk through the fog gate (the fog then turns solid behind you)
//   - your sword hurts the boss, and the boss's sword hurts you (see hitbox.js and below)
//   - you and the boss can't walk through each other
//   - if you die: "YOU DIED", then you're back at the Site of Grace and the boss resets
//   - if the boss dies: "ENEMY FELLED", and the fog gate disappears for good
import * as THREE from 'three';
import { GATE_Z } from './level/layout.js';
import { pushOut } from './level/colliders.js';
import { BOSS } from './boss.js';
import { PLAYER_BODY } from './player.js';

const FIGHT_STARTS_PAST = GATE_Z - 1.5; // a little way into the arena
// Your hits: the blade decides WHEN a swing hurts (only while it's moving fast), and the boss
// must be within reach in front of you. (The pack's swings curve around the knight's sword side
// rather than straight ahead, so tracing the blade exactly made hits on a target right in front
// of you miss.) The boss's big swings DO trace its blade exactly, so you can dodge under them.
const PLAYER_CUT_SPEED = 4; // m/s
const PLAYER_REACH = 1.8; // meters from your center to the boss's body (arm + sword)
const PLAYER_ARC = THREE.MathUtils.degToRad(80); // how far to the side a swing still connects
const YOU_DIED_AFTER = 1.2; // seconds after falling
const RESPAWN_AFTER = 5;
const HIDE_BOSS_BAR_AFTER_WIN = 5;

const DISINTEGRATE_AFTER = 2.3; // seconds after the killing blow: the boss has fallen by then

export function createFight({ knight, player, playerBlade, bossModel, boss, level, hud, stamina, effects, onBossGone }) {
  let state = 'waiting'; // 'waiting', 'fighting', 'won' or 'lost'
  let timer = 0;
  let lastSwingThatHit = -1;
  let bannerShown = false;
  const spawn = { position: knight.position.clone(), angle: knight.rotation.y };
  const target = {
    position: knight.position,
    get alive() {
      return player.mode !== 'dead';
    },
    // The boss's sword connects: what happens depends on whether you blocked or dodged.
    takeHit: (damage, from) => {
      const result = player.takeHit(damage, from);
      const at = knight.position.clone().add(new THREE.Vector3(0, 1.25, 0));
      at.addScaledVector(new THREE.Vector3().subVectors(from, knight.position).setY(0).normalize(), 0.3);
      if (result === 'hit' || result === 'killed') {
        effects.blood(at, from);
        knightFlash.trigger();
        hud.flashDamage();
        player.shake(0.35);
        effects.hitStop(0.09);
      } else if (result === 'blocked') {
        effects.sparks(at, from, 30);
        player.shake(0.15);
        effects.hitStop(0.05);
      } else if (result === 'guard broken') {
        effects.sparks(at, from, 60);
        hud.flashDamage();
        player.shake(0.3);
        effects.hitStop(0.08);
      }
      return result;
    },
  };
  const knightFlash = effects.flash(knight);
  const bossChest = bossModel.getObjectByName('spine_03');
  let disintegrated = false;
  const apart = new THREE.Vector3();
  const facing = new THREE.Vector3();

  function bossInReach() {
    apart.subVectors(bossModel.position, knight.position).setY(0);
    facing.set(Math.sin(knight.rotation.y), 0, Math.cos(knight.rotation.y));
    return apart.length() - BOSS.body.radius <= PLAYER_REACH && facing.angleTo(apart) <= PLAYER_ARC;
  }

  function startFight() {
    state = 'fighting';
    boss.wake();
    hud.showBoss(BOSS.name);
    level.setFogGateSolid(true);
  }

  function respawn() {
    player.reset(spawn.position, spawn.angle);
    stamina.reset();
    bannerShown = false;
    if (boss.state === 'dead') {
      state = 'won';
      return;
    }
    boss.reset();
    level.restoreFogGate();
    hud.hideBoss();
    state = 'waiting';
  }

  function update(dt) {
    // Both swords are tracked every frame, after the animations have moved them.
    playerBlade.update(dt);
    boss.update(dt, target, PLAYER_BODY);

    if (state === 'waiting' && target.alive && knight.position.z < FIGHT_STARTS_PAST) startFight();

    // Your sword hitting the boss (each swing can only hit once).
    const swing = player.swing;
    if (
      state === 'fighting' &&
      swing &&
      swing.id !== lastSwingThatHit &&
      playerBlade.speed > PLAYER_CUT_SPEED &&
      bossInReach()
    ) {
      lastSwingThatHit = swing.id;
      const at = bossChest.getWorldPosition(new THREE.Vector3());
      // The slash flashes across the front of its body, on your side, along your blade's path.
      const cut = at.clone().addScaledVector(apart.setY(0).normalize(), -BOSS.body.radius * 0.7);
      effects.slash(cut, playerBlade.motion(), swing.damage > 55 ? 2.9 : 2.3);
      effects.blood(at, knight.position);
      effects.hitStop(0.06);
      player.shake(0.08);
      if (boss.takeDamage(swing.damage, knight.position)) {
        state = 'won';
        timer = 0;
        hud.showBanner('ENEMY FELLED', 'felled', 4);
        level.removeFogGate();
      }
    }

    // Keep you from walking through the boss (the boss shoves you aside).
    if (boss.state !== 'dead') {
      apart.subVectors(knight.position, bossModel.position).setY(0);
      const minimum = PLAYER_BODY.radius + BOSS.body.radius;
      const gap = apart.length();
      if (gap < minimum) {
        if (gap < 1e-4) apart.set(0, 0, 1);
        knight.position.addScaledVector(apart.normalize(), minimum - gap);
        pushOut(knight.position, PLAYER_BODY.radius);
      }
    }

    // Dying.
    if (!target.alive && state !== 'lost') {
      state = 'lost';
      timer = 0;
    }
    if (state === 'lost') {
      timer += dt;
      if (!bannerShown && timer > YOU_DIED_AFTER) {
        bannerShown = true;
        hud.showBanner('YOU DIED', 'died', 3.2);
      }
      if (timer > RESPAWN_AFTER) respawn();
    }
    if (state === 'won') {
      timer += dt;
      if (timer > HIDE_BOSS_BAR_AFTER_WIN) hud.hideBoss();
      // Once the boss has fallen, it crumbles away into embers.
      if (!disintegrated && timer > DISINTEGRATE_AFTER) {
        disintegrated = true;
        effects.disintegrate(bossModel, 3.5, onBossGone);
      }
    }

    hud.boss.update(boss.healthFraction, dt);
    hud.health.update(player.healthFraction, dt);
  }

  // A fresh start after the end credits: the boss is back, whole and waiting behind
  // the fog, and you're at the Site of Grace with full health and flasks.
  function restart() {
    effects.restore(bossModel);
    disintegrated = false;
    boss.reset();
    player.reset(spawn.position, spawn.angle);
    stamina.reset();
    level.restoreFogGate();
    hud.hideBoss();
    bannerShown = false;
    lastSwingThatHit = -1;
    state = 'waiting';
  }

  return {
    update,
    restart,
    get state() {
      return state;
    },
  };
}
