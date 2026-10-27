// On-screen bars and messages, styled after Elden Ring:
//   - your health: an ornate crimson bar with a blood-red gem (ui/health_bar_*.webp), and
//     your stamina (green) under it, in the top-left
//   - the boss's name and its gothic crimson health bar (ui/boss_bar_*.webp) along the bottom;
//     in its second phase a new bar takes over, burning brighter and throbbing red
//   - big "YOU DIED" / "ENEMY FELLED" messages
//   - the Flask of Crimson Tears slot in the bottom-left (ui/flask.webp), with how many charges are left
// When a bar drops, a pale "ghost" piece shows how much was just lost, then shrinks away.
//
// The two health bars are pictures: an "empty" frame, with the "full" picture shown on top only
// up to the current health (tools/make_hud.mjs makes both from the original art).

const style = document.createElement('style');
style.textContent = `
  .hud { position: fixed; left: 32px; top: 28px; pointer-events: none; }
  .hud-bar {
    position: relative; width: 260px; height: 8px; margin-bottom: 6px;
    background: rgba(8, 8, 6, 0.6);
    border: 1px solid rgba(196, 174, 120, 0.55);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .hud-bar > div { position: absolute; left: 0; top: 0; bottom: 0; }
  .hud-ghost { background: rgba(232, 226, 170, 0.75); }
  .hud-fill { transition: filter 0.15s; }
  .hud-stamina .hud-fill { background: linear-gradient(#6cb35a, #3b7a33 60%, #2d6127); }

  /* Picture bars: three stacked copies of the art (empty frame, ghost, full). */
  .hud-art { position: relative; }
  .hud-art img { position: absolute; inset: 0; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; }
  .hud-art .hud-art-ghost { filter: brightness(1.9) saturate(0.35); opacity: 0.85; }
  .hud-art.empty-flash { animation: hud-art-flash 0.35s; }
  @keyframes hud-art-flash { 40% { filter: drop-shadow(0 0 6px #e0573a) brightness(1.3); } }
  .hud-health { width: 400px; aspect-ratio: 5.4795; margin-left: -10px; margin-bottom: -6px;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8)); }
  .hud-stamina { width: 300px; margin-left: 54px; } /* lined up under the red channel */

  .hud-bossbar {
    position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
    width: min(76vw, 1000px); pointer-events: none; opacity: 0; transition: opacity 0.8s;
  }
  .hud-bossbar.shown { opacity: 1; }
  .hud-bossname { color: #e6dcc4; font: 17px Georgia, 'Times New Roman', serif; margin: 0 0 -14px 10%;
    text-shadow: 0 1px 3px #000; letter-spacing: 0.02em; position: relative; z-index: 1; }
  .hud-boss { width: 100%; aspect-ratio: 6.4057; filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85)); }
  /* The second phase's bar: it flares in, then burns. */
  .hud-bossbar.phase2 .hud-bossname { color: #ffb39a; text-shadow: 0 0 8px rgba(255, 40, 20, 0.85), 0 1px 3px #000; }
  .hud-bossbar.phase2 .hud-art-fill { filter: saturate(1.6) brightness(1.45); }
  .hud-bossbar.phase2 .hud-boss { animation: hud-new-bar 1s ease-out, hud-burn 1.4s ease-in-out 1s infinite; }
  @keyframes hud-new-bar {
    0% { filter: brightness(3) drop-shadow(0 0 22px #ff3a1a); transform: scaleX(0.94); }
    100% { filter: drop-shadow(0 0 4px rgba(255, 40, 20, 0.6)) drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85)); }
  }
  @keyframes hud-burn {
    0%, 100% { filter: drop-shadow(0 0 4px rgba(255, 40, 20, 0.6)) drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85)); }
    50% { filter: drop-shadow(0 0 10px rgba(255, 50, 20, 0.95)) drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85)); }
  }

  .hud-banner {
    position: fixed; left: 0; right: 0; top: 42%; text-align: center; pointer-events: none;
    font: 72px Georgia, 'Times New Roman', serif; letter-spacing: 0.08em; opacity: 0; z-index: 1;
    transition: opacity 1.2s;
  }
  .hud-banner::before {
    content: ''; position: absolute; left: 0; right: 0; top: -30px; bottom: -30px; z-index: -1;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75) 30%, rgba(0, 0, 0, 0.75) 70%, transparent);
  }
  .hud-banner.shown { opacity: 1; }
  .hud-banner.died { color: #a3201a; }
  .hud-banner.felled { color: #d9b866; }
  @media (max-width: 600px) { .hud-banner { font-size: 40px; } }
  .hud-flask {
    position: fixed; left: 32px; bottom: 64px; width: 64px; height: 64px; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(rgba(20, 16, 12, 0.75), rgba(8, 6, 4, 0.6));
    border: 1px solid rgba(196, 174, 120, 0.55); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .hud-flask img { height: 52px; filter: drop-shadow(0 0 6px rgba(220, 40, 30, 0.55)); }
  .hud-flask.none img { filter: grayscale(1) brightness(0.45); }
  .hud-flask-count {
    position: absolute; right: 4px; bottom: 1px; color: #efe6cf;
    font: 15px Georgia, 'Times New Roman', serif; text-shadow: 0 1px 2px #000;
  }
  .hud-flask.empty-flash { animation: hud-flash 0.35s; }
  .hud-resume {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none;
    color: #e6dcc4; font: 18px Georgia, 'Times New Roman', serif; letter-spacing: 0.25em; text-transform: uppercase;
    text-shadow: 0 0 10px #000, 0 0 3px #000; opacity: 0; transition: opacity 0.3s;
  }
  .hud-resume.shown { opacity: 1; }
  /* A red pulse round the screen edges when you take a hit. */
  .hud-damage {
    position: fixed; inset: 0; pointer-events: none; opacity: 0;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(140, 0, 0, 0.55) 100%);
  }
  .hud-damage.hit { animation: hud-damage 0.45s ease-out; }
  @keyframes hud-damage { 0% { opacity: 1; } 100% { opacity: 0; } }
  .hud-bar.empty-flash { animation: hud-flash 0.35s; }
  @keyframes hud-flash {
    0%, 100% { border-color: rgba(196, 174, 120, 0.55); }
    40% { border-color: #e0573a; box-shadow: 0 0 6px #e0573a; }
  }
`;
document.head.appendChild(style);

