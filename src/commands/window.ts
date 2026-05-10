import type { Page } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import { NoSuchWindowError } from '../errors.js'

/**
 * Window-handle scheme: each Playwright Page is tracked under a synthesized
 * id of the form "page-N" where N is the order of opening within the
 * session. This matches WebDriver's opaque-string contract.
 */
function handleFor(session: { pages: Map<string, Page> }, page: Page): string {
  for (const [id, p] of session.pages) {
    if (p === page) return id
  }
  const id = `page-${session.pages.size + 1}`
  session.pages.set(id, page)
  return id
}

/**
 * GET /session/:sessionId/window
 */
export const getWindowHandle: CommandHandler = async ({ session }) => {
  return handleFor(session, session.currentPage)
}

/**
 * GET /session/:sessionId/window/handles
 */
export const getWindowHandles: CommandHandler = async ({ session }) => {
  // Refresh: include any pages opened by the page itself (window.open, etc.)
  for (const page of session.context.pages()) {
    handleFor(session, page)
  }
  return Array.from(session.pages.keys())
}

/**
 * POST /session/:sessionId/window   body: { handle }
 */
export const switchToWindow: CommandHandler = async ({ session }, handle) => {
  if (typeof handle !== 'string') {
    throw new TypeError('switchToWindow: expected handle string')
  }
  const page = session.pages.get(handle)
  if (!page || page.isClosed()) {
    throw new NoSuchWindowError(`No window with handle "${handle}"`)
  }
  await page.bringToFront()
  session.currentPage = page
  return null
}

/**
 * DELETE /session/:sessionId/window
 *
 * Closes the current window. If others remain, returns their handles per W3C.
 */
export const closeWindow: CommandHandler = async ({ session }) => {
  const closing = session.currentPage
  await closing.close()

  // Drop closed page from our store, pick another current page if any remain.
  for (const [id, p] of session.pages) {
    if (p === closing) session.pages.delete(id)
  }
  const remaining = session.context.pages().filter((p) => !p.isClosed())
  if (remaining.length > 0) {
    session.currentPage = remaining[0]!
  }
  return remaining.map((p) => handleFor(session, p))
}

/**
 * GET /session/:sessionId/window/rect
 */
export const getWindowRect: CommandHandler = async ({ session }) => {
  const size = session.currentPage.viewportSize()
  return {
    x: 0,
    y: 0,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
  }
}

/**
 * POST /session/:sessionId/window/rect   body: { width, height, x, y }
 *
 * Playwright doesn't expose window position in a cross-platform way, so we
 * honor width/height via setViewportSize and ignore x/y. WebDriver allows
 * implementations to report back the actual rect, which we do.
 */
export const setWindowRect: CommandHandler = async ({ session }, width, height) => {
  const w = typeof width === 'number' ? width : undefined
  const h = typeof height === 'number' ? height : undefined
  if (w !== undefined && h !== undefined) {
    await session.currentPage.setViewportSize({ width: w, height: h })
  }
  const size = session.currentPage.viewportSize()
  return {
    x: 0,
    y: 0,
    width: size?.width ?? w ?? 0,
    height: size?.height ?? h ?? 0,
  }
}

/**
 * POST /session/:sessionId/window/maximize
 *
 * Playwright has no concept of OS-level window state. Best-effort: enlarge
 * the viewport to the screen size reported by the page (window.screen).
 * Returns the new rect per W3C.
 */
export const maximizeWindow: CommandHandler = async ({ session }) => {
  const screen = await session.currentPage.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }))
  await session.currentPage.setViewportSize(screen)
  return { x: 0, y: 0, width: screen.width, height: screen.height }
}

/**
 * POST /session/:sessionId/window/minimize
 *
 * Playwright cannot truly minimize. We honor the spirit of the command by
 * making the viewport non-renderable from the user's standpoint (no-op for
 * headless). Per W3C, returns the new rect.
 */
export const minimizeWindow: CommandHandler = async ({ session }) => {
  // No-op for headless; nothing to minimize. Report current rect.
  const size = session.currentPage.viewportSize()
  return { x: 0, y: 0, width: size?.width ?? 0, height: size?.height ?? 0 }
}

/**
 * POST /session/:sessionId/window/fullscreen
 *
 * Triggers Fullscreen API on the document element. This requires user
 * activation in a real browser; in headless it succeeds without a prompt.
 * Returns the new rect.
 */
export const fullscreenWindow: CommandHandler = async ({ session }) => {
  await session.currentPage
    .evaluate(() => document.documentElement.requestFullscreen())
    .catch(() => {
      /* swallow — headless fallback already ran maximize-equivalent */
    })
  // Match maximize's behavior so the returned rect reflects "biggest possible".
  const screen = await session.currentPage.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }))
  await session.currentPage.setViewportSize(screen)
  return { x: 0, y: 0, width: screen.width, height: screen.height }
}

/**
 * POST /session/:sessionId/window/new   body: { type: 'tab' | 'window' }
 *
 * Playwright's BrowserContext doesn't differentiate tab vs window — both
 * become a new Page in the same context. We honor `type` for the response
 * but the underlying behavior is identical.
 */
export const createWindow: CommandHandler = async ({ session }, type) => {
  const requestedType = type === 'window' ? 'window' : 'tab'
  const page = await session.context.newPage()
  // Reuse the handle-allocation logic by going through handleFor.
  const handle = handleFor(session, page)
  return { handle, type: requestedType }
}
