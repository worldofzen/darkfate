// One command to put a Mixamo animation pack onto one of the game's characters:
//   npm.cmd run animations         (knight: mixamo/Knight -> public/models/Knight.glb)
//   npm.cmd run animations:boss    (boss:   mixamo/BOSS   -> public/models/BOSS.glb)
// Blender copies every animation in the pack folder onto the character's own skeleton,
// then the result is shrunk for the web.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pack = resolve(process.argv[2] ?? 'mixamo/Knight');
const knight = resolve(process.argv[3] ?? 'mixamo/Knight_reference.glb');
const output = resolve(process.argv[4] ?? 'public/models/Knight.glb');

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const base = 'C:/Program Files/Blender Foundation';
  if (existsSync(base)) {
    const versions = readdirSync(base).filter((d) => d.startsWith('Blender')).sort().reverse();
    for (const v of versions) {
      const exe = join(base, v, 'blender.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'blender';
}

if (!existsSync(join(pack, 'Y Bot.fbx'))) {
  console.error(`\nCan't find "Y Bot.fbx" in ${pack}`);
  console.error('Download the Mixamo pack (it comes with Y Bot) and unzip it into that folder.\n');
  process.exit(1);
}

const temp = join(mkdtempSync(join(tmpdir(), 'knight-')), 'knight_animated.glb');
const blender = findBlender();
console.log(`Using Blender: ${blender}`);
console.log(`Copying animations from: ${pack}`);

execFileSync(
  blender,
  ['--background', '--factory-startup', '--python', 'tools/retarget_mixamo.py', '--', pack, knight, temp],
  { stdio: 'inherit' }
);
if (!existsSync(temp)) {
  console.error('Blender could not copy the animations (see the messages above).');
  process.exit(1);
}

console.log('Shrinking for the web...');
execFileSync(
  'npx',
  [
    'gltf-transform', 'optimize', temp, output,
    '--simplify', 'false',
    '--texture-compress', 'webp',
    '--texture-size', '2048',
    '--compress', 'meshopt',
  ],
  { stdio: 'inherit', shell: true }
);
console.log(`Done! Saved ${output}`);
