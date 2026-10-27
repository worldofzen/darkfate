// The player: movement, combat and the third-person camera.
//
//   WASD          walk (relative to where the camera looks)    Shift   run
//   Left click    attack (click again during a swing to chain the next one: light, heavy, light...)
//   Right click   hold to block with the shield (you can walk while blocking)
//   Space         dodge: roll toward the direction you're pressing, or backstep if none
//   Q / middle click   lock on to the boss (again to let go; with nothing to lock onto,
//                      the camera swings behind you). While locked you face the boss and strafe.
//   R             drink a Flask of Crimson Tears (heals; you can only shuffle slowly while drinking)
//
// Attacks, dodges, running and blocked hits cost stamina (see stamina.js for the numbers).
import * as THREE from 'three';
import { pushOut, cameraBlockers } from './level/colliders.js';
import { STAMINA } from './stamina.js';

const WALK_SPEED = 1.8; // meters per second (the walk animation's own pace is ~1.4)
const RUN_SPEED = 4.5; // (the run animation's own pace is ~4)
const BLOCK_SPEED = 1.4; // slower while holding the shield up
const TURN_SPEED = 12; // how quickly the knight turns to face where it's going
const BODY_RADIUS = 0.4; // how "wide" the knight is when bumping into walls
export const PLAYER_BODY = { radius: 0.45, height: 1.85 }; // for sword hit detection
const MAX_HEALTH = 300;

// Attacks: each click plays the next swing in this list. A swing only hurts during its
// `hits` window (fractions of the swing, measured on the animations): the moment the blade
// actually comes through, not while it's being raised or after it has passed.
const ATTACK_CHAIN = [
  { clip: 'slash', damage: 50, hits: [0.32, 0.55] },
  { clip: 'slash_3', damage: 65, hits: [0.42, 0.62] }, // the finisher hits hardest
];
const ATTACK_TIME_SCALE = 1.3; // play the swings a little faster than the pack does
const COMBO_OPENS = 0.35; // a click after 35% of the swing is remembered for the next one
const RECOVERY = 0.75; // after 75% of the swing you can chain, dodge or walk away

// Dodges. The roll is Mixamo's "Falling To Roll" (mixamo/Knight/Falling To Roll.fbx, renamed
// "roll" in rename.json): a dive forward, over the shoulder and back up. It's played a little
// faster than it comes, and you're free again once he's back on his feet (the rest of the clip
// is just standing). The knight travels exactly as far as the animation does, moment by moment,
// so his feet don't slide.
const ROLL = {
  clip: 'roll',
  timeScale: 1.4,
  over: 0.8, // share of the clip by which he's standing again
};
const BACKSTEP = { clip: 'run_back', timeScale: 1.3 }; // quick hop backwards
const INVULNERABLE_PART = 0.6; // can't be hurt during the first 60% of a dodge

// An attack, dodge or drink pressed while you're still busy (mid-swing, mid-roll, staggering)
// is remembered this long, and happens as soon as it can, like in Dark Souls: you don't have
// to press it on exactly the right frame.
const INPUT_BUFFER = 0.35; // seconds

// Getting hit (or having your guard broken) makes you stagger.
const STAGGER = { clip: 'impact', timeScale: 1.2 };
const BLOCK_ANGLE = 0.3; // the shield only covers hits from in front (about ±70°)

// Flasks of Crimson Tears. Like Elden Ring, a charge is used up the moment you start
// drinking: get hit before the sip and it's wasted. They refill when you respawn at the grace.
export const FLASKS = {
  charges: 4,
  heal: 150, // half your health
  // The Mixamo "Drinking" animation, mirrored to the left hand (the sword is in the right).
  // We only use its middle part — raise, drink, lower — skipping the idle start and end.
  clip: 'drinking_left',
  clipFrom: 0.36,
  clipTo: 0.66,
  sipAt: 0.45, // the heal happens when the head tips back, 45% of the way through
  timeWithoutClip: 1.4, // seconds, if the animation is missing
  moveSpeed: 0.8, // m/s: a slow shuffle while drinking
};

