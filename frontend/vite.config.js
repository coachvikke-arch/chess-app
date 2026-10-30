import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /* pdfjs-dist ships modern ESM with a top-level-await-ing worker; keep it out
     of Vite's dev pre-bundling so it loads as-is (the worker is imported as a
     URL asset, never bundled). */
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  server: {
    port: 5173,
    historyApiFallback: true,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
  /* The production preview serves the built bundle, so it needs the same
     API/upload/socket routes the dev server proxies. Without this the built
     app cannot reach the backend and every request 404s on the preview host. */
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
});
