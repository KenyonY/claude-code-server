import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // App-mode-only path alias. Library build (vite.config.ts) intentionally
    // does NOT define this — any `@/app/*` import in a library file will fail
    // to resolve, enforcing the isolation boundary.
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: '../claude_code_server/static',
    emptyOutDir: true,
  },
})
