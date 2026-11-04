import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships its command, profile lifecycle, and Desktop Host entrypoints.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: {
    bin: 'lib/types/installed-bin.js',
    'profile-boot': 'lib/types/profile-boot.js',
    'desktop-host': 'lib/types/desktop-host.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js'],
})
