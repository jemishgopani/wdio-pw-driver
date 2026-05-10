import type { CommandHandler } from '../command.js'
import { unregisterSession } from '../client.js'
import { log } from '../logger.js'

/**
 * DELETE /session/:sessionId
 *
 * Closes the Playwright browser, unregisters the session, returns null.
 * After this, any subsequent command against the same sessionId will get
 * InvalidSessionIdError, which is the correct WebDriver behavior.
 *
 * If `wdio:pwOptions.trace: true` started a trace at session creation,
 * we stop it here and write the zip to the path picked at start. Failures
 * during stop are swallowed — losing the trace zip is preferable to leaving
 * the browser process hanging.
 */
export const deleteSession: CommandHandler = async ({ session }) => {
  log.info(`closing session ${session.sessionId}`)
  if (session.tracing.active && session.tracing.autoStop && session.tracing.autoPath) {
    try {
      await session.context.tracing.stop({ path: session.tracing.autoPath })
      log.info(`trace written: ${session.tracing.autoPath}`)
    } catch (err) {
      log.warn(`failed to write trace: ${(err as Error).message}`)
    }
    session.tracing.active = false
  }
  try {
    await session.context.close()
  } finally {
    await session.browser.close().catch(() => {})
    session.elementStore.clear()
    unregisterSession(session.sessionId)
  }
  return null
}

/**
 * GET /status
 *
 * PW is always ready as long as Node is running. We report the UA-style
 * info real drivers report so probes (e.g. `wdio config wizard`) succeed.
 */
export const status: CommandHandler = async () => {
  return {
    ready: true,
    message: 'PW driver ready',
  }
}

/**
 * GET /session/:sessionId/timeouts
 *
 * Reports the three W3C timeout buckets independently:
 *   - implicit: applied to find* commands (DOM polling for element presence)
 *   - pageLoad: applied to navigations
 *   - script: applied to executeScript / executeAsyncScript
 *
 * PW currently reuses `defaultTimeout` for pageLoad and script.
 */
export const getTimeouts: CommandHandler = async ({ session }) => {
  return {
    implicit: session.implicitTimeout,
    pageLoad: session.defaultTimeout,
    script: session.defaultTimeout,
  }
}

/**
 * POST /session/:sessionId/timeouts  body: { implicit?, pageLoad?, script? }
 *
 * Each field is optional; only provided fields update.
 */
export const setTimeouts: CommandHandler = async ({ session }, implicit, pageLoad, script) => {
  if (typeof implicit === 'number' && Number.isFinite(implicit)) {
    // Honor 0 as "no implicit wait" (W3C default), but Playwright requires a
    // positive number to attempt at least one DOM poll, so floor at 1.
    session.implicitTimeout = Math.max(1, implicit)
  }
  if (typeof pageLoad === 'number' && Number.isFinite(pageLoad)) {
    session.defaultTimeout = pageLoad
    session.context.setDefaultTimeout(pageLoad)
  }
  if (typeof script === 'number' && Number.isFinite(script)) {
    // No separate script timeout in Playwright; use the action default.
    session.defaultTimeout = script
    session.context.setDefaultTimeout(script)
  }
  return null
}