const CAMERA_HEIGHT = 1.5; // the camera looks at this point above the knight's feet
const MOUSE_SENSITIVITY = 0.0025;
const MIN_PITCH = -0.35; // looking up from below
const MAX_PITCH = 1.2; // looking down from above
const MIN_DISTANCE = 2;
const MAX_DISTANCE = 9;
const LOCK_PITCH = 0.3; // camera tilt while locked on
const LOCK_FOLLOW = 8; // how quickly the camera swings round to keep the target in view
const LOCK_LOOK_SHARE = 0.35; // camera aims 35% of the way from you toward the target

// `animator` plays the knight's animations (see animator.js).
// `stamina` pays for actions (see stamina.js).
// `lockOn` picks and tracks the locked-on enemy (see lockOn.js).
// `flask` is the bottle shown in the left hand while drinking (see flask.js).
export function createPlayer(knight, animator, camera, canvas, stamina, lockOn, flask) {
  const keys = new Set();
  let yaw = knight.rotation.y + Math.PI; // camera starts behind the knight
  let pitch = 0.25;
  let distance = 4.5;

  // While the title screen is up, the player can't control anything (see setActive).
  let active = true;

  // Button presses wait here until they can be used (seconds left, see INPUT_BUFFER).
  let attackPressed = 0;
  let dodgePressed = 0;
  let drinkPressed = 0;
  let lockPressed = false;
  let blockHeld = false;
  let recenterYaw = null; // when set, the camera swings round to this angle
  let shake = 0; // camera shake strength, fading out

  // What the knight is doing: 'free' (walking around), 'attack', 'dodge', 'drink', 'stagger' or 'dead'.
  let mode = 'free';
  let health = MAX_HEALTH;
  let flasks = FLASKS.charges;
  let onEmptyFlask = () => {};
  animator.trim('drink', FLASKS.clip, FLASKS.clipFrom, FLASKS.clipTo);
  let swingCount = 0; // each swing gets a number, so one swing can only hit once
  let modeTime = 0; // seconds since the current move started
  let current = null; // timing details of the current move
  let winded = false; // ran out of stamina while running: no running until some comes back
  let comboIndex = 0;
  let comboQueued = false;
  let faceAngle = knight.rotation.y; // where the knight wants to face

  // --- Keyboard ---
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) dodgePressed = INPUT_BUFFER;
    }
    if (e.code === 'KeyQ' && !e.repeat) lockPressed = true;
    if (e.code === 'KeyR' && !e.repeat) drinkPressed = INPUT_BUFFER;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear(); // don't keep walking or blocking if the window loses focus
    blockHeld = false;
  });

  // --- Mouse (Dark Souls style) ---
  // The game captures the mouse, so just moving it turns the camera; no button needed.
  // Esc lets the mouse go (a "Click to continue" note appears); a click captures it again.
  // A few embedded browsers can't capture the mouse: there, moving the mouse over the game
  // still turns the camera, it just stops when the pointer reaches the edge of the window.
  const locked = () => document.pointerLockElement === canvas;
  let canCapture = typeof canvas.requestPointerLock === 'function';
  function capture() {
    if (!canCapture || locked()) return;
    const fail = () => (canCapture = false);
    try {
      // "Unadjusted" = raw mouse movement without the operating system's acceleration, like a game.
      const request = canvas.requestPointerLock({ unadjustedMovement: true });
      if (request?.catch) request.catch(() => Promise.resolve(canvas.requestPointerLock()).catch(fail));
    } catch {
      Promise.resolve(canvas.requestPointerLock()).catch(fail);
    }
  }
  document.addEventListener('pointerlockerror', () => (canCapture = false));

  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right click = block, not a menu
  canvas.addEventListener('mousedown', (e) => {
    if (!active) return;
    if (e.button === 0) {
      if (canCapture && !locked()) capture(); // this click just takes the mouse back
      else attackPressed = INPUT_BUFFER;
    }
    if (e.button === 2) blockHeld = true;
    if (e.button === 1) {
      e.preventDefault(); // no auto-scroll
      lockPressed = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) blockHeld = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!active) return;
    if (canCapture && !locked()) return; // mouse let go (Esc): leave the camera alone
    if (lockOn.target) return; // the lock steers the camera
    yaw -= e.movementX * MOUSE_SENSITIVITY;
    pitch = THREE.MathUtils.clamp(pitch + e.movementY * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
  });
  canvas.addEventListener('wheel', (e) => {
    if (!active) return;
    distance = THREE.MathUtils.clamp(distance + e.deltaY * 0.005, MIN_DISTANCE, MAX_DISTANCE);
  }, { passive: true });

  const input = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  const ray = new THREE.Raycaster();

  // Which way to face to look straight at `target`.
  function angleTo(target) {
    return Math.atan2(target.x - knight.position.x, target.z - knight.position.z);
  }

  // --- Moves ---
  // Each start* function returns false if the move couldn't happen (e.g. no stamina left).
  function startAttack(index) {
    if (!animator.has(ATTACK_CHAIN[index].clip) || !stamina.spend(STAMINA.attack)) return false;
    const swing = animator.perform(ATTACK_CHAIN[index].clip, { timeScale: ATTACK_TIME_SCALE });
    attackPressed = 0;
    mode = 'attack';
    modeTime = 0;
    current = swing;
    swingCount++;
    comboIndex = index;
    comboQueued = false;
    // Swing at the locked-on enemy; otherwise toward where you're pushing, or straight ahead.
    const target = lockOn.target;
    if (target) faceAngle = angleTo(target);
    else faceAngle = input.lengthSq() > 0 ? Math.atan2(input.x, input.z) : knight.rotation.y;
    return true;
  }

  function startDodge() {
    const rolling = input.lengthSq() > 0;
    if (!rolling) return startBackstep();
    if (!rollTravel || !stamina.spend(STAMINA.dodge)) return false;
    dodgePressed = 0;
    faceAngle = Math.atan2(input.x, input.z);
    knight.rotation.y = faceAngle; // rolls snap to the new direction
    const roll = animator.perform(ROLL.clip, { timeScale: ROLL.timeScale, fade: 0.08 });
    mode = 'dodge';
    modeTime = 0;
    const direction = new THREE.Vector3(Math.sin(faceAngle), 0, Math.cos(faceAngle));
    current = { duration: roll.duration * ROLL.over, direction, roll: true, travelled: 0 };
    return true;
  }

  function startBackstep() {
    if (!animator.has(BACKSTEP.clip) || !stamina.spend(STAMINA.backstep)) return false;
    const dodge = animator.perform(BACKSTEP.clip, { timeScale: BACKSTEP.timeScale });
    dodgePressed = 0;
    mode = 'dodge';
    modeTime = 0;
    const back = new THREE.Vector3(-Math.sin(knight.rotation.y), 0, -Math.cos(knight.rotation.y));
    current = { ...dodge, direction: back, roll: false };
    return true;
  }

  // How far forward the roll animation has carried the hips at each moment (meters, by
  // seconds into the clip). Read before the animator pins the hips in place (see animator.js).
  const rollTravel = (() => {
    const clip = knight.animations?.find((c) => c.name === ROLL.clip);
    const track = clip?.tracks.find((t) => /(hips|pelvis).position$/i.test(t.name));
    if (!track) return null;
    const forward = Array.from({ length: track.times.length }, (_, i) => track.values[i * 3 + 2] - track.values[2]);
    return (seconds) => {
      const t = track.times;
      if (seconds <= t[0]) return 0;
      for (let i = 1; i < t.length; i++) {
        if (seconds <= t[i]) return THREE.MathUtils.lerp(forward[i - 1], forward[i], (seconds - t[i - 1]) / (t[i] - t[i - 1]));
      }
      return forward[forward.length - 1];
    };
  })();

  // With no flasks left, nothing happens (the HUD's flask slot flashes) and it returns false.
  function startDrink() {
    drinkPressed = 0;
    if (flasks === 0) {
      onEmptyFlask();
      return false;
    }
    flasks--;
    mode = 'drink';
    modeTime = 0;
    // The arms drink while the legs keep doing whatever they were doing.
    const drink = animator.performUpper('drink');
    current = { duration: drink?.duration ?? FLASKS.timeWithoutClip, healed: false };
    return true;
  }

  function startStagger() {
    const stagger = animator.perform(STAGGER.clip, { timeScale: STAGGER.timeScale });
    if (!stagger) return;
    mode = 'stagger';
    modeTime = 0;
    current = stagger;
  }

  function die() {
    mode = 'dead';
    lockOn.release();
    animator.setUpperPose(null);
    animator.perform('death');
  }

  // An enemy hits you for `damage`, from `from` (a world position).
  // Returns what happened: 'dodged', 'blocked', 'guard broken', 'hit' or 'killed'.
  function takeHit(damage, from) {
    if (mode === 'dead') return 'killed';
    if (mode === 'dodge' && modeTime < current.duration * INVULNERABLE_PART) return 'dodged';
    const toAttacker = new THREE.Vector3().subVectors(from, knight.position).setY(0).normalize();
    const facing = new THREE.Vector3(Math.sin(knight.rotation.y), 0, Math.cos(knight.rotation.y));
    if (mode === 'free' && blockHeld && facing.dot(toAttacker) > BLOCK_ANGLE) {
      const cost = damage * STAMINA.blockPerDamage;
      const enough = stamina.value >= cost;
      stamina.spend(cost);
      if (enough) return 'blocked';
      startStagger(); // not enough stamina to hold the shield up: guard broken
      return 'guard broken';
    }
    health = Math.max(0, health - damage);
    if (health <= 0) {
      die();
      return 'killed';
    }
    startStagger();
    return 'hit';
  }

  // Back to full health, standing at `position` facing `angle` (used when you respawn).
  function reset(position, angle) {
    health = MAX_HEALTH;
    flasks = FLASKS.charges;
    knight.position.copy(position);
    knight.rotation.y = faceAngle = angle;
    yaw = angle + Math.PI;
    mode = 'free';
    winded = false;
    animator.release();
    animator.locomote('idle');
  }

  function backToFree() {
    mode = 'free';
    animator.release();
  }

  function turnTowards(angle, dt) {
    knight.rotation.y = approachAngle(knight.rotation.y, angle, TURN_SPEED * dt);
  }

  // Move angle `from` part of the way toward `to`, turning the short way around.
  function approachAngle(from, to, amount) {
    const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + diff * Math.min(1, amount);
  }

  // While locked on: walk forward or back, or sidestep, depending on which way
  // you're pushing compared to the way the knight faces.
  function strafeClip(direction, angle) {
    const ahead = direction.x * Math.sin(angle) + direction.z * Math.cos(angle);
    const toRight = -direction.x * Math.cos(angle) + direction.z * Math.sin(angle);
    if (Math.abs(ahead) >= Math.abs(toRight)) return ahead >= 0 ? 'walk' : 'walk_back';
    return toRight > 0 ? 'strafe_right' : 'strafe_left';
  }

  function update(dt) {
    // 1. Which way do the keys point? (W = away from the camera, D = camera's right)
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    input.set(
      -Math.sin(yaw) * forward + Math.cos(yaw) * right,
      0,
      -Math.cos(yaw) * forward - Math.sin(yaw) * right
    );
    if (input.lengthSq() > 0) input.normalize();

    // Lock on or let go. With nothing to lock onto, the camera swings behind you instead.
    if (lockPressed && mode !== 'dead') {
      const wasLocked = !!lockOn.target;
      const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
      if (!lockOn.toggle(cameraDirection) && !wasLocked) recenterYaw = knight.rotation.y + Math.PI;
    }
    lockPressed = false;
    lockOn.update();
    const target = lockOn.target;

    // 2. Do whatever the current mode allows.
    if (mode === 'attack') {
      modeTime += dt;
      const progress = modeTime / current.duration;
      if (progress < 0.25) turnTowards(faceAngle, dt); // small aim adjustment at the start
      if (attackPressed && progress > COMBO_OPENS) {
        comboQueued = true;
        attackPressed = 0;
      }
      if (progress >= RECOVERY) {
        const chained = comboQueued && startAttack((comboIndex + 1) % ATTACK_CHAIN.length); // keeps going round the chain
        if (!chained) {
          comboQueued = false;
          if (!(dodgePressed && startDodge()) && (input.lengthSq() > 0 || progress >= 1)) backToFree();
        }
      }
    } else if (mode === 'dodge') {
      modeTime += dt;
      const progress = modeTime / current.duration;
      if (current.roll) {
        // Move as far as the animation has carried him since last frame.
        const travelled = rollTravel(Math.min(modeTime, current.duration) * ROLL.timeScale);
        knight.position.addScaledVector(current.direction, travelled - current.travelled);
        current.travelled = travelled;
      } else {
        const ease = progress < 0.75 ? 1 : Math.max(0, (1 - progress) / 0.25); // backsteps slow at the end
        knight.position.addScaledVector(current.direction, current.speed * ease * dt);
      }
      pushOut(knight.position, BODY_RADIUS);
      if (progress >= 1) backToFree();
    } else if (mode === 'stagger') {
      modeTime += dt;
      if (modeTime >= current.duration) backToFree();
    } else if (mode === 'drink') {
      modeTime += dt;
      const progress = modeTime / current.duration;
      if (!current.healed && progress >= FLASKS.sipAt) {
        health = Math.min(MAX_HEALTH, health + FLASKS.heal);
        current.healed = true;
      }
      if (progress >= 1) {
        mode = 'free';
        animator.releaseUpper();
      }
    }
    // (when 'dead', nothing happens until the game respawns you)

    // Walking around — also while drinking, but only slowly and without other actions.
    if (mode === 'free' || mode === 'drink') {
      const drinking = mode === 'drink';
      const acted =
        !drinking &&
        ((attackPressed && startAttack(0)) || (dodgePressed && startDodge()) || (drinkPressed && startDrink()));
      if (!acted) {
        const blocking = blockHeld && !drinking;
        animator.setUpperPose(blocking ? 'block_idle' : null);
        if (winded && stamina.fraction >= STAMINA.runAgainAt) winded = false;
        const wantsToRun = !blocking && !drinking && input.lengthSq() > 0 && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
        if (wantsToRun && stamina.value <= 0) winded = true;
        const running = wantsToRun && !winded;
        if (running) stamina.spend(STAMINA.runPerSecond * dt);
        if (input.lengthSq() > 0) {
          const speed = drinking ? FLASKS.moveSpeed : blocking ? BLOCK_SPEED : running ? RUN_SPEED : WALK_SPEED;
          knight.position.addScaledVector(input, speed * dt);
          pushOut(knight.position, BODY_RADIUS);
          if (target && !running) {
            // Locked on: keep facing the enemy and step around it.
            faceAngle = angleTo(target);
            turnTowards(faceAngle, dt);
            animator.locomote(strafeClip(input, faceAngle), speed);
          } else {
            // Running (even when locked on, like Elden Ring) turns you the way you go.
            faceAngle = Math.atan2(input.x, input.z);
            turnTowards(faceAngle, dt);
            animator.locomote(running ? 'run' : 'walk', speed);
          }
        } else {
          if (target) {
            faceAngle = angleTo(target);
            turnTowards(faceAngle, dt);
          }
          animator.locomote('idle');
        }
      }
    }
    attackPressed = Math.max(0, attackPressed - dt);
    dodgePressed = Math.max(0, dodgePressed - dt);
    drinkPressed = Math.max(0, drinkPressed - dt);
    stamina.update(dt, { blocking: mode === 'free' && blockHeld });
    animator.update(dt);

    // The flask is in hand only while drinking, and glows brightest at the sip.
    if (flask) {
      flask.userData.show(mode === 'drink');
      const progress = mode === 'drink' ? modeTime / current.duration : 0;
      flask.userData.setGlow(mode === 'drink' ? Math.sin(Math.PI * Math.min(progress, 1)) : 0);
    }

    if (!active) return; // the title screen moves the camera itself

    // 3. Put the camera behind the knight. If a wall is in the way, move the camera in front of it.
    if (target) {
      // Locked on: swing round so you're between the camera and the enemy.
      const behind = Math.atan2(knight.position.x - target.x, knight.position.z - target.z);
      yaw = approachAngle(yaw, behind, LOCK_FOLLOW * dt);
      pitch += (LOCK_PITCH - pitch) * Math.min(1, LOCK_FOLLOW * dt);
      recenterYaw = null;
    } else if (recenterYaw !== null) {
      yaw = approachAngle(yaw, recenterYaw, LOCK_FOLLOW * dt);
      if (Math.abs(Math.sin(yaw - recenterYaw)) < 0.01) recenterYaw = null;
    }
    lookAt.set(knight.position.x, knight.position.y + CAMERA_HEIGHT, knight.position.z);
    wanted.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );
    ray.set(lookAt, wanted);
    ray.far = distance;
    const hit = ray.intersectObjects(cameraBlockers, false)[0];
    const camDistance = hit ? Math.max(0.5, hit.distance - 0.3) : distance;

    camera.position.copy(lookAt).addScaledVector(wanted, camDistance);
    camera.position.y = Math.max(camera.position.y, 0.3); // never below the floor
    if (shake > 0.001) {
      camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
      shake *= Math.pow(0.002, dt); // dies away in a fraction of a second
    }
    // Locked on, the camera aims between you and the enemy so both stay on screen.
    camera.lookAt(target ? lookAt.lerp(target, LOCK_LOOK_SHARE) : lookAt);
  }

  return {
    update,
    // Switch the controls on or off (off while the title screen is showing).
    setActive(on) {
      active = on;
      keys.clear();
      blockHeld = false;
      if (on) capture();
    },
    takeHit,
    reset,
    get mode() {
      return mode;
    },
    // Shake the camera (e.g. 0.3 for a heavy hit).
    shake(strength) {
      shake = Math.max(shake, strength);
    },
    // True when the mouse has been let go (Esc) and a click is needed to carry on.
    get mouseFree() {
      return active && canCapture && !locked();
    },
    get health() {
      return health;
    },
    get flasks() {
      return flasks;
    },
    // Called when you try to drink with no flasks left (the HUD flashes).
    onEmptyFlask(callback) {
      onEmptyFlask = callback;
    },
    get healthFraction() {
      return health / MAX_HEALTH;
    },
    // The swing in progress (null if not attacking): its number, how much damage it does, and
    // whether the blade is coming through right now (`cutting`).
    get swing() {
      if (mode !== 'attack') return null;
      const { damage, hits } = ATTACK_CHAIN[comboIndex];
      const progress = modeTime / current.duration;
      return { id: swingCount, damage, cutting: progress >= hits[0] && progress <= hits[1] };
    },
    get blocking() {
      return mode === 'free' && blockHeld;
    },
    // True during the protected part of a dodge (for when enemies can hit you).
    get invulnerable() {
      return mode === 'dodge' && modeTime < current.duration * INVULNERABLE_PART;
    },
  };
}
