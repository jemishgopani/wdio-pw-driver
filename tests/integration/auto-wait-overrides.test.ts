/**
 * Coverage for the auto-wait command-override pass (2026-05-15):
 *
 *   Protocol-level commands consumed by PWService:
 *     - pwWaitElementFor — wraps locator.waitFor({state})
 *     - pwClickElement   — option-accepting click
 *
 *   PWService.before() override wiring:
 *     - overwriteCommand called for click + waitForExist + waitForDisplayed
 *     - strictActionability=false skips overrides
 *
 * The integration tests below exercise the protocol commands against a
 * real headless Chromium. The mock-browser tests at the bottom verify
 * PWService.before() calls overwriteCommand with the right names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import PWService from '../../src/service.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface Client {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  pwClickElement(elementId: string, opts: Record<string, unknown>): Promise<null>
  pwWaitElementFor(elementId: string, opts: { state?: string; timeout?: number }): Promise<null>
  deleteSession(): Promise<null>
}

async function newBrowser(): Promise<Client> {
  return (await PWDriver.newSession({
    capabilities: {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true, timeout: 5000 },
    },
  })) as Client
}

/* -------------------------------------------------------------------------- */
/* pwWaitElementFor                                                            */
/* -------------------------------------------------------------------------- */

describe('pwWaitElementFor — protocol command', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('waits for an element to become visible', async () => {
    await browser.navigateTo(
      `data:text/html,${encodeURIComponent(
        '<body><div id="t" style="display:none">hi</div>' +
          '<script>setTimeout(() => document.getElementById("t").style.display = "", 200)</script></body>',
      )}`,
    )
    const ref = await browser.findElement('css selector', '#t')
    const t0 = Date.now()
    await browser.pwWaitElementFor(ref[ELEMENT_KEY]!, { state: 'visible', timeout: 3000 })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(150)
    expect(elapsed).toBeLessThan(2500)
  })

  it('waits for an element to become hidden (reverse)', async () => {
    await browser.navigateTo(
      `data:text/html,${encodeURIComponent(
        '<body><div id="t">hi</div>' +
          '<script>setTimeout(() => document.getElementById("t").style.display = "none", 200)</script></body>',
      )}`,
    )
    const ref = await browser.findElement('css selector', '#t')
    await browser.pwWaitElementFor(ref[ELEMENT_KEY]!, { state: 'hidden', timeout: 3000 })
  })

  it('throws no-such-element on timeout', async () => {
    await browser.navigateTo('data:text/html,<body><div id="t" style="display:none">x</div></body>')
    const ref = await browser.findElement('css selector', '#t')
    let caught: { name?: string } | null = null
    try {
      await browser.pwWaitElementFor(ref[ELEMENT_KEY]!, { state: 'visible', timeout: 500 })
    } catch (err) {
      caught = err as { name?: string }
    }
    expect(caught?.name).toBe('no such element')
  })
})

/* -------------------------------------------------------------------------- */
/* pwClickElement                                                              */
/* -------------------------------------------------------------------------- */

describe('pwClickElement — option-accepting click', () => {
  let browser: Client
  beforeAll(async () => { browser = await newBrowser() }, 30_000)
  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('respects { force: true } to bypass actionability', async () => {
    // opacity:0 makes Playwright's visibility check fail (so an unforced
    // click throws "element is not visible"), but the browser still
    // dispatches the click event normally — so we can prove force took
    // effect by observing the onclick handler ran.
    await browser.navigateTo(
      'data:text/html,<body><button id="b" style="opacity:0" onclick="document.title=\'clicked\'">x</button></body>',
    )
    const ref = await browser.findElement('css selector', '#b')
    await browser.pwClickElement(ref[ELEMENT_KEY]!, { force: true })
    const title = await browser.executeScript('return document.title', [])
    expect(title).toBe('clicked')
  })

  it('respects { position } to click at a specific offset', async () => {
    await browser.navigateTo(
      'data:text/html,' +
        encodeURIComponent(
          '<body><button id="b" style="width:200px;height:60px"' +
            ' onclick="window.__pos=event.offsetX+\',\'+event.offsetY">x</button></body>',
        ),
    )
    const ref = await browser.findElement('css selector', '#b')
    await browser.pwClickElement(ref[ELEMENT_KEY]!, { position: { x: 10, y: 20 } })
    const pos = await browser.executeScript('return window.__pos', [])
    expect(pos).toBe('10,20')
  })

  it('still special-cases <option> when force=false', async () => {
    await browser.navigateTo(
      'data:text/html,' +
        encodeURIComponent(
          '<body><select id="s">' +
            '<option value="a">A</option>' +
            '<option value="b">B</option>' +
            '</select></body>',
        ),
    )
    const opt = await browser.findElement('xpath', '//option[@value="b"]')
    await browser.pwClickElement(opt[ELEMENT_KEY]!, {})
    const sel = await browser.findElement('css selector', '#s')
    const value = await browser.executeScript(
      'return document.getElementById("s").value',
      [],
    )
    expect(value).toBe('b')
    void sel
  })
})

/* -------------------------------------------------------------------------- */
/* PWService.before wiring                                                    */
/* -------------------------------------------------------------------------- */

interface MockBrowser {
  overwritten: Array<{ name: string; attachToElement: boolean }>
  overwriteCommand(name: string, _fn: unknown, attachToElement?: boolean): void
}

function mockBrowser(): MockBrowser {
  const b: MockBrowser = {
    overwritten: [],
    overwriteCommand(name, _fn, attachToElement = false) {
      this.overwritten.push({ name, attachToElement })
    },
  }
  return b
}

describe('PWService.before() — command overrides', () => {
  it('overwrites click, waitForExist, waitForDisplayed by default', async () => {
    const service = new PWService()
    const browser = mockBrowser()
    await service.before({ browserName: 'chromium' } as never, [], browser as never)
    const names = browser.overwritten.map((o) => o.name)
    expect(names).toContain('click')
    expect(names).toContain('waitForExist')
    expect(names).toContain('waitForDisplayed')
    // All three should attach to the element prototype (not just browser)
    for (const o of browser.overwritten) {
      expect(o.attachToElement).toBe(true)
    }
  })

  it('skips overrides when wdio:pwOptions.strictActionability === false', async () => {
    const service = new PWService()
    const browser = mockBrowser()
    await service.before(
      {
        browserName: 'chromium',
        'wdio:pwOptions': { strictActionability: false },
      } as never,
      [],
      browser as never,
    )
    expect(browser.overwritten).toEqual([])
  })
})
