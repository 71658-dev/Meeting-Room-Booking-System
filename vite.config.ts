import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), preact()],
  root: 'src/client',
  // With `root` pointing at src/client, Vite would look for src/client/public and find
  // nothing — so _headers and security.txt never reached dist/, leaving the deployed
  // HTML with no CSP at all. Static files are served by Cloudflare Assets without ever
  // entering the Worker, so _headers is the ONLY way they get security headers.
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
