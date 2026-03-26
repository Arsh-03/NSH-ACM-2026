import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Added png to assetsInclude so Vite handles local image imports correctly
  assetsInclude: ['**/*.svg', '**/*.csv', '**/*.png', '**/*.jpg', '**/*.jpeg'],
  server: {
    proxy: {
      // Proxy REST API calls to FastAPI backend
      '/api': 'http://localhost:8000',
      // Proxy WebSocket connection to FastAPI backend
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})