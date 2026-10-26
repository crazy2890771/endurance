/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json' with { type: 'json' };
import { execSync } from 'node:child_process';

/** Short commit of this build: from the CI/Cloudflare environment, else local git, else "dev". */
function buildCommit(): string {
  const env = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}
const build = { version: pkg.version, commit: buildCommit(), builtAt: new Date().toISOString() };

// ARTIFACT=1 builds a self-contained preview (relative paths, no service worker, in-memory routing)
// for hosts that cannot serve SPA routes or register a service worker.
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  base: artifact ? './' : '/',
  build: { outDir: artifact ? 'dist-artifact' : 'dist' },
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_BUILT_AT__: JSON.stringify(build.builtAt),
    __ARTIFACT__: JSON.stringify(artifact),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    {
      // /version.json lets you check which build is live without opening the app (not precached).
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build, null, 2) });
      },
    },
    VitePWA({
      disable: artifact,
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'KIM · Ground Time',
        short_name: 'Ground Time',
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
