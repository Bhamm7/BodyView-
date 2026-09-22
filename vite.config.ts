import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

/**
 * Stamps the build with the commit it came from.
 *
 * Self-hosting means "is the running app actually the latest?" is a question
 * that comes up constantly, and guessing from the UI is unreliable. This makes
 * it checkable: in Settings, and at /version.json without opening a browser.
 */
function buildStamp() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Built from a tarball or an export — no git available, and that is fine.
  }
  return { commit, builtAt: new Date().toISOString() };
}

const STAMP = buildStamp();

// BodyView is a fully client-side, offline-first app. The base path is
// configurable so the same build works on a custom domain or a GitHub Pages
// project subpath (set BODYVIEW_BASE=/BodyView-/ at build time).
const base = process.env.BODYVIEW_BASE ?? '/';

export default defineConfig({
  base,
  define: {
    __BUILD_COMMIT__: JSON.stringify(STAMP.commit),
    __BUILD_TIME__: JSON.stringify(STAMP.builtAt),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    {
      // Written into the build so `curl .../version.json` answers "what is
      // actually deployed?" without a browser or a rebuild.
      name: 'bodyview-version-stamp',
      apply: 'build',
      closeBundle() {
        mkdirSync('dist', { recursive: true });
        writeFileSync('dist/version.json', `${JSON.stringify(STAMP, null, 2)}\n`);
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'BodyView — Health & Fitness',
        short_name: 'BodyView',
        description:
          'Track body metrics, compound protocols, nutrition, training and supply inventory. Works offline.',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
