import { defineConfig } from 'vite';

export default defineConfig({
  base: '/TankBattle/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/@babylonjs/core/')) return 'engine';
          if (id.includes('/peerjs/') || id.includes('/qrcode/')) return 'multiplayer';
        },
      },
    },
  },
});
