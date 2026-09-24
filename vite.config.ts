import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { neurocraft } from './pipeline/vite-plugin.ts'

export default defineConfig({
  plugins: [react(), neurocraft()],
  // world.json and new assets are pushed over the websocket by the plugin, not via HMR reloads.
  server: { watch: { ignored: ['**/.neurocraft/**', '**/.cache/**', '**/world.json', '**/public/assets/**'] } },
})
