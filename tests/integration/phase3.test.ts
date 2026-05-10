/**
 * Phase 3 — browser-level coverage closeout. Validates:
 *   - printPage returns a real PDF
 *   - createWindow opens a tab/window we can switch to
 *   - maximize / minimize / fullscreen return rects
 *   - executeScript with element-reference args resolves to live DOM Element
 *   - executeScript returning a DOM Element gets a fresh W3C reference back
 *   - executeAsyncScript with element-reference + async resolution
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  getElementText(elementId: string): Promise<string>
  getElementProperty(elementId: string, name: string): Promise<unknown>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  executeAsyncScript(script: string, args: unknown[]): Promise<unknown>
  printPage(opts?: unknown): Promise<string>
  createWindow(type: 'tab' | 'window'): Promise<{ handle: string; type: string }>
  switchToWindow(handle: string): Promise<null>
  getWindowHandle(): Promise<string>
  getWindowHandles(): Promise<string[]>
  closeWindow(): Promise<string[]>
  maximizeWindow(): Promise<{ x: number; y: number; width: number; height: number }>
  minimizeWindow(): Promise<{ x: number; y: number; width: number; height: number }>
  fullscreenWindow(): Promise<{ x: number; y: number; width: number; height: number }>
  setWindowRect(width: number, height: number): Promise<unknown>
  deleteSession(): Promise<null>
}

const HTML = `
  <!doctype html>
  <html>
    <head><title>Phase 3</title></head>
    <body>
      <h1 id="hello">Hello P3</h1>
      <button id="btn">click me</button>
      <ul>
        <li>one</li>
        <li>two</li>
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

beforeEach(async () => {
  // Bring focus back to the original tab and reload state for each test.
  const handles = await browser.getWindowHandles()
  if (handles[0]) await browser.switchToWindow(handles[0])
  await browser.navigateTo(URL)
})

describe('Phase 3 — printPage', () => {
  it('returns base64 PDF data', async () => {
    const b64 = await browser.printPage()
    expect(typeof b64).toBe('string')
    expect(b64.length).toBeGreaterThan(100)
    // PDF signature "%PDF" base64-encodes to "JVBERi0".
    expect(b64.startsWith('JVBERi0')).toBe(true)
  })

  it('honors landscape orientation', async () => {
    const portrait = await browser.printPage({ orientation: 'portrait' })
    const landscape = await browser.printPage({ orientation: 'landscape' })
    // Different orientations should produce different bytes.
    expect(portrait).not.toBe(landscape)
  })
})

describe('Phase 3 — window state', () => {
  it('maximizeWindow returns the screen-sized rect', async () => {
    const rect = await browser.maximizeWindow()
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })

  it('minimizeWindow returns the current rect', async () => {
    await browser.setWindowRect(640, 480)
    const rect = await browser.minimizeWindow()
    expect(rect.width).toBe(640)
    expect(rect.height).toBe(480)
  })

  it('fullscreenWindow returns a rect (best-effort in headless)', async () => {
    const rect = await browser.fullscreenWindow()
    expect(rect.width).toBeGreaterThan(0)
  })
})

describe('Phase 3 — createWindow + switchToWindow', () => {
  it('creates a new tab and switches to it', async () => {
    const before = await browser.getWindowHandles()
    const created = await browser.createWindow('tab')
    expect(created.type).toBe('tab')

    const after = await browser.getWindowHandles()
    expect(after.length).toBe(before.length + 1)
    expect(after).toContain(created.handle)

    await browser.switchToWindow(created.handle)
    expect(await browser.getWindowHandle()).toBe(created.handle)
  })

  it('echoes back the requested window type', async () => {
    const w = await browser.createWindow('window')
    expect(w.type).toBe('window')
    // Clean up so subsequent tests aren't dragged into the new window.
    await browser.switchToWindow(w.handle)
    await browser.closeWindow()
  })
})

describe('Phase 3 — executeScript element-reference args', () => {
  it('passes element refs as live DOM nodes to the script', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    const text = await browser.executeScript(
      'return arguments[0].textContent;',
      [ref],
    )
    expect(text).toBe('Hello P3')
  })

  it('can mutate the page via element-ref argument', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    await browser.executeScript(
      'arguments[0].textContent = "mutated"; return null;',
      [ref],
    )
    expect(await browser.getElementText(ref[ELEMENT_KEY]!)).toBe('mutated')
  })

  it('mixes element and primitive args', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    const result = await browser.executeScript(
      'return arguments[0].id + ":" + arguments[1];',
      [ref, 42],
    )
    expect(result).toBe('hello:42')
  })
})

describe('Phase 3 — executeScript element return values', () => {
  it('returning an Element gets a usable W3C reference back', async () => {
    const result = (await browser.executeScript(
      'return document.querySelector("#btn");',
      [],
    )) as { [k: string]: string }
    expect(result).toHaveProperty(ELEMENT_KEY)
    // The returned id should resolve like any other element reference.
    expect(await browser.getElementText(result[ELEMENT_KEY]!)).toBe('click me')
  })

  it('returning an array of Elements wraps each one', async () => {
    const result = (await browser.executeScript(
      'return Array.from(document.querySelectorAll("li"));',
      [],
    )) as Array<{ [k: string]: string }>
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty(ELEMENT_KEY)
    expect(await browser.getElementText(result[0]![ELEMENT_KEY]!)).toBe('one')
    expect(await browser.getElementText(result[1]![ELEMENT_KEY]!)).toBe('two')
  })

  it('returning a primitive passes through unchanged', async () => {
    expect(await browser.executeScript('return 42;', [])).toBe(42)
    expect(await browser.executeScript('return "hi";', [])).toBe('hi')
    expect(await browser.executeScript('return null;', [])).toBe(null)
    expect(await browser.executeScript('return [1,2,3];', [])).toEqual([1, 2, 3])
  })
})

describe('Phase 3 — executeAsyncScript', () => {
  it('resolves with the value passed to done()', async () => {
    const result = await browser.executeAsyncScript(
      'var done = arguments[arguments.length - 1]; setTimeout(function(){ done(7); }, 10);',
      [],
    )
    expect(result).toBe(7)
  })

  it('passes element-ref args alongside done()', async () => {
    const ref = await browser.findElement('css selector', '#hello')
    const result = await browser.executeAsyncScript(
      'var el = arguments[0]; var done = arguments[arguments.length - 1]; done(el.tagName);',
      [ref],
    )
    expect(result).toBe('H1')
  })
})
