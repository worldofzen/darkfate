// The end credits: once the boss has crumbled away, the screen fades to black and the
// credits video plays (with its own sound), over the calm theme "Sanctuary of Fading Embers".
// When it ends (or you skip it with Enter), "Click to continue" takes you back into the world.
const style = document.createElement('style');
style.textContent = `
  .credits {
    position: fixed; inset: 0; z-index: 20; background: #000; display: flex;
    align-items: center; justify-content: center; opacity: 0; pointer-events: none;
    transition: opacity 2.2s ease;
  }
  .credits.showing { opacity: 1; pointer-events: auto; }
  .credits video {
    width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 1.6s ease, filter 2.5s ease;
  }
  .credits video.playing { opacity: 1; }
  .credits video.dim { filter: brightness(0.3) blur(2px); }
  .credits-skip {
    position: absolute; right: 28px; bottom: 22px; color: #6f6857;
    font: 13px Georgia, 'Times New Roman', serif; letter-spacing: 0.08em; opacity: 0; transition: opacity 1s;
  }
  .credits video.playing:not(.dim) ~ .credits-skip { opacity: 0.8; }
  .credits-end {
    position: absolute; display: flex; flex-direction: column; align-items: center; gap: 28px;
    opacity: 0; transition: opacity 1.6s ease; pointer-events: none;
  }
  .credits-end.showing { opacity: 1; pointer-events: auto; }
  .credits-end img { width: min(60vw, 640px); height: auto; filter: drop-shadow(0 0 30px rgba(150, 30, 20, 0.25)); }
  .credits-thanks { color: #d9cfb6; font: 20px Georgia, 'Times New Roman', serif; letter-spacing: 0.3em; text-transform: uppercase; }
  .credits-continue {
    background: none; border: none; cursor: pointer; color: #8a8270;
    font: 15px Georgia, 'Times New Roman', serif; letter-spacing: 0.2em; text-transform: uppercase;
  }
  .credits-continue:hover, .credits-continue:focus-visible { color: #f3e6c0; outline: none; }
  /* The health bars and hints hide while the credits roll. */
  body.on-credits .hud, body.on-credits .hud-flask, body.on-credits #help { opacity: 0; }
`;
document.head.appendChild(style);

// `onClose` runs on the "Click to continue" click (a real click, so the mouse can be captured again).
export function createEndCredits(mixer, onClose) {
  const screen = document.createElement('div');
  screen.className = 'credits';
  screen.innerHTML = `
    <video src="video/end_credits.mp4" preload="none" playsinline></video>
    <div class="credits-skip">Enter: skip</div>
    <div class="credits-end">
      <img src="ui/darkfate-logo.webp" alt="Darkfate">
      <div class="credits-thanks">Thank you for playing</div>
      <button class="credits-continue">Click to continue</button>
    </div>`;
  document.body.appendChild(screen);
  const video = screen.querySelector('video');
  const end = screen.querySelector('.credits-end');
  mixer.addVideo(video); // the video's sound goes through the mixer, balanced with the music

  let state = 'off'; // 'off', 'video', 'end'

  function finishVideo() {
    if (state !== 'video') return;
    state = 'end';
    video.pause();
    video.classList.add('dim'); // its last frame stays, darkened, behind the logo
    end.classList.add('showing');
    end.querySelector('button').focus({ preventScroll: true });
  }
  video.addEventListener('ended', finishVideo);
  video.addEventListener('error', finishVideo); // missing video: go straight to the end card

  end.querySelector('button').addEventListener('click', () => {
    if (state !== 'end') return;
    state = 'off';
    screen.classList.remove('showing');
    end.classList.remove('showing');
    setTimeout(() => video.classList.remove('playing', 'dim'), 2200);
    document.body.classList.remove('on-credits');
    mixer.creditsMode(false, 3);
    onClose();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && state === 'video') finishVideo();
  });

  return {
    // Start downloading the video (held back while the game loads).
    preload() {
      video.preload = 'auto';
      video.load();
    },
    play() {
      if (state !== 'off') return;
      state = 'video';
      document.exitPointerLock?.();
      document.body.classList.add('on-credits');
      screen.classList.add('showing');
      // The calm theme starts from the top as the screen goes dark, under the video's own sound.
      mixer.playTrack('sanctuary', 3);
      mixer.creditsMode(true, 2);
      setTimeout(() => {
        video.currentTime = 0;
        video.classList.add('playing');
        video.play().catch(finishVideo);
      }, 2400);
    },
    get active() {
      return state !== 'off';
    },
  };
}
