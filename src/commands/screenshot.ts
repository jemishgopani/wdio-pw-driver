import type { CommandHandler } from '../command.js'
import { StaleElementReferenceError } from '../errors.js'

/**
 * GET /session/:sessionId/screenshot
 *
 * WebDriver returns base64 PNG data of the visible viewport.
 */
export const takeScreenshot: CommandHandler = async ({ session }) => {
  const buf = await session.currentPage.screenshot({ type: 'png' })
  return buf.toString('base64')
}

/**
 * GET /session/:sessionId/element/:elementId/screenshot
 */
export const takeElementScreenshot: CommandHandler = async ({ session }, elementId) => {
  if (typeof elementId !== 'string') {
    throw new TypeError('takeElementScreenshot: expected element-id string')
  }
  const loc = session.elementStore.get(elementId)
  if (!loc) {
    throw new StaleElementReferenceError(`Unknown element-id "${elementId}"`)
  }
  const buf = await loc.screenshot({ type: 'png', timeout: session.defaultTimeout })
  return buf.toString('base64')
}
