import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
