/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json' with { type: 'json' };

// ARTIFACT=1 builds a self-contained preview (relative paths, no service worker, in-memory routing)
// for hosts that cannot serve SPA routes or register a service worker.
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  base: artifact ? './' : '/',
  build: { outDir: artifact ? 'dist-artifact' : 'dist' },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __ARTIFACT__: JSON.stringify(artifact) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      disable: artifact,
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'KIM ENDURANCE LAB',
        short_name: 'KIM Lab',
        description: 'Plan running, cycling, swimming and strength training around a flight-duty roster.',
        theme_color: '#090D10',
        background_color: '#090D10',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
