import type { CommandHandler } from '../command.js'
import { StaleElementReferenceError, NoSuchElementError } from '../errors.js'

/**
 * Internal protocol command — wraps Playwright's `locator.waitFor({state})`.
 *
 * Used by `PWService` to back-fill `waitForExist` / `waitForDisplayed`
 * (and their `reverse: true` siblings) so WDIO's explicit-wait commands
 * use Playwright's in-page polling instead of WDIO's protocol-roundtrip
 * polling. This is faster (no per-poll HTTP round trip) and uses
 * Playwright's stricter definition of "visible" (handles
 * `content-visibility`, `<details>` open state, etc.).
 *
 * Not user-visible — the override is the public surface; this command
 * just exposes the primitive over the wire. Users who want a
 * Playwright-shaped wait directly should use the standard WDIO
 * `waitForX` commands; they'll route here automatically.
 *
 * If `locator.waitFor` times out, Playwright throws a TimeoutError; the
 * standard WebDriver error translation turns that into our
 * `NoSuchElementError` so the caller can catch by error code.
 */

interface PwWaitOpts {
  state?: 'attached' | 'detached' | 'visible' | 'hidden'
  timeout?: number
}

export const pwWaitElementFor: CommandHandler = async ({ session }, elementId, opts) => {
  if (typeof elementId !== 'string') {
    throw new TypeError(`pwWaitElementFor: expected elementId string, got ${typeof elementId}`)
  }
  const loc = session.elementStore.get(elementId)
  if (!loc) {
    throw new StaleElementReferenceError(`Unknown element-id "${elementId}"`)
  }
  const o = (opts ?? {}) as PwWaitOpts
  const state = o.state ?? 'visible'
  const timeout = typeof o.timeout === 'number' ? o.timeout : session.defaultTimeout

  try {
    await loc.waitFor({ state, timeout })
  } catch (err) {
    // Translate the underlying Playwright TimeoutError into a WebDriver
    // error so WDIO can recognize it (its catch by error.name relies on
    // the W3C code, not the PW class name).
    if ((err as { name?: string })?.name === 'TimeoutError') {
      throw new NoSuchElementError(
        `pwWaitElementFor: timed out after ${timeout}ms waiting for state=${state}`,
      )
    }
    throw err
  }
  return null
}
