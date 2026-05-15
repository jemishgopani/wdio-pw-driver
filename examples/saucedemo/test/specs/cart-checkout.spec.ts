/**
 * Cart and checkout flow — covers the critical purchase path.
 *
 * Driver features incidentally tested:
 *   - Multiple chained navigations (login → inventory → cart → checkout-1
 *     → checkout-2 → complete). Each goes through Playwright's
 *     `page.goto({waitUntil: 'domcontentloaded'})`.
 *   - getElementText / setValue across re-rendering page transitions.
 *   - getElementsLength via $$ — covered by `cartPage.itemCount()`.
 */
import { browser, expect } from '@wdio/globals'

import {
  loginPage,
  inventoryPage,
  cartPage,
  checkoutPage,
  header,
} from '../page-objects/index.js'
import { users } from '../fixtures/users.js'

describe('SauceDemo — cart + checkout', () => {
  beforeEach(async () => {
    await loginPage.open()
    await loginPage.login(users.standard.username, users.standard.password)
  })

  afterEach(async () => {
    // Reset between tests so we don't carry items across.
    if (await header.cartBadge.isExisting()) {
      await header.resetAppState()
    }
  })

  it('adds a single item and shows badge=1', async () => {
    await inventoryPage.addToCart('sauce-labs-backpack').click()
    await expect(header.cartBadge).toHaveText('1')
  })

  it('adds three items and shows badge=3', async () => {
    await inventoryPage.addToCart('sauce-labs-backpack').click()
    await inventoryPage.addToCart('sauce-labs-bike-light').click()
    await inventoryPage.addToCart('sauce-labs-bolt-t-shirt').click()
    await expect(header.cartBadge).toHaveText('3')
  })

  it('removes an item from the inventory page', async () => {
    await inventoryPage.addToCart('sauce-labs-onesie').click()
    await expect(header.cartBadge).toHaveText('1')
    await inventoryPage.removeFromCart('sauce-labs-onesie').click()
    await expect(header.cartBadge).not.toBeExisting()
  })

  it('shows the chosen items on the cart page', async () => {
    await inventoryPage.addToCart('sauce-labs-fleece-jacket').click()
    await inventoryPage.addToCart('test.allthethings()-t-shirt-(red)').click()
    await header.cartLink.click()
    await expect(cartPage.title).toHaveText('Your Cart')
    expect(await cartPage.itemCount()).toBe(2)
  })

  it('completes the full checkout flow', async () => {
    await inventoryPage.addToCart('sauce-labs-backpack').click()
    await header.cartLink.click()
    await cartPage.checkoutButton.click()

    await checkoutPage.fillInfo('Test', 'User', '12345')
    await checkoutPage.continueButton.click()

    // Step 2 — verify totals are present (don't assert exact $ since the
    // site occasionally changes the tax rate)
    await expect(checkoutPage.summarySubtotalLabel).toBeDisplayed()
    await expect(checkoutPage.summaryTaxLabel).toBeDisplayed()
    await expect(checkoutPage.summaryTotalLabel).toBeDisplayed()

    await checkoutPage.finishButton.click()
    await expect(checkoutPage.completeHeader).toHaveText('Thank you for your order!')

    await checkoutPage.backHomeButton.click()
    await expect(browser).toHaveUrl(expect.stringContaining('inventory.html'))
  })

  it('rejects checkout without first name', async () => {
    await inventoryPage.addToCart('sauce-labs-backpack').click()
    await header.cartLink.click()
    await cartPage.checkoutButton.click()
    await checkoutPage.continueButton.click()
    await expect(checkoutPage.errorMessage).toHaveText(
      expect.stringContaining('First Name is required'),
    )
  })
})
