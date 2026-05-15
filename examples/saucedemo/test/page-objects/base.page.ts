import { browser } from '@wdio/globals'

/**
 * Base page — every page extends this. Centralizes the navigate-and-wait
 * pattern so individual page classes stay focused on their own selectors.
 *
 * Note: we don't add a manual `waitForLoaded` here. The override in
 * PWService routes WDIO's `waitForDisplayed` through Playwright's in-page
 * `locator.waitFor({state: 'visible'})`, so any subsequent `expect(el)
 * .toBeDisplayed()` or `el.waitForDisplayed()` IS the wait. Adding our
 * own polling loop on top would be slower for no benefit.
 */
export abstract class BasePage {
  /** Path under the baseUrl. Each subclass sets this. */
  protected abstract readonly path: string

  /** Navigate to this page's path. */
  async open(): Promise<void> {
    await browser.url(this.path)
  }

  /** Convenience getter — current page URL. */
  get url(): Promise<string> {
    return browser.getUrl()
  }
}
