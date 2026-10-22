// The title screen: the Darkfate logo over the game world, with a Start button.
// The world keeps rendering behind it (main.js slowly circles the camera around the knight).
const style = document.createElement('style');
style.textContent = `
  .title {
    position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
    align-items: center; justify-content: flex-start; padding-top: 9vh; box-sizing: border-box;
    background:
      radial-gradient(ellipse at 50% 45%, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.55) 55%, rgba(0, 0, 0, 0.92) 100%);
    transition: opacity 1.4s ease;
  }
  .title.leaving { opacity: 0; pointer-events: none; }
  .title-logo {
    width: min(72vw, 900px); height: auto; user-select: none; -webkit-user-drag: none;
    filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 30px rgba(150, 30, 20, 0.25));
    opacity: 0; transform: translateY(8px) scale(0.98);
    animation: title-appear 2.6s 0.3s ease forwards;
  }
  @keyframes title-appear { to { opacity: 1; transform: none; } }
  .title-start {
    position: relative; margin-top: auto; margin-bottom: 13vh; padding: 10px 56px;
    background: none; border: none; cursor: pointer;
    color: #d9cfb6; font: 22px Georgia, 'Times New Roman', serif; letter-spacing: 0.32em;
    text-transform: uppercase; text-shadow: 0 0 12px rgba(0, 0, 0, 0.9);
    opacity: 0; animation: title-appear 1.6s 2.2s ease forwards;
  }
  .title-start::before, .title-start::after {
    content: ''; position: absolute; top: 50%; width: 40px; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(217, 184, 102, 0.8));
  }
  .title-start::before { left: 0; }
  .title-start::after { right: 0; transform: scaleX(-1); }
  .title-start:hover, .title-start:focus-visible {
    color: #f3e6c0; outline: none;
    text-shadow: 0 0 14px rgba(217, 184, 102, 0.75), 0 0 2px rgba(0, 0, 0, 0.9);
  }
  .title-start:disabled { cursor: default; color: #8a8270; letter-spacing: 0.2em; }
  .title-hint { position: absolute; bottom: 4vh; color: #6f6857; font: 13px Georgia, serif; letter-spacing: 0.08em;
    opacity: 0; animation: title-appear 1.6s 2.8s ease forwards; }
  @media (max-width: 600px) { .title-start { font-size: 17px; padding: 8px 44px; } }
  /* The in-game bars and hints stay hidden until the game starts. */
  .hud, .hud-flask, #help { transition: opacity 1.2s 0.6s; }
  body.on-title .hud, body.on-title .hud-flask, body.on-title #help { opacity: 0; transition: none; }
`;
document.head.appendChild(style);

// `onStart` runs when the player clicks Start (or presses Enter) once the game has loaded.
export function createTitleScreen(onStart) {
  let screen = null;
  let button = null;
  let started = false;

  function build(loaded) {
    screen = document.createElement('div');
    screen.className = 'title';
    screen.innerHTML = `
      <img class="title-logo" src="ui/darkfate-logo.webp" alt="Darkfate">
      <button class="title-start" ${loaded ? '' : 'disabled'}>${loaded ? 'Start' : 'Loading'}</button>
      <div class="title-hint">Best played with mouse and keyboard<span class="title-sound"> · click anywhere for sound</span></div>`;
    document.body.appendChild(screen);
    button = screen.querySelector('.title-start');
    button.addEventListener('click', start);
    if (loaded) button.focus({ preventScroll: true });
  }

  function start() {
    if (started || button.disabled) return;
    started = true;
    const leaving = screen;
    leaving.classList.add('leaving');
    setTimeout(() => leaving.remove(), 1500);
    onStart();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') start(); // (not Space: that's dodge, and the knight would dodge right away)
  });
  build(false);

  return {
    // Bring the title screen back (after the end credits), ready to start again.
    show() {
      if (!started) return;
      started = false;
      build(true);
    },
    // Call once everything has loaded.
    ready() {
      button.disabled = false;
      button.textContent = 'Start';
      button.focus({ preventScroll: true });
    },
    get active() {
      return !started;
    },
  };
}
