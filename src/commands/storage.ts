import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { CommandHandler } from '../command.js'
import { WebDriverError } from '../errors.js'

/**
 * PW-specific storage-state extension commands. Wraps Playwright's
 * `context.storageState()` for save and the `storageState` context option
 * (set in capabilities at session creation) for load.
 *
 * Why save+load are asymmetric:
 *   - SAVE happens at any point during the session — pull cookies +
 *     localStorage out of the live BrowserContext, write to disk.
 *   - LOAD has to happen at context-creation time, so it's set via
 *     `wdio:pwOptions.storageState: '/path/to/auth.json'` in caps.
 *     Loading mid-session would mean tearing down the context, which
 *     defeats the purpose of "reuse the existing session".
 *
 * Recommended workflow:
 *   beforeAll → log in → pwSaveStorage('./.auth/admin.json')
 *   subsequent runs: capability { storageState: './.auth/admin.json' }
 *     skips the login step — saves seconds per test, multiplied by N tests.
 */

/**
 * PW `pwSaveStorage(path)` — write the current BrowserContext's
 * cookies + localStorage to a JSON file. Returns the absolute path written.
 * Creates parent directories as needed.
 */
export const pwSaveStorage: CommandHandler = async ({ session }, path) => {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('pwSaveStorage: expected non-empty path string')
  }
  const abs = resolve(path)
  await mkdir(dirname(abs), { recursive: true }).catch(() => {})
  await session.context.storageState({ path: abs })
  return abs
}

/**
 * PW `pwLoadStorage(path)` — explicit no-op-ish loader. The actual
 * load happens at session creation via the `storageState` capability;
 * mid-session loading would require tearing the context down. We surface
 * this as a clear error so users see the right pattern instead of
 * silently missing their cookies.
 */
export const pwLoadStorage: CommandHandler = async () => {
  throw new WebDriverError(
    'unsupported operation',
    'pwLoadStorage cannot run mid-session. ' +
    'Set `wdio:pwOptions.storageState: "/path/to/auth.json"` in your capabilities ' +
    'so the context loads with the saved state at session creation.',
  )
}
