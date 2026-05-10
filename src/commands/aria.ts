import type { CommandHandler } from '../command.js'
import { StaleElementReferenceError } from '../errors.js'
import { ELEMENT_KEY } from '../types.js'

/**
 * PW-specific accessibility snapshot. Wraps Playwright's
 * `locator.ariaSnapshot()` (and `page.locator('html').ariaSnapshot()`
 * for the no-element case). The result is a YAML string that captures
 * the accessible-tree shape — useful for snapshot tests of UI structure
 * that survive cosmetic CSS changes.
 *
 * Usage:
 *   const yaml = await browser.pwAriaSnapshot()
 *   expect(yaml).toMatchSnapshot()
 *
 *   // Or scoped to a single element:
 *   const yaml = await browser.pwAriaSnapshot({ elementId: id })
 */

interface AriaSnapshotOpts {
  /** WebDriver element id to scope the snapshot to. Omit for full page. */
  elementId?: string
  /** Element reference object as returned from $() — convenience alt to elementId. */
  element?: { [k: string]: string }
  /** ARIA tree depth (Playwright default is unlimited). */
  depth?: number
}

export const pwAriaSnapshot: CommandHandler = async ({ session }, opts) => {
  const o = (opts ?? {}) as AriaSnapshotOpts
  const id = o.elementId ?? (o.element ? o.element[ELEMENT_KEY] : undefined)
  const ariaOpts = o.depth !== undefined ? { ref: false, depth: o.depth } : undefined

  if (id) {
    const loc = session.elementStore.get(id)
    if (!loc) {
      throw new StaleElementReferenceError(`Unknown element-id "${id}"`)
    }
    return loc.ariaSnapshot(ariaOpts)
  }

  // Page-level snapshot — root the locator at <html>.
  return session.currentPage.locator('html').ariaSnapshot(ariaOpts)
}
