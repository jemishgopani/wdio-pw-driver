/**
 * Smallest possible spec — proves the driver wires up and round-trips a
 * navigate + find + assert cycle. Targets example.com because it's stable,
 * tiny, and rendered server-side (so no SPA-loading races).
 */
import { browser, expect, $ } from '@wdio/globals'

describe('hello world', () => {
  it('navigates to example.com and reads the heading', async () => {
    await browser.url('https://example.com')

    // `<h1>` is rendered server-side, so it's there at DOMContentLoaded.
    // Auto-wait would still cover us if it weren't.
    await expect($('h1')).toHaveText('Example Domain')

    // Sanity check: page title matches.
    await expect(browser).toHaveTitle('Example Domain')
  })
})
