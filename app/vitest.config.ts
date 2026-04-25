import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      '#': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
