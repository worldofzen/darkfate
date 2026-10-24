// Entry point: sets up the 3D view, builds the level, places the Knight and the Boss,
// and shows the title screen until you press Start.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildLevel } from './level/level.js';
import { makeGlowTexture } from './level/textures.js';
import { SPAWN, ARENA } from './level/layout.js';
import { createPlayer } from './player.js';
import { FIRE_SHADOW_LAYER } from './level/siteOfGrace.js';
import { createAnimator } from './animator.js';
import { equipWeapon, equipShield, holdInLeftHand, WEAPONS } from './equipment.js';
import { createStamina } from './stamina.js';
import { createHud } from './hud.js';
import { createBlade } from './hitbox.js';
import { createBoss, BOSS } from './boss.js';
import { createFight } from './fight.js';
import { createLockOn } from './lockOn.js';
import { createFlask } from './flask.js';
import { createGraphics, MOBILE } from './graphics.js';
import { createDust } from './level/atmosphere.js';
import { createStorm } from './level/weather.js';
import { createMist } from './level/mist.js';
import { groundHeight } from './level/colliders.js';
import { createEndCredits } from './endCredits.js';
import { createTitleScreen } from './titleScreen.js';
import { createMixer } from './audio.js';
import { createEffects } from './effects.js';
import { LAYERS, SHADOW_STAND_INS, useShadowCameraLayers } from './layers.js';

// --- Renderer: draws the 3D world onto the page ---
// (Anti-aliasing is done by the effects in graphics.js, so it's off here.)
// The game needs the browser's 3D graphics (WebGL 2); some browsers have it switched off.
if (!document.createElement('canvas').getContext('webgl2')) {
  window.showProblem(
    "Darkfate needs 3D graphics (WebGL 2), and this browser has them switched off or doesn't support them.<br><br>" +
      'Try Chrome or Edge, and make sure <b>"Use graphics acceleration when available"</b> is on ' +
      '(Settings → System), then restart the browser.'
  );
  throw new Error('WebGL 2 is not available');
}
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2)); // phones: fewer pixels to fill
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
useShadowCameraLayers(renderer); // each shadow draws only its own layers (see layers.js)
document.body.appendChild(renderer.domElement);

// --- Scene: the "world" everything lives in ---
// A cold, misty night: distant things fade into dark blue-grey fog.
const SKY = 0x151d2b; // the night haze (also the fog colour, so distant things melt into the sky)
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.FogExp2(SKY, 0.021);

// --- Camera: the player script moves it to follow the knight ---
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
camera.layers.enable(LAYERS.detail); // the full-quality models (see layers.js)
camera.position.set(SPAWN.x, 2.4, SPAWN.z + 4.5);
camera.lookAt(SPAWN.x, 1.5, SPAWN.z);

// --- Lights ---
scene.add(new THREE.HemisphereLight(0x5f74a6, 0x15120e, 0.5)); // cold moonlit sky above, dark earth below

// Main light. It casts shadows in a 60 x 60 m area that moves along with the knight.
const MOON_OFFSET = new THREE.Vector3(25, 50, 10);
const moon = new THREE.DirectionalLight(0x9fb6e8, 3.4); // strong, so stone edges catch cold highlights
moon.position.copy(MOON_OFFSET);
moon.castShadow = true;
moon.shadow.mapSize.setScalar(MOBILE ? 1024 : 2048);
moon.shadow.camera.left = -30;
moon.shadow.camera.right = 30;
moon.shadow.camera.top = 30;
moon.shadow.camera.bottom = -30;
moon.shadow.camera.far = 150;
moon.shadow.camera.layers.enable(LAYERS.shadow); // the models' simplified shadow copies (see layers.js)
// Phones store shadow depths less precisely: a bigger bias stops surfaces speckling with "shadow acne".
moon.shadow.bias = MOBILE ? -0.002 : -0.0005;
moon.shadow.normalBias = MOBILE ? 0.06 : 0.02;
scene.add(moon, moon.target);

