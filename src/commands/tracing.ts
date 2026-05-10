import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { CommandHandler } from '../command.js'
import { WebDriverError } from '../errors.js'

/**
 * PW-specific extension commands for explicit Playwright trace control
 * (Option B in the trace plan). Useful for per-test tracing patterns:
 *
 *   beforeEach(() => browser.pwStartTrace())
 *   afterEach(function() {
 *     if (this.currentTest.state === 'failed') {
 *       browser.pwStopTrace(`./traces/${this.currentTest.title}.zip`)
 *     } else {
 *       browser.pwStopTrace()  // discard if it passed
 *     }
 *   })
 *
 * Calling `pwStartTrace` while another trace is active throws —
 * Playwright doesn't support nested top-level traces. (We could expose
 * `tracing.startChunk` for that, but it's not needed for the common case.)
 */

interface StartOptions {
  name?: string
  snapshots?: boolean
  screenshots?: boolean
  sources?: boolean
}

/**
 * PW `pwStartTrace(options?)` — start tracing now. The user owns
 * the lifecycle from here on; deleteSession will NOT auto-write the zip
 * even if `wdio:pwOptions.trace: true` was set elsewhere.
 *
 * Args: optional StartOptions object. Defaults match Playwright's
 * recommended config (snapshots + screenshots + sources all on).
 */
export const pwStartTrace: CommandHandler = async ({ session }, options) => {
  if (session.tracing.active) {
    throw new WebDriverError(
      'unsupported operation',
      'A trace is already in progress. Call pwStopTrace first.',
    )
  }
  const opts = (options ?? {}) as StartOptions
  await session.context.tracing.start({
    name: opts.name ?? `pw-${session.sessionId}`,
    snapshots: opts.snapshots ?? true,
    screenshots: opts.screenshots ?? true,
    sources: opts.sources ?? true,
  })
  session.tracing.active = true
  // Explicit start always means "user controls stop" — even if a previous
  // capability-driven auto-stop was queued, an explicit start replaces it.
  session.tracing.autoStop = false
  session.tracing.autoPath = undefined
  return null
}

/**
 * PW `pwStopTrace(path?)` — stop the active trace and write to
 * `path` (resolved relative to cwd). Pass no path to discard the trace.
 *
 * Returns the absolute path that was written (or null if discarded), so
 * tests can stash it for later inspection.
 */
export const pwStopTrace: CommandHandler = async ({ session }, path) => {
  if (!session.tracing.active) {
    throw new WebDriverError(
      'unsupported operation',
      'No trace is in progress. Call pwStartTrace first.',
    )
  }

  if (typeof path === 'string' && path.length > 0) {
    const abs = resolve(path)
    await mkdir(dirname(abs), { recursive: true }).catch(() => {})
    await session.context.tracing.stop({ path: abs })
    session.tracing.active = false
    return abs
  }

  // No path → stop and discard.
  await session.context.tracing.stop()
  session.tracing.active = false
  return null
}
