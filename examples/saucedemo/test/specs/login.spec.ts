/**
 * Login flow — happy path + the four documented failure modes.
 *
 * What this exercises in the driver:
 *   - setValue routing through Playwright's `pressSequentially` (we
 *     verified this in the auto-wait demo; here it's incidental but
 *     still gets tested under real-page latency).
 *   - waitForDisplayed on the inline error region — uses our PWService
 *     override which polls in-page, so a rapid-flash error message
 *     gets caught.
 *   - URL change assertion uses Playwright's locator behind the scenes.
 */
import { browser, expect } from '@wdio/globals'

import { loginPage, inventoryPage } from '../page-objects/index.js'
import { users } from '../fixtures/users.js'

describe('SauceDemo — login', () => {
  beforeEach(async () => {
    await loginPage.open()
  })

  it('lets the standard user in', async () => {
    await loginPage.login(users.standard.username, users.standard.password)
    await expect(browser).toHaveUrl(expect.stringContaining('inventory.html'))
    await expect(inventoryPage.title).toHaveText('Products')
  })

  it('rejects locked_out_user with a clear error', async () => {
    await loginPage.login(users.lockedOut.username, users.lockedOut.password)
    await expect(loginPage.errorMessage).toBeDisplayed()
    await expect(loginPage.errorMessage).toHaveText(
      expect.stringContaining('Sorry, this user has been locked out'),
    )
  })

  it('flags missing username', async () => {
    await loginPage.loginButton.click()
    await expect(loginPage.errorMessage).toHaveText(
      expect.stringContaining('Username is required'),
    )
  })

  it('flags missing password', async () => {
    await loginPage.username.setValue(users.standard.username)
    await loginPage.loginButton.click()
    await expect(loginPage.errorMessage).toHaveText(
      expect.stringContaining('Password is required'),
    )
  })

  it('rejects bad credentials', async () => {
    await loginPage.login('not_a_user', 'definitely_wrong')
    await expect(loginPage.errorMessage).toHaveText(
      expect.stringContaining('Username and password do not match'),
    )
  })
})
