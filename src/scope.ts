import type { Frame, Page } from 'playwright-core'
import type { PWSession } from './types.js'

/**
 * Resolve the "current browsing context" for find/execute/getPageSource.
 * If a child frame has been switched into, return that; otherwise the page's
 * main frame. Both Page and Frame share the relevant API surface
 * (.locator, .evaluate, .content, etc.) so callers can treat them uniformly.
 */
export function currentScope(session: PWSession): Page | Frame {
  return session.currentFrame ?? session.currentPage
}
