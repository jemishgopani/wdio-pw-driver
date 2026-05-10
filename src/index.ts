/**
 * Public entry point for `wdio-pw-driver`.
 *
 * Usage (standalone):
 *   import { remote } from 'wdio-pw-driver'
 *   const browser = await remote({ capabilities: { browserName: 'chromium' } })
 *
 * Usage (low-level):
 *   import PWDriver from 'wdio-pw-driver'
 *   const client = await PWDriver.newSession({ capabilities: {...} })
 */

import PWDriver from './driver.js'
import type { RemoteOptions } from './types.js'

export { PWDriver }
export default PWDriver

export { SUPPORTED_COMMAND_NAMES } from './commands/index.js'
export { default as PWService } from './service.js'
export type { PWServiceOptions } from './service.js'
export { installPerTestHooks } from './testHelpers.js'
export type { PWHooksMode, InstallPerTestHooksOptions } from './testHelpers.js'
export {
  WebDriverError,
  NoSuchElementError,
  StaleElementReferenceError,
  ElementNotInteractableError,
  TimeoutError,
  NoSuchWindowError,
  InvalidSessionIdError,
  NotImplementedError,
} from './errors.js'
export type {
  PWCapabilities,
  PWOptions,
  PWBrowser,
  RemoteOptions,
} from './types.js'

/**
 * Drop-in alternative to `webdriverio`'s `remote()` that creates a PW
 * session. Returns the same WDIO Browser shape so existing test code is
 * unchanged.
 *
 * Note: this currently bypasses webdriverio's `getProtocolDriver()` machinery
 * and goes straight to `PWDriver.newSession()`. A small number of
 * webdriverio-package commands (e.g. `$`, `$$`, `getPuppeteer`) won't be
 * attached when used this way; we lift those in v0.2 by routing through
 * webdriverio's monad explicitly.
 */
export async function remote(options: RemoteOptions): Promise<unknown> {
  return PWDriver.newSession(options)
}
