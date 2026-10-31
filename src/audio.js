// All the game's sound goes through one mixer with three volume "channels":
//   music     the music tracks (see TRACKS)
//   ambience  wind and other background sounds
//   effects   thunder (see level/weather.js), and the combat sounds (see sfx.js)
// Change the numbers in MIX to rebalance everything in one place.
//
// Music tracks are streamed (like a music player) rather than loaded whole, so big WAV
// files start quickly. Only the first track downloads while the game loads; the rest wait
// for `preloadAll`, so they don't slow the loading down. Switching tracks always crossfades: the old one fades out while
// the new one fades in.
//
// Browsers block sound until the player clicks or presses a key on the page, so the
// music starts at the first click or key press (see `unlock`).

export const MIX = {
  master: 0.9,
  music: 0.6,
  ambience: 0.7,
  effects: 0.85,
  ambienceDuringBattle: 0.4, // wind gets quieter under the battle music, so the music sits on top
  // During the end-credits video: the video's own sound at full, the calm theme underneath it,
  // and the storm (wind, thunder) silenced.
  creditsVideo: 1,
  creditsMusic: 0.35,
};

// The music files in public/audio/, and how loud each sits in the mix. `startAt` (seconds):
// where the track begins each time it comes in; when it loops, it goes back to the very start.
export const TRACKS = {
  sanctuary: { file: 'Sanctuary of Fading Embers.mp3', volume: 0.85 }, // title screen and resting area
  battle: { file: "The King's Last Vigil.mp3", volume: 1 }, // the boss fight
  battle2: { file: "The King's Last Vigil_phase2.mp3", volume: 1, startAt: 29 }, // the boss's second phase
};
const BATTLE_TRACKS = ['battle', 'battle2']; // the wind drops under these

export function createMixer() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = MIX.master;
  // A limiter at the very end: when a thunderclap, a big hit and a loud bar of music land
  // together, it holds them down instead of letting them crackle. Quieter moments pass untouched.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);
  const channel = (volume) => {
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(master);
    return g;
  };
  const music = channel(MIX.music);
  const ambience = channel(MIX.ambience);
  const effects = channel(MIX.effects);
  const video = channel(MIX.creditsVideo);

  // Smoothly move a volume to `value` over `seconds`.
  const fade = (param, value, seconds) => {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
  };

  // Each track: a streaming <audio> element, routed through its own volume control.
  const tracks = {};
  const first = Object.keys(TRACKS)[0];
  for (const [name, { file, volume, startAt = 0 }] of Object.entries(TRACKS)) {
    const element = new Audio();
    element.preload = name === first ? 'auto' : 'none';
    element.src = `audio/${encodeURIComponent(file)}`;
    element.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(element).connect(gain).connect(music);
    tracks[name] = { element, gain, volume, startAt, stopTimer: null };
  }

  let current = null; // the track that should be playing (or null for silence)
  let unlocked = false;

  function start(track) {
    clearTimeout(track.stopTimer);
    if (track.element.paused) {
      // Each time a track comes back, it starts from the top (or its `startAt`). Before the
      // file's length is known, jumping into it has to wait until it is.
      const { element, startAt } = track;
      if (element.readyState >= 1) element.currentTime = startAt;
      else element.addEventListener('loadedmetadata', () => (element.currentTime = startAt), { once: true });
      element.play().catch(() => {}); // blocked until the first click; `unlock` retries
    }
  }

  return {
    ctx,
    music,
    ambience,
    effects,

    // Crossfade to the track called `name` ('sanctuary', 'battle', 'battle2', or null for silence).
    playTrack(name, seconds = 3) {
      current = name;
      for (const [trackName, track] of Object.entries(tracks)) {
        if (trackName === name) {
          start(track);
          fade(track.gain.gain, track.volume, seconds);
        } else if (!track.element.paused) {
          fade(track.gain.gain, 0, seconds);
          clearTimeout(track.stopTimer);
          track.stopTimer = setTimeout(() => track.element.pause(), seconds * 1000 + 100);
        }
      }
      fade(ambience.gain, BATTLE_TRACKS.includes(name) ? MIX.ambienceDuringBattle : MIX.ambience, seconds);
    },

    // Start downloading the tracks that were held back while the game loaded.
    preloadAll() {
      for (const { element } of Object.values(tracks)) {
        if (element.preload === 'auto') continue;
        element.preload = 'auto';
        element.load();
      }
    },

    // Send a <video>'s sound through the mixer (so it can be balanced with the music).
    addVideo(element) {
      ctx.createMediaElementSource(element).connect(video);
    },
    // End credits on/off: the music drops under the video and the storm goes quiet (or all comes back).
    creditsMode(on, seconds = 2) {
      fade(music.gain, on ? MIX.creditsMusic : MIX.music, seconds);
      fade(ambience.gain, on ? 0 : MIX.ambience, seconds);
      fade(effects.gain, on ? 0 : MIX.effects, seconds);
    },

    // Call on the first click or key press: browsers only allow sound after one.
    unlock() {
      if (unlocked) return;
      unlocked = true;
      ctx.resume();
      if (current) tracks[current].element.play().catch(() => {});
    },

    // True once sound is actually coming out (the browser allowed it).
    get unlocked() {
      return ctx.state === 'running' && Object.values(tracks).some((t) => !t.element.paused);
    },
    // What each track is doing right now (handy for checking crossfades).
    get status() {
      return Object.fromEntries(Object.entries(tracks).map(([name, t]) => [
        name,
        { playing: !t.element.paused, volume: +t.gain.gain.value.toFixed(2), seconds: +t.element.currentTime.toFixed(1), length: +(t.element.duration || 0).toFixed(1) },
      ]));
    },
    get playing() {
      return current;
    },
  };
}
