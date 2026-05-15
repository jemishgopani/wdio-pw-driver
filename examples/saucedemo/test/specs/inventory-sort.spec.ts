/**
 * Inventory sort — exercises the `<option>` click special-case.
 *
 * Why this is a useful regression test:
 *   - WDIO's `selectByAttribute('value', 'X')` calls `option.click()`
 *     under the hood. Playwright correctly rejects pointer events on
 *     `<option>` (they're only visible while the parent <select> is open),
 *     so this would hang for 30 s without our `elementClick` special-case
 *     that detects OPTION and routes to `parentSelect.selectOption()`.
 *   - This was Bug A from the original SauceDemo run that drove the fix.
 */
import { browser, expect } from '@wdio/globals'

import { loginPage, inventoryPage } from '../page-objects/index.js'
import { users } from '../fixtures/users.js'

describe('SauceDemo — inventory sort', () => {
  before(async () => {
    await loginPage.open()
    await loginPage.login(users.standard.username, users.standard.password)
  })

  beforeEach(async () => {
    if (!(await browser.getUrl()).includes('inventory.html')) {
      await inventoryPage.open()
    }
  })

  it('A → Z is the default order', async () => {
    const names = await inventoryPage.getNamesText()
    expect(names).toEqual([...names].sort())
  })

  it('Z → A reverses the order', async () => {
    await inventoryPage.sortBy('za')
    const names = await inventoryPage.getNamesText()
    expect(names).toEqual([...names].sort().reverse())
  })

  it('price low → high sorts ascending', async () => {
    await inventoryPage.sortBy('lohi')
    const prices = await inventoryPage.getPricesNumeric()
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('price high → low sorts descending', async () => {
    await inventoryPage.sortBy('hilo')
    const prices = await inventoryPage.getPricesNumeric()
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
  })

  it('completes a full sort cycle in well under 10s (no <option> click hang)', async () => {
    // The original Bug A hung for 30s (the test timeout). With the fix,
    // each option-click completes in ~400ms. Four sorts → < 2s realistic;
    // assert << 10s as a generous upper bound that catches a regression.
    const t0 = Date.now()
    for (const v of ['az', 'za', 'lohi', 'hilo'] as const) {
      await inventoryPage.sortBy(v)
    }
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(10_000)
  })
})
