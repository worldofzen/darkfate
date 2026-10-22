// Plays a character's animations (knight or boss) and blends smoothly between them.
//
// Every animation is split into two halves that can play different things at once:
//   - lower body (hips and legs)
//   - upper body (spine, arms, head)
// That's how the knight can walk with the legs while holding the shield up with the arms.
//
// There are four kinds of animation:
//   - locomotion: idle / walk / run, always running underneath
//   - an upper-body pose, e.g. blocking, laid over the locomotion
//   - an upper-body move, e.g. drinking a flask, played once while the legs keep walking
//   - a full-body move, e.g. an attack or a dodge, that takes over both halves until released
import * as THREE from 'three';

const FADE = 0.2; // seconds to blend from one animation to the next

// `scale` is how much bigger than normal the character is drawn (the boss is 1.6x):
// bigger legs cover more ground per step, so the animation speeds are scaled to match.
export function createAnimator(character, clips, { scale = 1 } = {}) {
  const mixer = new THREE.AnimationMixer(character);

  const upperBones = new Set();
  character.getObjectByName('spine_01')?.traverse((bone) => upperBones.add(bone.name));
  const isUpper = (track) => upperBones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName);

  // Animations are prepared the first time they're asked for.
  const library = {};
  function get(name) {
    if (name in library) return library[name];
    const clip = clips.find((c) => c.name === name);
    if (!clip) return (library[name] = null);
    const speed = keepInPlace(clip) * scale;
    const half = (part, tracks) => mixer.clipAction(new THREE.AnimationClip(`${name}:${part}`, clip.duration, tracks));
    return (library[name] = {
      upper: half('upper', clip.tracks.filter(isUpper)),
      lower: half('lower', clip.tracks.filter((t) => !isUpper(t))),
      duration: clip.duration,
      speed, // how fast (m/s) the animation's feet move on their own
    });
  }

  // What each half is playing right now.
  const playing = { upper: null, lower: null };
  function playOn(half, action, { once = false, timeScale = 1, fade = FADE, syncWith = null } = {}) {
    action.timeScale = timeScale;
    if (playing[half] === action && !once) return;
    action.reset();
    action.timeScale = timeScale;
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    action.clampWhenFinished = once;
    if (syncWith) action.time = syncWith.time; // keep arms in step with legs
    action.fadeIn(fade).play();
    if (playing[half] && playing[half] !== action) playing[half].fadeOut(fade);
    playing[half] = action;
  }

  let locomotion = { name: 'idle', speed: 0 };
  let upperPose = null;
  let upperMove = false;
  let fullBody = false;

  function applyLocomotion() {
    const anim = get(locomotion.name) ?? get('idle');
    if (!anim) return;
    // Speed the animation up or slow it down to match how fast the knight really moves,
    // so the feet don't slide over the ground.
    const timeScale = locomotion.speed > 0 && anim.speed > 0.1 ? locomotion.speed / anim.speed : 1;
    playOn('lower', anim.lower, { timeScale });
    if (upperMove) return; // the arms are busy with a one-off move
    const pose = upperPose && get(upperPose);
    if (pose) playOn('upper', pose.upper, { fade: 0.15 });
    else playOn('upper', anim.upper, { timeScale, syncWith: anim.lower });
  }
  applyLocomotion();

  return {
    has: (name) => !!get(name),

    // Make a new animation `name` from part of another one: `from`/`to` are fractions
    // of its length (0.36, 0.66 = the middle third).
    trim(name, source, from, to) {
      const clip = clips.find((c) => c.name === source);
      if (!clip || clips.some((c) => c.name === name)) return;
      const fps = 30;
      const frames = Math.round(clip.duration * fps);
      clips.push(THREE.AnimationUtils.subclip(clip, name, Math.round(from * frames), Math.round(to * frames), fps));
    },

    // idle / walk / run, and how fast the knight is moving (m/s).
    locomote(name, speed = 0) {
      locomotion = { name, speed };
      if (!fullBody) applyLocomotion();
    },

    // Hold an upper-body pose (like 'block_idle') on top of walking, or pass null to stop.
    setUpperPose(name) {
      if (upperPose === name) return;
      upperPose = name;
      if (!fullBody) applyLocomotion();
    },

    // Play a full-body move once. Returns how long it lasts and how fast it travels,
    // both adjusted for `timeScale`.
    perform(name, { timeScale = 1, fade = 0.1 } = {}) {
      const anim = get(name);
      if (!anim) return null;
      fullBody = true;
      upperMove = false;
      playOn('lower', anim.lower, { once: true, timeScale, fade });
      playOn('upper', anim.upper, { once: true, timeScale, fade });
      return { duration: anim.duration / timeScale, speed: anim.speed * timeScale };
    },

    // The full-body move is over: go back to walking/idling.
    release() {
      fullBody = false;
      upperMove = false;
      applyLocomotion(); // blends out of the move and back into walking/idling
    },

    // Play a move once on the upper body only (the legs keep walking). Returns how long it lasts.
    performUpper(name, { timeScale = 1, fade = 0.2 } = {}) {
      const anim = get(name);
      if (!anim || fullBody) return null;
      upperMove = true;
      playOn('upper', anim.upper, { once: true, timeScale, fade });
      return { duration: anim.duration / timeScale };
    },

    // The upper-body move is over: the arms go back to walking/idling (or blocking).
    releaseUpper() {
      if (!upperMove) return;
      upperMove = false;
      if (!fullBody) applyLocomotion();
    },

    update: (dt) => mixer.update(dt),
  };
}

// Some animations move the whole body forward on their own ("root motion").
// Our code already moves the character, so we pin the hips along any SIDEWAYS or FORWARD
// direction they travel steadily, keeping back-and-forth wobbles. Up and down is never
// pinned: that would hold the hips in the air when someone falls down dead.
// Returns how fast the animation was travelling (meters per second).
function keepInPlace(clip) {
  let distance = 0;
  for (const track of clip.tracks) {
    if (!/(hips|pelvis)\.position$/i.test(track.name)) continue;
    const v = track.values;
    const last = v.length - 3;
    let travelled = 0;
    for (const axis of [0, 2]) { // x and z: the ground directions (y is up)
      let min = Infinity;
      let max = -Infinity;
      for (let i = axis; i < v.length; i += 3) {
        min = Math.min(min, v[i]);
        max = Math.max(max, v[i]);
      }
      const travel = Math.abs(v[last + axis] - v[axis]);
      if (max - min > 1e-4 && travel > 0.5 * (max - min)) {
        travelled += travel * travel;
        for (let i = axis; i < v.length; i += 3) v[i] = v[axis];
      }
    }
    distance = Math.sqrt(travelled);
  }
  return clip.duration > 0 ? distance / clip.duration : 0;
}
