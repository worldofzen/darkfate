// On-screen bars and messages, styled after Elden Ring:
//   - your health (red) and stamina (green): thin bars with a gold frame in the top-left
//   - the boss's name and health along the bottom during the fight
//   - big "YOU DIED" / "ENEMY FELLED" messages
//   - the Flask of Crimson Tears slot in the bottom-left, with how many charges are left
// When a bar drops, a pale "ghost" piece shows how much was just lost, then shrinks away.

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
  .hud-health { width: 300px; }
  .hud-health .hud-fill, .hud-boss .hud-fill { background: linear-gradient(#c23a2e, #8e1e17 60%, #6e1410); }

  .hud-bossbar {
    position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%);
    width: min(70vw, 900px); pointer-events: none; opacity: 0; transition: opacity 0.8s;
  }
  .hud-bossbar.shown { opacity: 1; }
  .hud-bossname { color: #e6dcc4; font: 17px Georgia, 'Times New Roman', serif; margin-bottom: 6px;
    text-shadow: 0 1px 3px #000; letter-spacing: 0.02em; }
  .hud-boss { width: 100%; height: 10px; }

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
    position: fixed; left: 32px; bottom: 64px; width: 58px; height: 58px; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(rgba(20, 16, 12, 0.75), rgba(8, 6, 4, 0.6));
    border: 1px solid rgba(196, 174, 120, 0.55); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .hud-flask svg { width: 34px; height: 40px; filter: drop-shadow(0 0 5px rgba(220, 40, 30, 0.6)); }
  .hud-flask.none svg { filter: grayscale(1) brightness(0.5); }
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

export function createHud() {
  const container = document.createElement('div');
  container.className = 'hud';
  document.body.appendChild(container);
  const health = createBar(container, 'hud-health');
  const stamina = createBar(container, 'hud-stamina');

  const bossPanel = document.createElement('div');
  bossPanel.className = 'hud-bossbar';
  const bossName = document.createElement('div');
  bossName.className = 'hud-bossname';
  bossPanel.appendChild(bossName);
  document.body.appendChild(bossPanel);
  const boss = createBar(bossPanel, 'hud-boss');

  const flaskSlot = document.createElement('div');
  flaskSlot.className = 'hud-flask';
  flaskSlot.innerHTML = `
    <svg viewBox="0 0 34 40" aria-hidden="true">
      <rect x="13" y="1" width="8" height="5" rx="1" fill="#6b4a2c"/>
      <path d="M13 6h8v7c7 2 11 8 11 14 0 8-6 12-15 12S2 35 2 27c0-6 4-12 11-14z"
            fill="rgba(170,180,190,0.25)" stroke="rgba(220,225,230,0.7)" stroke-width="1.2"/>
      <path d="M4.5 25c3-1.5 7 1 12.5 0s9-2 12.5 0c0.5 6-5 11.5-12.5 11.5S4 31.5 4.5 25z" fill="#c4161c"/>
    </svg>
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
      bossPanel.classList.add('shown');
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
