import type { CommandHandler } from '../command.js'
import { currentScope } from '../scope.js'

/**
 * POST /session/:sessionId/url   body: { url }
 *
 * The W3C navigateTo command. WDIO's high-level `browser.url()` resolves to
 * this under the hood. Resets the current frame — old Frame refs become
 * invalid after navigation.
 */
export const navigateTo: CommandHandler = async ({ session }, url) => {
  if (typeof url !== 'string') {
    throw new TypeError(`navigateTo: expected string url, got ${typeof url}`)
  }
  // Use 'domcontentloaded' rather than 'load': SPAs commonly fire slow
  // third-party scripts (analytics, ads, monitoring) AFTER DOMContentLoaded
  // that hold the load event open for many seconds. WDIO's high-level
  // `browser.url()` is expected to return promptly so test code can start
  // querying — DOMContentLoaded matches that contract.
  await session.currentPage.goto(url, { waitUntil: 'domcontentloaded' })
  session.currentFrame = null
  return null
}

/**
 * GET /session/:sessionId/url
 */
export const getUrl: CommandHandler = async ({ session }) => {
  return session.currentPage.url()
}

/**
 * GET /session/:sessionId/title
 */
export const getTitle: CommandHandler = async ({ session }) => {
  return session.currentPage.title()
}

/**
 * POST /session/:sessionId/back
 */
export const back: CommandHandler = async ({ session }) => {
  await session.currentPage.goBack({ waitUntil: 'load' })
  session.currentFrame = null
  return null
}

/**
 * POST /session/:sessionId/forward
 */
export const forward: CommandHandler = async ({ session }) => {
  await session.currentPage.goForward({ waitUntil: 'load' })
  session.currentFrame = null
  return null
}

/**
 * POST /session/:sessionId/refresh
 */
export const refresh: CommandHandler = async ({ session }) => {
  await session.currentPage.reload({ waitUntil: 'load' })
  session.currentFrame = null
  return null
}

/**
 * GET /session/:sessionId/source
 *
 * Per W3C, returns the source of the *current browsing context* — which
 * means the active frame after switchToFrame, not the top-level page.
 */
export const getPageSource: CommandHandler = async ({ session }) => {
  return currentScope(session).content()
}
