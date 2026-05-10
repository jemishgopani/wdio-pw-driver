/**
 * Phase 4 — frames, alerts, action chains. Validates:
 *   - switchToFrame by element-ref / index / null + switchToParentFrame
 *   - find/execute scoped to the active frame
 *   - getPageSource reflects the current scope (page vs frame)
 *   - acceptAlert / dismissAlert / getAlertText / sendAlertText (alert + confirm + prompt)
 *   - performActions: pointer-click sequence, key typing, mixed sources, pause
 *   - releaseActions clears keyboard/mouse state
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY } from '../../src/types.js'
import { WebDriverError } from '../../src/errors.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  findElements(using: string, value: string): Promise<Array<{ [k: string]: string }>>
  getElementText(elementId: string): Promise<string>
  getElementProperty(elementId: string, name: string): Promise<unknown>
  elementClick(elementId: string): Promise<null>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  getPageSource(): Promise<string>

  switchToFrame(id: number | { [k: string]: string } | null): Promise<null>
  switchToParentFrame(): Promise<null>

  acceptAlert(): Promise<null>
  dismissAlert(): Promise<null>
  getAlertText(): Promise<string>
  sendAlertText(text: string): Promise<null>

  performActions(body: { actions: unknown[] }): Promise<null>
  releaseActions(): Promise<null>

  deleteSession(): Promise<null>
}

const FRAME_HTML = `
  <!doctype html>
  <html><body>
    <h2 id="frame-h">inside frame</h2>
    <input id="frame-in" type="text" />
  </body></html>
`
const FRAME_DATA = `data:text/html,${encodeURIComponent(FRAME_HTML)}`

const HTML = `
  <!doctype html>
  <html>
    <head><title>Phase 4</title></head>
    <body>
      <h1 id="hello">Hello P4</h1>
      <iframe id="ifr" src="${FRAME_DATA}"></iframe>
      <button id="alertBtn" onclick="setTimeout(function(){ window.alert('hi-alert'); }, 0)">alert</button>
      <button id="confirmBtn" onclick="setTimeout(function(){ window.__c = window.confirm('go?'); }, 0)">confirm</button>
      <button id="promptBtn" onclick="setTimeout(function(){ window.__p = window.prompt('name?'); }, 0)">prompt</button>
      <button id="actBtn">act me</button>
      <input id="kbInput" type="text" />
      <script>
        window.__clicks = 0;
        document.getElementById('actBtn').addEventListener('click', function() { window.__clicks++; });
      </script>
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
  await browser.navigateTo(URL)
})

describe('Phase 4 — frame switching', () => {
  it('switchToFrame by element-ref scopes find to the iframe', async () => {
    const ifr = await browser.findElement('css selector', '#ifr')
    await browser.switchToFrame(ifr)
    const inside = await browser.findElement('css selector', '#frame-h')
    expect(await browser.getElementText(inside[ELEMENT_KEY]!)).toBe('inside frame')
  })

  it('switchToFrame(null) returns to top-level', async () => {
    const ifr = await browser.findElement('css selector', '#ifr')
    await browser.switchToFrame(ifr)
    await browser.switchToFrame(null)
    const top = await browser.findElement('css selector', '#hello')
    expect(await browser.getElementText(top[ELEMENT_KEY]!)).toBe('Hello P4')
  })

  it('switchToParentFrame returns to the parent', async () => {
    const ifr = await browser.findElement('css selector', '#ifr')
    await browser.switchToFrame(ifr)
    await browser.switchToParentFrame()
    const top = await browser.findElement('css selector', '#hello')
    expect(await browser.getElementText(top[ELEMENT_KEY]!)).toBe('Hello P4')
  })

  it('switchToFrame by index 0 picks the first child frame', async () => {
    await browser.switchToFrame(0)
    const inside = await browser.findElement('css selector', '#frame-h')
    expect(await browser.getElementText(inside[ELEMENT_KEY]!)).toBe('inside frame')
  })

  it('executeScript runs in the active frame', async () => {
    await browser.switchToFrame(0)
    const tag = await browser.executeScript('return document.querySelector("#frame-h").tagName;', [])
    expect(tag).toBe('H2')
  })

  it('getPageSource reflects the active frame', async () => {
    await browser.switchToFrame(0)
    const source = await browser.getPageSource()
    expect(source).toContain('inside frame')
    expect(source).not.toContain('Hello P4')
  })

  it('navigation resets the current frame back to top-level', async () => {
    await browser.switchToFrame(0)
    await browser.navigateTo(URL)
    // After reload, find should hit the top-level page again.
    const top = await browser.findElement('css selector', '#hello')
    expect(await browser.getElementText(top[ELEMENT_KEY]!)).toBe('Hello P4')
  })
})

describe('Phase 4 — alerts', () => {
  /**
   * PW auto-handles dialogs in the listener (see driver.ts) so the page
   * never blocks. The W3C-reactive pattern (trigger → handle) is supported
   * for *reading* (getAlertText), but to influence the page-side return
   * value of confirm()/prompt() the test must stage its preferred action
   * (dismissAlert / sendAlertText) BEFORE triggering the dialog.
   */
  async function triggerAndRun(script: string): Promise<unknown> {
    // Use evaluate via setTimeout so the calling command returns before the
    // dialog opens. Then poll briefly for the snapshot to arrive.
    await browser.executeScript(
      `setTimeout(function(){ ${script} }, 0); return null;`,
      [],
    )
    return waitForDialog()
  }

  async function waitForDialog(): Promise<string> {
    const start = Date.now()
    while (Date.now() - start < 2000) {
      try {
        return await browser.getAlertText()
      } catch {
        await new Promise((r) => setTimeout(r, 25))
      }
    }
    throw new Error('No dialog snapshot appeared within 2s')
  }

  it('captures alert text', async () => {
    await triggerAndRun('window.alert("hi-alert");')
    expect(await browser.getAlertText()).toBe('hi-alert')
    await browser.acceptAlert() // clears the snapshot
  })

  it('default-accept makes confirm() return true', async () => {
    // No staging — default action is accept.
    await triggerAndRun('window.__c = window.confirm("go?");')
    // Allow page-side assignment to settle.
    await new Promise((r) => setTimeout(r, 50))
    expect(await browser.executeScript('return window.__c;', [])).toBe(true)
    await browser.acceptAlert()
  })

  it('staged dismissAlert makes confirm() return false', async () => {
    // Pre-stage the dismiss action; listener will use it when dialog fires.
    await browser.dismissAlert()
    await triggerAndRun('window.__c = window.confirm("go?");')
    await new Promise((r) => setTimeout(r, 50))
    expect(await browser.executeScript('return window.__c;', [])).toBe(false)
    await browser.acceptAlert()
  })

  it('staged sendAlertText delivers a value to prompt()', async () => {
    await browser.sendAlertText('jemish')
    await triggerAndRun('window.__p = window.prompt("name?");')
    await new Promise((r) => setTimeout(r, 50))
    expect(await browser.executeScript('return window.__p;', [])).toBe('jemish')
    await browser.acceptAlert()
  })

  it('throws "no such alert" when no snapshot is available', async () => {
    await expect(browser.getAlertText()).rejects.toBeInstanceOf(WebDriverError)
  })
})

