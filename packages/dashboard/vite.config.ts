import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset URLs relative so the static bundle works from any
// S3 key prefix / CloudFront path. The dev proxy forwards API calls to a local
// ccopt server so the SPA can run cross-origin-free in development.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
      '/v1': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
});
