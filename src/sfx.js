// Combat sounds, made in code (no sound files): sword swings, cuts landing, the shield taking
// a blow, a guard breaking, and the knight rolling. They play on the mixer's effects channel
// (see audio.js).
//
// Each sound is built from two simple ingredients:
//   noise    a hiss, shaped by filters into a whoosh (swing), a crunch (a cut) or a scuff (roll)
//   tones    pure notes; a low falling one is a thud, a handful of high ringing ones a metal clang

const SFX = {
  swing: 0.35,
  heavySwing: 0.5, // the boss's great sword
  cut: 0.8,
  hurt: 0.75,
  block: 0.45,
  guardBreak: 0.6,
  roll: 0.4,
};

export function createSfx(mixer) {
  const { ctx } = mixer;
  const out = mixer.effects;

  // Two seconds of hiss, reused by every sound.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  // A volume that jumps up over `attack` seconds and dies away over `decay`.
  function envelope(at, peak, attack, decay) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    gain.connect(out);
    return gain;
  }

  // A burst of hiss through a filter (`type`, sweeping from `from` Hz through `to` Hz).
  function hiss(at, { peak, attack, decay, type = 'bandpass', from, to, end = to, q = 1 }) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4; // never quite the same twice
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + attack);
    filter.frequency.exponentialRampToValueAtTime(end, at + attack + decay);
    source.connect(filter).connect(envelope(at, peak, attack, decay));
    source.start(at, Math.random());
    source.stop(at + attack + decay + 0.05);
  }

  // A pure note sliding from `from` Hz down to `to` Hz while it fades.
  function tone(at, { peak, attack = 0.005, decay, from, to = from, type = 'sine' }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
    osc.connect(envelope(at, peak, attack, decay));
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  // A metal ring: several notes that aren't in tune with each other, each fading at its own pace.
  function clang(at, peak, pitch) {
    for (const [ratio, share, decay] of [[1, 1, 0.7], [2.32, 0.6, 0.5], [3.17, 0.45, 0.4], [4.53, 0.3, 0.3], [6.1, 0.2, 0.2]]) {
      tone(at, { peak: peak * share * 0.35, decay, from: pitch * ratio * (0.99 + Math.random() * 0.02) });
    }
    hiss(at, { peak: peak * 0.5, attack: 0.002, decay: 0.08, type: 'highpass', from: 3000, to: 3000 });
  }

  const now = () => ctx.currentTime;

  return {
    // The knight's sword cutting the air (`heavy` for the finisher).
    swing(heavy = false) {
      hiss(now(), { peak: SFX.swing * (heavy ? 1.2 : 1), attack: 0.07, decay: 0.22, from: 500, to: heavy ? 1600 : 2200, end: 500, q: 1.4 });
    },
    // The boss's great sword: deeper and longer.
    heavySwing() {
      hiss(now(), { peak: SFX.heavySwing, attack: 0.12, decay: 0.35, from: 250, to: 900, end: 200, q: 1.1 });
    },
    // Your blade biting into the boss: a heavy thud with a crunch on top.
    cut(heavy = false) {
      const t = now();
      const k = heavy ? 1.15 : 1;
      tone(t, { peak: SFX.cut * k, decay: 0.22, from: 140, to: 45 });
      hiss(t, { peak: SFX.cut * 0.7 * k, attack: 0.004, decay: 0.16, type: 'lowpass', from: 4000, to: 3000, end: 600 });
      hiss(t + 0.01, { peak: SFX.cut * 0.25, attack: 0.01, decay: 0.12, from: 1800, to: 900, q: 3 });
    },
    // The boss's sword hitting you.
    hurt() {
      const t = now();
      tone(t, { peak: SFX.hurt, decay: 0.3, from: 110, to: 38 });
      hiss(t, { peak: SFX.hurt * 0.6, attack: 0.004, decay: 0.2, type: 'lowpass', from: 2500, to: 1500, end: 300 });
      clang(t, SFX.hurt * 0.25, 380); // armour rattling
    },
    // A blow caught on the shield.
    block() {
      const t = now();
      clang(t, SFX.block, 420 + Math.random() * 40);
      tone(t, { peak: SFX.block * 0.6, decay: 0.15, from: 160, to: 70 });
    },
    // Not enough stamina to hold the shield: a harsher clang and a lurch.
    guardBreak() {
      const t = now();
      clang(t, SFX.guardBreak, 300);
      tone(t, { peak: SFX.guardBreak * 0.8, decay: 0.35, from: 120, to: 40 });
      hiss(t, { peak: SFX.guardBreak * 0.5, attack: 0.005, decay: 0.25, type: 'lowpass', from: 3000, to: 1200, end: 300 });
    },
    // Rolling: armour hitting the ground, a scuff, and a second, softer bump.
    roll() {
      const t = now();
      hiss(t + 0.05, { peak: SFX.roll * 0.6, attack: 0.08, decay: 0.35, type: 'lowpass', from: 500, to: 900, end: 300 });
      tone(t + 0.12, { peak: SFX.roll, decay: 0.14, from: 120, to: 50 });
      clang(t + 0.12, SFX.roll * 0.18, 520);
      tone(t + 0.42, { peak: SFX.roll * 0.6, decay: 0.12, from: 100, to: 45 });
    },
  };
}
