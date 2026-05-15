/**
 * Side-menu interactions — burger menu open/close, logout, reset state.
 *
 * The interesting case here is the cart-badge ASSERTION after reset:
 *
 *   await expect(header.cartBadge).not.toBeExisting()
 *
 * This was Bug B from the original SauceDemo run. expect-webdriverio's
 * `not.toBeExisting()` matcher relies on `findElement` returning a
 * not-found *body* (`{error: 'no such element', message}`) rather than
 * throwing — which is what stock chromedriver's webdriver package does.
 * Our driver had been throwing; the fix was to mirror the chromedriver
 * shape. Keeping this test so any future regression resurfaces.
 */
import { browser, expect } from '@wdio/globals'

import {
  loginPage,
  inventoryPage,
  header,
} from '../page-objects/index.js'
import { users } from '../fixtures/users.js'

describe('SauceDemo — side menu', () => {
  beforeEach(async () => {
    await loginPage.open()
    await loginPage.login(users.standard.username, users.standard.password)
  })

  it('opens and closes the burger menu', async () => {
    await header.openMenu()
    await expect(header.menuLogoutLink).toBeDisplayed()
    await header.closeMenu()
    // Allow the slide-out animation to fully complete.
    await header.menuLogoutLink.waitForDisplayed({ reverse: true })
  })

  it('logs the user out and returns to the login screen', async () => {
    await header.logout()
    await expect(loginPage.username).toBeDisplayed()
    await expect(browser).toHaveUrl('https://www.saucedemo.com/')
  })

  it('resets the app state and clears the cart badge', async () => {
    // Add something so the badge appears.
    await inventoryPage.addToCart('sauce-labs-backpack').click()
    await expect(header.cartBadge).toHaveText('1')

    // Reset state — Bug-B-class assertion below.
    await header.resetAppState()

    // The contract: after reset, the badge ELEMENT is removed from the
    // DOM. WDIO's `.not.toBeExisting()` matcher inspects the find result
    // for `error: 'no such element'` — which our driver returns rather
    // than throwing.
    await expect(header.cartBadge).not.toBeExisting()
  })
})
