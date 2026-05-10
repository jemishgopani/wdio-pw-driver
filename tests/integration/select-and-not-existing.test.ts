/**
 * Regression tests for the two real-world bugs surfaced by the
 * `Wdio-ideas/wdio-sample` SauceDemo run:
 *
 *   Bug A — clicking an `<option>` inside a `<select>` hung Playwright's
 *           actionability check until the test timeout. Fix: in
 *           elementClick, detect OPTION tag and route to the parent
 *           `<select>`'s `selectOption({ value })`.
 *
 *   Bug B — `findElement` for a missing element threw a
 *           NoSuchElementError, but stock `webdriver` package treats a
 *           404 'no such element' response as a SUCCESSFUL response and
 *           returns `{error, message}` as the value. WDIO's chainable
 *           `$()` flow then wraps that as `Element.error` and
 *           expect-webdriverio's `not.toBeExisting()` matcher inspects
 *           that field — if our driver throws, the matcher rejects
 *           instead of passing. Fix: `findElement*` returns the not-found
 *           body shape rather than throwing. The W3C error name is also
 *           preserved on the body's `.error` field.
 *
 * These tests don't depend on WDIO or expect-webdriverio — they exercise
 * the driver's `BridgeDriver.newSession()` surface directly and assert
 * the contract that those packages rely on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  findElementFromElement(parentId: string, using: string, value: string): Promise<{ [k: string]: string }>
  elementClick(elementId: string): Promise<null>
  getElementProperty(elementId: string, prop: string): Promise<string>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  deleteSession(): Promise<null>
}

const HTML = `<!doctype html>
<html><body>
  <select id="sort">
    <option value="az">A → Z</option>
    <option value="za">Z → A</option>
    <option value="lohi">price low → high</option>
    <option value="hilo">price high → low</option>
  </select>
  <output id="echo"></output>
  <script>
    document.getElementById('sort').addEventListener('change', (e) => {
      document.getElementById('echo').textContent = e.target.value
    })
  </script>
</body></html>`
const URL = `data:text/html,${encodeURIComponent(HTML)}`

describe('Bug A — <option> click routes via parent select.selectOption', () => {
  let browser: MinimalClient
  beforeAll(async () => {
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        'wdio:pwOptions': { headless: true },
      },
    })) as MinimalClient
  }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('click on <option> changes the parent <select> value', async () => {
    await browser.navigateTo(URL)

    // Find the <option value="hilo">.
    const optionRef = await browser.findElement(
      'xpath',
      '//select[@id="sort"]/option[@value="hilo"]',
    )
    expect(optionRef[ELEMENT_KEY]).toBeTruthy()

    // The pre-fix behavior was a 30s timeout here. Now it should
    // complete in <500ms because we route to selectOption.
    const t0 = Date.now()
    await browser.elementClick(optionRef[ELEMENT_KEY]!)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(2000)

    // The select's value reflects the chosen option's value.
    const selectRef = await browser.findElement('css selector', '#sort')
    const value = await browser.getElementProperty(selectRef[ELEMENT_KEY]!, 'value')
    expect(value).toBe('hilo')

    // And the change event fired (proves selectOption used the proper
    // Playwright primitive that dispatches input/change events, not a
    // raw click that doesn't update the dropdown).
    const echoText = await browser.executeScript(
      'return document.getElementById("echo").textContent;',
      [],
    )
    expect(echoText).toBe('hilo')
  }, 15_000)

  it('clicking each option in turn updates the select correctly', async () => {
    // Walk all four options to make sure the routing works for any value,
    // not just one. This is the smoke test for WDIO's selectByAttribute
    // calling option.click() in a loop.
    for (const v of ['az', 'za', 'lohi', 'hilo']) {
      const ref = await browser.findElement(
        'xpath',
        `//select[@id="sort"]/option[@value="${v}"]`,
      )
      await browser.elementClick(ref[ELEMENT_KEY]!)
    }
    // Final state should be the last-clicked.
    const selectRef = await browser.findElement('css selector', '#sort')
    expect(await browser.getElementProperty(selectRef[ELEMENT_KEY]!, 'value')).toBe('hilo')
  }, 15_000)

  it('regular (non-option) click is unaffected by the special-case', async () => {
    // Add a button via execute, then click it the normal way.
    await browser.executeScript(
      `const b = document.createElement('button');
       b.id = 'p';
       b.textContent = 'click me';
       b.addEventListener('click', () => { b.textContent = 'clicked' });
       document.body.appendChild(b);
       return null;`,
      [],
    )
    const btn = await browser.findElement('css selector', '#p')
    await browser.elementClick(btn[ELEMENT_KEY]!)
    const text = await browser.executeScript(
      'return document.getElementById("p").textContent;',
      [],
    )
    expect(text).toBe('clicked')
  }, 15_000)
})

describe('Bug B — findElement returns the not-found body, does not throw', () => {
  let browser: MinimalClient
  beforeAll(async () => {
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        'wdio:pwOptions': { headless: true, timeout: 1500 },
      },
    })) as MinimalClient
  }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('findElement returns {error: "no such element", message} on miss', async () => {
    await browser.navigateTo('data:text/html,<body><h1>nothing here</h1></body>')

    // Should NOT reject. WDIO's chainable $() relies on getting a value
    // back so it can wrap it as `Element.error`.
    const res = (await browser.findElement(
      'css selector',
      '[data-test="missing"]',
    )) as unknown as { error?: string; message?: string; [k: string]: unknown }

    expect(res[ELEMENT_KEY]).toBeUndefined()
    expect(res.error).toBe('no such element')
    expect(typeof res.message).toBe('string')
  }, 10_000)

  it('mirrors the not.toBeExisting() contract (no throw, error field set)', async () => {
    // Mirror what expect-webdriverio's matcher does internally: read the
    // result body, treat `error === "no such element"` as "doesn't exist".
    await browser.navigateTo('data:text/html,<body></body>')

    const res = (await browser.findElement('css selector', '#nope')) as unknown as {
      error?: string
    }
    const exists = res.error !== 'no such element'
    expect(exists).toBe(false)
  }, 10_000)

  it('successful find still returns a proper element reference', async () => {
    // Sanity check the success path is unchanged.
    await browser.navigateTo('data:text/html,<body><h1 id="hi">hi</h1></body>')
    const res = await browser.findElement('css selector', '#hi')
    expect(res[ELEMENT_KEY]).toBeTruthy()
    expect(typeof res[ELEMENT_KEY]).toBe('string')
  }, 10_000)
})
