import type { Frame } from 'playwright-core'

import type { CommandHandler } from '../command.js'
import { ELEMENT_KEY } from '../types.js'
import { NoSuchElementError, StaleElementReferenceError } from '../errors.js'

/**
 * POST /session/:sessionId/frame   body: { id }
 *
 * The W3C `id` parameter is overloaded:
 *   - null            → switch to the top-level browsing context
 *   - integer         → switch to the Nth child frame of the current scope
 *   - element ref     → switch to the iframe/frame element identified by the ref
 *
 * Anything else throws.
 */
export const switchToFrame: CommandHandler = async (ctx, id) => {
  // Case 1: null → reset to top-level.
  if (id === null) {
    ctx.session.currentFrame = null
    return null
  }

  // Case 2: integer index into the current scope's child frames.
  if (typeof id === 'number') {
    if (!Number.isInteger(id) || id < 0) {
      throw new TypeError(`switchToFrame: index must be a non-negative integer, got ${id}`)
    }
    const parentFrame: Frame =
      ctx.session.currentFrame ?? ctx.session.currentPage.mainFrame()
    const children = parentFrame.childFrames()
    if (id >= children.length) {
      throw new NoSuchElementError(`No frame at index ${id} (${children.length} available)`)
    }
    ctx.session.currentFrame = children[id]!
    return null
  }

  // Case 3: element reference pointing at an iframe.
  if (id && typeof id === 'object' && ELEMENT_KEY in (id as object)) {
    const elementId = (id as Record<string, unknown>)[ELEMENT_KEY]
    if (typeof elementId !== 'string') {
      throw new TypeError('switchToFrame: invalid element reference (expected string id)')
    }
    const loc = ctx.session.elementStore.get(elementId)
    if (!loc) {
      throw new StaleElementReferenceError(`Unknown element-id "${elementId}"`)
    }
    const handle = await loc.elementHandle({ timeout: ctx.session.implicitTimeout })
    if (!handle) {
      throw new StaleElementReferenceError(`Frame element "${elementId}" no longer attached`)
    }
    try {
      const frame = await handle.contentFrame()
      if (!frame) {
        throw new NoSuchElementError(
          `Element "${elementId}" is not a frame (no contentFrame available)`,
        )
      }
      ctx.session.currentFrame = frame
    } finally {
      await handle.dispose().catch(() => {})
    }
    return null
  }

  throw new TypeError(
    `switchToFrame: id must be null, integer, or element reference; got ${typeof id}`,
  )
}

/**
 * POST /session/:sessionId/frame/parent
 *
 * If already at top-level, this is a no-op (W3C says "succeed").
 */
export const switchToParentFrame: CommandHandler = async (ctx) => {
  if (!ctx.session.currentFrame) {
    return null
  }
  const parent = ctx.session.currentFrame.parentFrame()
  if (!parent || parent === ctx.session.currentPage.mainFrame()) {
    // Parent is the page itself — go back to top-level (null).
    ctx.session.currentFrame = null
  } else {
    ctx.session.currentFrame = parent
  }
  return null
}
