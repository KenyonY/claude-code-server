import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Library mode emits .d.ts only for the library entry surface.
    // App-only code under src/app, src/components/ui, and src/lib must not leak.
    dts({
      include: ['src'],
      exclude: ['src/app/**', 'src/components/ui/**', 'src/lib/**'],
      outDir: 'dist',
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    cssCodeSplit: false,
    rollupOptions: {
      // Library mode must NOT bundle app-only deps. Any leak fails the build.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-router',
        'react-router/dom',
        '@tanstack/react-query',
        'framer-motion',
        'sonner',
        /^@radix-ui\//,
      ],
    },
  },
})
