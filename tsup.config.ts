import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'build',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node18',
  platform: 'node',
  external: [
    'webdriverio',
    'playwright-core',
    '@wdio/logger',
    '@wdio/protocols',
    '@wdio/utils',
    '@wdio/types',
  ],
})