// The storm sky (clouds, lightning, thunder), dust drifting through the air, and mist.
const storm = createStorm(scene, { horizonColor: SKY, moonDirection: new THREE.Vector3(60, 90, -200) });
const dust = createDust(makeGlowTexture(), { minX: -20, maxX: 20, minZ: ARENA.z - 25, maxZ: 10 });
scene.add(dust);
const mistGroups = [];
for (let k = 1; k < 18; k++) {
  // Filling the chasm around the arena platform (well below the bridge, which is at k = 0).
  const a = (k / 18) * Math.PI * 2;
  const r = (ARENA.platform + ARENA.chasm) / 2;
  mistGroups.push({ count: 3, center: new THREE.Vector3(Math.sin(a) * r, -8, ARENA.z + Math.cos(a) * r), spread: [9, 5, 9], size: [12, 20], opacity: 0.5 });
}
mistGroups.push({ count: 10, center: new THREE.Vector3(0, 1.2, ARENA.z), spread: [36, 1, 36], size: [8, 14], opacity: 0.12 }); // low over the arena
mistGroups.push({ count: 6, center: new THREE.Vector3(0, 1.5, -14), spread: [8, 1, 18], size: [6, 10], opacity: 0.1 }); // in the corridor
const mist = createMist(mistGroups);
scene.add(mist);



const graphics = createGraphics(renderer, scene, camera);
const effects = createEffects(scene, camera);

// --- Title screen: the camera slowly circles the knight until you press Start ---
// --- Sound: music, wind and thunder (see audio.js) ---
// The calm theme plays from the title screen through the resting area. Browsers hold back
// all sound until the first click or key press, so it starts then.
const mixer = createMixer();
storm.enableSound(mixer);
mixer.playTrack('sanctuary', 4);
const unlockSound = () => mixer.unlock();
window.addEventListener('pointerdown', unlockSound, { once: true });
window.addEventListener('keydown', unlockSound, { once: true });

// On Start the camera glides round behind the knight, standing in his sword-and-shield idle.
const title = createTitleScreen(() => {
  player.setActive(true);
  document.body.classList.remove('on-title');
  handOff = { time: 0, position: camera.position.clone(), quaternion: camera.quaternion.clone() };
});
document.body.classList.add('on-title');
// The end credits (after the boss is slain). "Continue" starts the game over from the title screen.
const credits = createEndCredits(mixer, () => {
  fight.restart();
  title.show();
  document.body.classList.add('on-title');
});
let handOff = null; // smooth camera move from the title view to behind the knight
const HAND_OFF_SECONDS = 1.8;

// --- Loading 3D models ---
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// Loads a model and returns it, with its animations (if any) in `model.animations`.
// If it has a simplified shadow copy (see layers.js), that comes along inside it: the full
// model is only drawn on screen, the copy only into the shadows. Copies (clone) carry both.
function loadModel(url) {
  const name = url.match(/([^/]+)\.glb$/)[1];
  const standIn = SHADOW_STAND_INS.includes(name) ? loader.loadAsync(url.replace(/\.glb$/, '_shadow.glb')) : null;
  return Promise.all([loader.loadAsync(url), standIn]).then(([gltf, shadow]) => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = !obj.isSkinnedMesh; // animated meshes can move outside their box
        if (shadow) obj.layers.set(LAYERS.detail);
      }
    });
    if (shadow) {
      shadow.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.layers.set(LAYERS.shadow);
        obj.castShadow = true;
      });
      gltf.scene.add(shadow.scene);
    }
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  });
}

// --- Stamina and the on-screen bar ---
const stamina = createStamina();
const hud = createHud();
stamina.onEmpty(() => hud.stamina.flash()); // bar flashes when you try something with no stamina

// --- The level: spawn courtyard, corridor, fog gate, boss arena ---
const level = buildLevel(scene, loadModel);

