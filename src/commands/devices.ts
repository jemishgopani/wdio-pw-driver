import { devices } from 'playwright-core'

import type { CommandHandler } from '../command.js'

/**
 * `pwListDevices()` — return Playwright's full device-descriptor registry
 * as a `{ name → descriptor }` map. Useful for:
 *   - discovery in the REPL: `Object.keys(await browser.pwListDevices())`
 *   - building dropdowns of valid `pwSwitchDevice` arguments
 *   - feature-detection (does the user's playwright-core install have the
 *     specific preset they need?)
 *
 * Each descriptor contains `userAgent`, `viewport: {width, height}`,
 * `deviceScaleFactor`, `isMobile`, `hasTouch`, and `defaultBrowserType`.
 * Return shape is whatever Playwright ships in the current `playwright-core`
 * version — Bridge passes it through unchanged so users always see the
 * source-of-truth shape.
 */
export const pwListDevices: CommandHandler = async () => {
  // `devices` is a static-imported plain object; returning it directly
  // means the receiving end gets a structured-clone copy via the WDIO
  // command bus. No mutation risk for the imported registry.
  return devices
}