// Where the red channel is in each bar picture (% from each edge), as measured by
// tools/make_hud.mjs (see public/ui/hud_bars.json).
const BAR_ART = {
  health: { file: 'health_bar', left: 15.917, right: 6.583, top: 36.073, bottom: 36.073 },
  boss: { file: 'boss_bar', left: 8.833, right: 9.056, top: 43.772, bottom: 35.943 },
};

const GHOST_HOLD = 0.6; // seconds the ghost piece waits before shrinking
const GHOST_SPEED = 0.6; // how fast it shrinks (fraction of the bar per second)

function createBar(container, className) {
  const bar = document.createElement('div');
  bar.className = `hud-bar ${className}`;
  const ghost = document.createElement('div');
  ghost.className = 'hud-ghost';
  const fill = document.createElement('div');
  fill.className = 'hud-fill';
  bar.append(ghost, fill);
  container.appendChild(bar);

  let ghostValue = 1;
  let hold = 0;
  let last = 1;
  return {
    element: bar,
    update(fraction, dt) {
      if (fraction < last) hold = GHOST_HOLD; // just dropped: keep the ghost a moment
      last = fraction;
      if (hold > 0) hold -= dt;
      else ghostValue = Math.max(fraction, ghostValue - GHOST_SPEED * dt);
      if (fraction > ghostValue) ghostValue = fraction;
      fill.style.width = `${fraction * 100}%`;
      ghost.style.width = `${ghostValue * 100}%`;
    },
    flash() {
      bar.classList.remove('empty-flash');
      void bar.offsetWidth; // restart the animation
      bar.classList.add('empty-flash');
    },
  };
}

