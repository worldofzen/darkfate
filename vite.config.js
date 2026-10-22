import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built game works from any web address (e.g. GitHub Pages,
  // which serves it from a sub-folder like /darkfate/).
  base: './',
  server: {
    watch: {
      // Don't watch raw source art: big files, downloads in progress and Blender
      // temp files there can crash the dev server. Only public/ and src/ matter to the game.
      ignored: ['**/mixamo/**', '**/tools/**', '**/*.fbx', '**/*.wav', '**/*.crdownload', '**/*.part', '**/*.tmp', '**/*.blend*'],
    },
  },
});
