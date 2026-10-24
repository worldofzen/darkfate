import { defineConfig } from 'vite';

// The original art you drop into the project folder (big .glb models, .png images...): only the
// prepared copies in public/ are used. Watching a file while it's still being copied crashes the
// server, so these are left alone.
const rawArt = (file) =>
  /\.(glb|gltf|png|jpe?g|webp|mp4|mov)$/i.test(file) && !file.replace(/\\/g, '/').includes('/public/');

export default defineConfig({
  // Relative paths, so the built game works from any web address (e.g. GitHub Pages,
  // which serves it from a sub-folder like /darkfate/).
  base: './',
  server: {
    watch: {
      // Don't watch raw source art: big files, downloads in progress and Blender
      // temp files there can crash the dev server. Only public/ and src/ matter to the game.
      ignored: [rawArt,'**/mixamo/**', '**/tools/**', '**/music_source/**', '**/*.fbx', '**/*.wav', '**/*.crdownload', '**/*.part', '**/*.tmp', '**/*.blend*'],
    },
  },
});
