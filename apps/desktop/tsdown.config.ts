import { defineConfig } from 'tsdown'

/** Build standalone entries so the package whitelist never captures stale shared chunks. */
const shared = {
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
  noExternal: [
    '@deepseek-ai/dsh-subprocess-local/process-inspector',
  ],
} as const

export default defineConfig([
  { ...shared, entry: ['lib/types/src/bin.js'] },
  { ...shared, entry: ['lib/types/src/main.js'] },
  { ...shared, entry: ['lib/types/src/host.js'] },
])
