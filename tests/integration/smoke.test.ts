/**
 * Phase 1 exit criterion: a single round-trip through PW should be able
 * to navigate, locate an element, and read its text, all via the WDIO-shaped
 * client object that PWDriver.newSession() returns.
 *
 * This test launches a real headless Chromium and points it at a tiny inline
 * HTML page served via a data: URL — no network access required.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  getUrl(): Promise<string>
  getTitle(): Promise<string>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  findElements(using: string, value: string): Promise<Array<{ [k: string]: string }>>
  getElementText(elementId: string): Promise<string>
  getElementTagName(elementId: string): Promise<string>
  isElementDisplayed(elementId: string): Promise<boolean>
  elementClick(elementId: string): Promise<null>
  takeScreenshot(): Promise<string>
  getAllCookies(): Promise<unknown[]>
  addCookie(cookie: unknown): Promise<null>
  deleteAllCookies(): Promise<null>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  getWindowHandles(): Promise<string[]>
  deleteSession(): Promise<null>
}

const HTML = `
  <!doctype html>
  <html>
    <head><title>PW Smoke</title></head>
    <body>
      <h1 id="hello">Hello from PW</h1>
      <button id="btn" onclick="this.textContent='clicked'">click me</button>
      <ul>
        <li>one</li>
        <li>two</li>
        <li>three</li>
      </ul>
    </body>
  </html>
`
const URL = `data:text/html,${encodeURIComponent(HTML)}`

let browser: MinimalClient

beforeAll(async () => {
  browser = (await PWDriver.newSession({
    capabilities: {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true },
    },
  })) as MinimalClient
}, 30_000)

afterAll(async () => {
  if (browser) await browser.deleteSession()
})

describe('PW — Phase 1 smoke', () => {
  it('navigates and reports title + url', async () => {
    await browser.navigateTo(URL)
    expect(await browser.getTitle()).toBe('PW Smoke')
    expect(await browser.getUrl()).toContain('data:text/html')
  })

  it('findElement returns a W3C element reference', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    expect(ref).toHaveProperty(ELEMENT_KEY)
    expect(typeof ref[ELEMENT_KEY]).toBe('string')
  })

  it('reads element text and tag name', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    const id = ref[ELEMENT_KEY]!
    expect(await browser.getElementText(id)).toBe('Hello from PW')
    expect(await browser.getElementTagName(id)).toBe('h1')
    expect(await browser.isElementDisplayed(id)).toBe(true)
  })

  it('findElements returns the right count', async () => {
    const items = await browser.findElements('css selector', 'li')
    expect(items).toHaveLength(3)
    const first = items[0]![ELEMENT_KEY]!
    expect(await browser.getElementText(first)).toBe('one')
  })

  it('clicks an element and observes the side effect', async () => {
    const btnRef = await browser.findElement('css selector', '#btn')
    const id = btnRef[ELEMENT_KEY]!
    expect(await browser.getElementText(id)).toBe('click me')
    await browser.elementClick(id)
    expect(await browser.getElementText(id)).toBe('clicked')
  })

  it('takeScreenshot returns base64 PNG', async () => {
    const b64 = await browser.takeScreenshot()
    expect(typeof b64).toBe('string')
    // PNG magic number (\x89PNG) base64-encodes to "iVBORw0KGgo"
    expect(b64.startsWith('iVBORw0KGgo')).toBe(true)
  })

  it('cookies round-trip through context', async () => {
    await browser.deleteAllCookies()
    // Cookies on data: URLs aren't allowed; navigate to about:blank with a
    // synthetic URL anchor so the cookie has somewhere to live.
    await browser.navigateTo('about:blank')
    await browser.addCookie({ name: 'foo', value: 'bar', url: 'https://example.com/' })
    const all = await browser.getAllCookies()
    expect(all.some((c) => (c as { name: string }).name === 'foo')).toBe(true)
  })

  it('executeScript returns a value', async () => {
    const result = await browser.executeScript('return 1 + 2;', [])
    expect(result).toBe(3)
  })

  it('getWindowHandles reports at least one window', async () => {
    const handles = await browser.getWindowHandles()
    expect(handles.length).toBeGreaterThan(0)
  })
})
