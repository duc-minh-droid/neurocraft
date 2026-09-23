import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { neurocraft } from './pipeline/vite-plugin.ts'

export default defineConfig({
  plugins: [react(), neurocraft()],
  server: { watch: { ignored: ['**/.neurocraft/**', '**/.cache/**'] } },
})
