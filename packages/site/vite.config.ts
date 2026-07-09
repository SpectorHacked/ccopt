import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' → relative asset URLs so the static bundle works from any S3 key /
// CloudFront path. Three.js is chunked out to keep the initial payload lean.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5274 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
