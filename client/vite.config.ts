import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        importScripts: ['./firebase-messaging-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/calendar\//],
        runtimeCaching: [
          // Firebase Auth endpoints — must always be fresh
          {
            urlPattern: /\/(identitytoolkit|securetoken)\.googleapis\.com/,
            handler: 'NetworkOnly',
          },
          // Google Calendar API — must always be fresh
          {
            urlPattern: /googleapis\.com\/calendar/,
            handler: 'NetworkOnly',
          },
          // Calendar sync endpoints — must always be fresh
          {
            urlPattern: /\/api\/calendar\//,
            handler: 'NetworkOnly',
          },
          // Static assets: images, fonts, icons — CacheFirst, 30-day expiry
          {
            urlPattern: /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          // API calls (excluding calendar) — StaleWhileRevalidate, 5-min expiry
          {
            urlPattern: /\/api\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60,
              },
            },
          },
          // Navigation requests — NetworkFirst for fresh HTML with cache fallback
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigation-cache',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: '../build',
    emptyOutDir: true,
    target: 'es2020',
    cssMinify: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Analytics is now dynamically imported, let Vite split it automatically
          if (id.includes('/firebase/analytics')) return;
          if (id.includes('/firebase/')) return 'vendor-firebase';
          if (id.includes('/@tanstack/')) return 'vendor-query';
          if (id.includes('/react-router')) return 'vendor-router';
          if (id.includes('/react-dom/')) return 'vendor-react-dom';
          if (id.includes('/react/')) return 'vendor-react';
          if (id.includes('/axios/')) return 'vendor-axios';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001/slotted-ai/us-central1',
        changeOrigin: true,
      },
    },
  },
})
