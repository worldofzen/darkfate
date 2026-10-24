// Prepares the HUD images (run once: `node tools/make_hud.mjs`).
//
// The health bar pictures come with the bar already full of red. For the game we need:
//   *_full.webp    the picture as it is (trimmed and resized)
//   *_empty.webp   the same frame with the red channel darkened (an empty trough)
//   hud_bars.json  where the red channel is in each picture (in %), so the game can show
//                  "full" only up to your current health, over the "empty" one.
// The flask icon is just trimmed and resized.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const OUT = 'public/ui';

async function trimmed(file, width) {
  const { data, info } = await sharp(file).ensureAlpha().trim({ threshold: 10 }).resize({ width }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const isRed = (d, i) => d[i + 3] > 200 && d[i] > 110 && d[i] > d[i + 1] * 2.2 && d[i] > d[i + 2] * 2.2;
// Looser: also the channel's darker and paler reds (its shading top to bottom).
const isReddish = (d, i) => d[i + 3] > 150 && d[i] > 45 && d[i] > d[i + 1] * 1.5 && d[i] > d[i + 2] * 1.5;

// The red channel: the longest run of red pixels across the middle, grown up and down while
// rows stay red across it.
function findChannel({ data, width, height }) {
  let best = { row: 0, left: 0, right: -1 };
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const red = x < width && isRed(data, (y * width + x) * 4);
      if (red && start < 0) start = x;
      if (!red && start >= 0) {
        if (x - 1 - start > best.right - best.left) best = { row: y, left: start, right: x - 1 };
        start = -1;
      }
    }
  }
  const redShare = (y) => {
    let n = 0;
    for (let x = best.left; x <= best.right; x++) if (isReddish(data, (y * width + x) * 4)) n++;
    return n / (best.right - best.left + 1);
  };
  let top = best.row;
  let bottom = best.row;
  while (top > 0 && redShare(top - 1) > 0.5) top--;
  while (bottom < height - 1 && redShare(bottom + 1) > 0.5) bottom++;
  const m = 5; // a little margin: the channel's rounded ends and its bright top edge
  return { left: best.left - m, right: best.right + m, top: top - m, bottom: bottom + m };
}

async function bar(file, name, width) {
  const image = await trimmed(file, width);
  const ch = findChannel(image);
  const save = (pixels, suffix) =>
    sharp(pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/${name}_${suffix}.webp`);
  await save(image.data, 'full');
  // Empty: the red in the channel turns to a dark, dried-blood trough (the frame stays as it is).
  const empty = Buffer.from(image.data);
  for (let y = ch.top; y <= ch.bottom; y++) {
    for (let x = ch.left; x <= ch.right; x++) {
      const i = (y * image.width + x) * 4;
      // Any red, including the pale pinkish highlight (the gold frame is much less red).
      if (empty[i + 3] > 100 && empty[i] > 45 && empty[i] > empty[i + 1] * 1.35 && empty[i] > empty[i + 2] * 1.35) {
        const l = (empty[i] + empty[i + 1] + empty[i + 2]) / 3;
        empty[i] = 14 + l * 0.22;
        empty[i + 1] = 6 + l * 0.05;
        empty[i + 2] = 6 + l * 0.05;
      }
    }
  }
  await save(empty, 'empty');
  const pct = (v, of) => +((v / of) * 100).toFixed(3);
  console.log(`  ${name}: ${image.width}x${image.height}, channel x ${ch.left}-${ch.right}, y ${ch.top}-${ch.bottom}`);
  return {
    aspect: +(image.width / image.height).toFixed(4),
    left: pct(ch.left, image.width),
    right: pct(image.width - 1 - ch.right, image.width),
    top: pct(ch.top, image.height),
    bottom: pct(image.height - 1 - ch.bottom, image.height),
  };
}

const bars = {
  player: await bar('Full crimson health bar.png', 'health_bar', 1200),
  boss: await bar('Full crimson gothic boss health bar.png', 'boss_bar', 1800),
};
writeFileSync(`${OUT}/hud_bars.json`, JSON.stringify(bars, null, 2));
const flask = await trimmed('Crimson Healing Potion Flask.png', 160);
await sharp(flask.data, { raw: { width: flask.width, height: flask.height, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/flask.webp`);
console.log(`  flask: ${flask.width}x${flask.height}`);
console.log(JSON.stringify(bars));