// The tower: the landmark behind the boss, so it must read through the gloom. The night fog
// would swallow it at this distance, so it gets a much thinner fog of its own, a faint cold
// glow of its own so its carvings show, and a moonlit spotlight washing up its face. Plus a few warm lit windows high up, and thick mist rolling
// round its base.
const TOWER_FOG = 0.3; // its fog, as a share of the scene's
let towerMist = null;
level.towerReady.then((tower) => {
  const box = new THREE.Box3().setFromObject(tower);
  const size = box.getSize(new THREE.Vector3());
  tower.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.emissive = new THREE.Color(0.1, 0.11, 0.15);
    o.material.emissiveMap = o.material.map;
    o.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
           float towerFog = 1.0 - exp(-fogDensity * fogDensity * ${(TOWER_FOG * TOWER_FOG).toFixed(3)} * vFogDepth * vFogDepth);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, towerFog);
         #endif`
      );
    };
  });
  const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  const moonlight = new THREE.SpotLight(0x9fb4e6, 900, 160, THREE.MathUtils.degToRad(16), 0.6, 1.2);
  moonlight.position.set(top.x + 25, box.min.y + 6, box.max.z + 55); // low and in front: lights it from below
  moonlight.target.position.set(top.x, box.min.y + size.y * 0.6, top.z);
  scene.add(moonlight, moonlight.target);
  const windowGlow = new THREE.SpriteMaterial({ map: makeGlowTexture(), color: new THREE.Color(2.4, 0.95, 0.3), depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 7; i++) {
    const glint = new THREE.Sprite(windowGlow);
    glint.position.set(
      box.min.x + size.x * (0.35 + Math.random() * 0.3),
      box.min.y + size.y * (0.3 + Math.random() * 0.45),
      box.max.z - size.z * 0.25
    );
    glint.scale.setScalar(0.45 + Math.random() * 0.35);
    scene.add(glint);
  }
  const base = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + 6, (box.min.z + box.max.z) / 2);
  towerMist = createMist([
    { count: 14, center: base, spread: [size.x * 1.4, 10, size.z * 1.2], size: [30, 55], opacity: 0.45 },
    { count: 6, center: base.clone().setY(box.min.y + size.y * 0.45), spread: [size.x * 1.6, 20, size.z], size: [35, 60], opacity: 0.18 },
  ]);
  scene.add(towerMist);
});

// --- The Knight (at the spawn point, facing the gate) and the Boss (waiting in the arena) ---
// Weapons and the shield load alongside; if one is missing, the character goes without it.
let knight = null;
let player = null;
let fight = null;
let bossFigure = null; // the boss model (for the game loop)
const optional = (url) => loadModel(url).catch(() => null);

// Stand a model on the floor at (x, z), facing `angle`.
function place(model, x, z, angle) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.set(x, -box.min.y, z);
  model.userData.standY = -box.min.y; // its height when standing on flat ground (see followGround)
  model.rotation.y = angle;
  scene.add(model);
}

Promise.all([
  loadModel('models/Knight.glb'),
  optional('models/Knight_sword.glb'),
  optional('models/Knight_shield.glb'),
  loadModel('models/BOSS.glb'),
  optional('models/BOSS_sword.glb'),
])
  .then(([knightModel, sword, shield, bossModel, bossSword]) => {
    knight = knightModel;
    place(knight, SPAWN.x, SPAWN.z, SPAWN.facing);
    // Equip before animations start (it measures the hands in their resting pose).
    if (sword) equipWeapon(knight, sword, WEAPONS.knightSword);
    if (shield) equipShield(knight, shield);
    knight.traverse((o) => o.isMesh && o.layers.enable(FIRE_SHADOW_LAYER)); // the bonfire throws his shadow
    const flask = createFlask();
    holdInLeftHand(knight, flask);
    const lockOn = createLockOn(scene, knight);
    player = createPlayer(knight, createAnimator(knight, knight.animations), camera, renderer.domElement, stamina, lockOn, flask);
    player.onEmptyFlask(() => hud.flashFlask());
    player.setActive(false); // no control until Start is pressed
    hud.setFlasks(player.flasks);

    // The boss stands toward the back of the arena, facing the fog gate.
    bossModel.scale.setScalar(BOSS.scale);
    place(bossModel, 0, ARENA.z - 6, 0);
    bossFigure = bossModel;
    if (bossSword) equipWeapon(bossModel, bossSword, WEAPONS.bossSword);
    const bossAnimator = createAnimator(bossModel, bossModel.animations, { scale: BOSS.scale });
    const bossBlade = createBlade(bossSword ?? bossModel, WEAPONS.bossSword);
    const home = { position: bossModel.position.clone(), angle: bossModel.rotation.y };
    const boss = createBoss(bossModel, bossAnimator, bossBlade, home);
    lockOn.addTarget(bossModel.getObjectByName('spine_03'), () => boss.state !== 'dead');

    fight = createFight({
      knight,
      player,
      playerBlade: createBlade(sword ?? knight, WEAPONS.knightSword),
      bossModel,
      boss,
      level,
      hud,
      stamina,
      effects,
      // The boss has crumbled away: a moment of quiet, then the end credits.
      onBossGone: () => setTimeout(() => {
        player.setActive(false); // no control while the credits roll
        credits.play();
      }, 1800),
    });
    title.ready();
    window.gameReady = true; // (index.html stops reporting start-up problems)
  })
  .catch((err) => {
    console.error(err);
    document.querySelector('.title-start').textContent = 'Could not load the game';
  });