// A bar drawn from a picture: the "full" art is shown only up to `fraction` of the red channel.
function createArtBar(container, className, art) {
  const bar = document.createElement('div');
  bar.className = `hud-art ${className}`;
  bar.innerHTML = `
    <img src="ui/${art.file}_empty.webp" alt="">
    <img class="hud-art-ghost" src="ui/${art.file}_full.webp" alt="">
    <img class="hud-art-fill" src="ui/${art.file}_full.webp" alt="">`;
  container.appendChild(bar);
  const ghost = bar.querySelector('.hud-art-ghost');
  const fill = bar.querySelector('.hud-art-fill');
  const span = 100 - art.left - art.right;
  // Show the full picture only inside the channel, from its left end to `fraction` of the way.
  const clip = (fraction) => `inset(${art.top}% ${100 - art.left - span * fraction}% ${art.bottom}% ${art.left}%)`;

  let ghostValue = 1;
  let hold = 0;
  let last = 1;
  return {
    element: bar,
    update(fraction, dt) {
      if (fraction < last) hold = GHOST_HOLD;
      last = fraction;
      if (hold > 0) hold -= dt;
      else ghostValue = Math.max(fraction, ghostValue - GHOST_SPEED * dt);
      if (fraction > ghostValue) ghostValue = fraction;
      fill.style.clipPath = clip(fraction);
      ghost.style.clipPath = clip(ghostValue);
    },
    flash() {
      bar.classList.remove('empty-flash');
      void bar.offsetWidth; // restart the animation
      bar.classList.add('empty-flash');
    },
  };
}

export function createHud() {
  const container = document.createElement('div');
  container.className = 'hud';
  document.body.appendChild(container);
  const health = createArtBar(container, 'hud-health', BAR_ART.health);
  const stamina = createBar(container, 'hud-stamina');

  const bossPanel = document.createElement('div');
  bossPanel.className = 'hud-bossbar';
  const bossName = document.createElement('div');
  bossName.className = 'hud-bossname';
  bossPanel.appendChild(bossName);
  document.body.appendChild(bossPanel);
  const boss = createArtBar(bossPanel, 'hud-boss', BAR_ART.boss);

  const flaskSlot = document.createElement('div');
  flaskSlot.className = 'hud-flask';
  flaskSlot.innerHTML = `
    <img src="ui/flask.webp" alt="Flask of Crimson Tears">
    <span class="hud-flask-count"></span>`;
  document.body.appendChild(flaskSlot);
  const flaskCount = flaskSlot.querySelector('.hud-flask-count');

  const resume = document.createElement('div');
  resume.className = 'hud-resume';
  resume.textContent = 'Click to continue';
  document.body.appendChild(resume);
  const damage = document.createElement('div');
  damage.className = 'hud-damage';
  document.body.appendChild(damage);

  const banner = document.createElement('div');
  banner.className = 'hud-banner';
  document.body.appendChild(banner);
  let bannerTimer = null;

  return {
    health,
    stamina,
    boss,
    // Shown while the mouse is let go (after Esc).
    setMouseFree(free) {
      resume.classList.toggle('shown', free);
    },
    // Red flash round the screen edges when you're hit.
    flashDamage() {
      damage.classList.remove('hit');
      void damage.offsetWidth; // restart the animation
      damage.classList.add('hit');
    },
    setFlasks(count) {
      flaskCount.textContent = count;
      flaskSlot.classList.toggle('none', count === 0);
    },
    flashFlask() {
      flaskSlot.classList.remove('empty-flash');
      void flaskSlot.offsetWidth; // restart the animation
      flaskSlot.classList.add('empty-flash');
    },
    showBoss(name) {
      bossName.textContent = name;
      bossPanel.classList.remove('phase2');
      bossPanel.classList.add('shown');
    },
    // The boss's second phase: its new name over the new, burning bar.
    showBossPhase2(name) {
      bossName.textContent = name;
      bossPanel.classList.add('phase2');
    },
    hideBoss() {
      bossPanel.classList.remove('shown');
    },
    // kind: 'died' (red) or 'felled' (gold). Fades out by itself after `seconds`.
    showBanner(text, kind, seconds = 3) {
      banner.textContent = text;
      banner.className = `hud-banner ${kind} shown`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('shown'), seconds * 1000);
    },
  };
}
