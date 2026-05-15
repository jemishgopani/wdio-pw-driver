/**
 * Default config — Chromium. See wdio.shared.ts for the bulk of the
 * config; this file just picks the engine.
 *
 *   pnpm test                       # this config
 *   pnpm test:firefox               # wdio.firefox.conf.ts
 *   pnpm test:webkit                # wdio.webkit.conf.ts
 */
import { buildConfig } from './wdio.shared.js'

export const config = buildConfig('chromium')
