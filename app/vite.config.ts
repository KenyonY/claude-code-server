import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.FRONTEND_PORT || '27999'),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || '8333'}`,
        changeOrigin: true,
      },
    },
  },
})
