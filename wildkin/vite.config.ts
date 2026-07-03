import { defineConfig } from 'vite';

/**
 * Vite config for Wildkin.
 *
 * - `base: './'` makes the built files use relative paths, so the game can be
 *   hosted from any sub-folder (e.g. clawarcade.com/wildkin/) without changes.
 * - `server.host: true` exposes the dev server on your local network, so you
 *   can open the game on your phone while developing (Vite prints the URL).
 */
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Phaser is a big library; raise the warning limit so builds stay quiet.
    chunkSizeWarningLimit: 1600,
  },
});