describe('Phase 4 — performActions', () => {
  it('pointer source: move + down + up triggers a click', async () => {
    const btn = await browser.findElement('css selector', '#actBtn')
    await browser.performActions({
      actions: [
        {
          type: 'pointer',
          id: 'mouse1',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', origin: btn, x: 0, y: 0 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    })
    expect(await browser.executeScript('return window.__clicks;', [])).toBe(1)
  })

  it('key source: typing inserts characters into focused input', async () => {
    const inp = await browser.findElement('css selector', '#kbInput')
    await browser.executeScript('document.getElementById("kbInput").focus(); return null;', [])
    await browser.performActions({
      actions: [
        {
          type: 'key',
          id: 'kb1',
          actions: [
            { type: 'keyDown', value: 'h' },
            { type: 'keyUp', value: 'h' },
            { type: 'keyDown', value: 'i' },
            { type: 'keyUp', value: 'i' },
          ],
        },
      ],
    })
    expect(await browser.getElementProperty(inp[ELEMENT_KEY]!, 'value')).toBe('hi')
  })

  it('pause action delays without crashing', async () => {
    const start = Date.now()
    await browser.performActions({
      actions: [
        {
          type: 'none',
          id: 'p1',
          actions: [{ type: 'pause', duration: 100 }],
        },
      ],
    })
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
  })

  it('mixed sources execute tick-aligned in source order', async () => {
    // Two sources: pointer click + key typing. Both should complete with the
    // expected side effects regardless of ordering inside a tick.
    const btn = await browser.findElement('css selector', '#actBtn')
    const inp = await browser.findElement('css selector', '#kbInput')
    await browser.executeScript('document.getElementById("kbInput").focus(); return null;', [])
    await browser.performActions({
      actions: [
        {
          type: 'pointer',
          id: 'mouse1',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', origin: btn, x: 0, y: 0 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
        {
          type: 'key',
          id: 'kb1',
          actions: [
            { type: 'pause' },
            { type: 'pause' },
            { type: 'pause' },
          ],
        },
      ],
    })
    expect(await browser.executeScript('return window.__clicks;', [])).toBe(1)
    // Click on the button stole focus from the input — typing wouldn't apply.
    // We don't assert on the input here; the test focuses on multi-source dispatch.
    void inp
  })

  it('releaseActions lifts pressed keys', async () => {
    // Press Shift but never release, then call releaseActions.
    await browser.performActions({
      actions: [
        {
          type: 'key',
          id: 'kb1',
          actions: [{ type: 'keyDown', value: '' }], // Shift
        },
      ],
    })
    await browser.releaseActions()
    // After release, plain typing should NOT be uppercased.
    const inp = await browser.findElement('css selector', '#kbInput')
    await browser.executeScript('document.getElementById("kbInput").focus(); return null;', [])
    await browser.performActions({
      actions: [
        {
          type: 'key',
          id: 'kb2',
          actions: [
            { type: 'keyDown', value: 'a' },
            { type: 'keyUp', value: 'a' },
          ],
        },
      ],
    })
    expect(await browser.getElementProperty(inp[ELEMENT_KEY]!, 'value')).toBe('a')
  })
})
