import type { Locator, Page, Frame } from 'playwright-core'

/**
 * The four W3C location strategies. WDIO translates its own extended
 * strategies (~, >>>, aria/, css/, etc.) into one of these *before* the
 * protocol command reaches the driver, so this is the complete set we need.
 *
 * @see https://w3c.github.io/webdriver/#locator-strategies
 */
export type LocatorStrategy =
  | 'css selector'
  | 'xpath'
  | 'link text'
  | 'partial link text'
  | 'tag name'

export type Scope = Page | Frame | Locator

/**
 * Build a Playwright Locator from a W3C strategy + value, scoped to either a
 * Page (top-level), a Frame, or another Locator (for findElementFromElement).
 */
export function buildLocator(scope: Scope, using: string, value: string): Locator {
  switch (using) {
    case 'css selector':
      return scope.locator(value)
    case 'xpath':
      return scope.locator(`xpath=${value}`)
    case 'tag name':
      return scope.locator(value)
    case 'link text':
      // Exact match on visible text of an <a>. Playwright's `getByRole('link')`
      // is the closest semantic equivalent.
      return scope.getByRole('link', { name: value, exact: true })
    case 'partial link text':
      return scope.getByRole('link', { name: new RegExp(escapeRegExp(value)) })
    default:
      throw new Error(`Unsupported locator strategy: "${using}"`)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