// --- Keep the picture correct when the window is resized ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  graphics.setSize(window.innerWidth, window.innerHeight);
});

// --- Game loop: runs ~60 times per second ---
// One step of the game: move everything forward by `dt` seconds.
let time = 0;
function step(realDt) {
  effects.update(realDt);
  const dt = effects.gameTime(realDt); // nearly frozen during a hit-stop
  time += dt;
  level.update(time, camera);
  dust.userData.update(time);
  mist.userData.update(time, camera);
  towerMist?.userData.update(time, camera);
  storm.update(time);
  // The "click for sound" hint goes away once the browser lets sound play.
  if (mixer.unlocked) document.querySelector('.title-sound')?.remove();
  if (!player) return;
  player.update(dt);
  fight.update(dt);
  followGround(knight, dt);
  followGround(bossFigure, dt);
  updateMusic();
  hud.stamina.update(stamina.fraction, dt);
  hud.setFlasks(player.flasks);
  hud.setMouseFree(player.mouseFree);
  moon.target.position.copy(knight.position);
  moon.position.copy(knight.position).add(MOON_OFFSET);

  if (title.active) {
    // Title screen: a low view from the side, the knight standing on the left, the bonfire on
    // the right, and the ruins and the tower beyond; the camera drifts very slowly.
    const drift = Math.sin(time * 0.05);
    camera.position.set(knight.position.x + 1.0 + drift * 0.3, 1.78 + drift * 0.05, knight.position.z + 6.6 - drift * 0.2);
    camera.lookAt(knight.position.x + 1.0, 1.78, knight.position.z - 4); // level: the knight stands in the gap between the logo and Start
  } else if (handOff) {
    // Just after Start: glide from the title view to the normal camera behind the knight.
    handOff.time += dt;
    const t = THREE.MathUtils.smoothstep(handOff.time / HAND_OFF_SECONDS, 0, 1);
    camera.position.lerpVectors(handOff.position, camera.position, t);
    camera.quaternion.slerpQuaternions(handOff.quaternion, camera.quaternion.clone(), t); // (a copy: the target is the camera itself)
    if (t >= 1) handOff = null;
  }
}

// The arena floor isn't flat: characters rise and sink with it (smoothly, so small bumps
// don't make them jitter).
function followGround(model, dt) {
  const target = model.userData.standY + groundHeight(model.position.x, model.position.z);
  model.position.y += (target - model.position.y) * Math.min(1, dt * 12);
}

// Music follows the fight, always crossfading smoothly:
//   step through the fog      calm theme -> battle theme
//   you die                   battle theme fades out under "YOU DIED"
//   you respawn at the grace  calm theme fades back in
//   the boss falls            battle theme fades away; the calm theme returns with the end credits
let lastFightState = 'waiting';
function updateMusic() {
  const state = fight.state;
  if (state === lastFightState) return;
  if (state === 'fighting') mixer.playTrack('battle', 3);
  if (state === 'lost') mixer.playTrack(null, 2.5);
  if (state === 'waiting') mixer.playTrack('sanctuary', 4);
  if (state === 'won') mixer.playTrack(null, 5); // the end credits (endCredits.js) bring the calm theme back
  lastFightState = state;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  step(Math.min(clock.getDelta(), 0.1)); // capped, so a lag spike can't fling you through a wall
  graphics.render(time);
});
