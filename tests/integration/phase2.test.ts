/**
 * Phase 2 — element coverage. Validates the new commands shipped in Phase 2:
 *   - findElementFromElement, findElementsFromElement (scoped find)
 *   - getElementShadowRoot, findElementFromShadowRoot, findElementsFromShadowRoot
 *   - getActiveElement
 *   - sticky stale-element detection
 *   - form interaction (clear + sendKeys)
 *   - checkbox/radio + select (isElementSelected)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY, SHADOW_ELEMENT_KEY } from '../../src/types.js'
import { StaleElementReferenceError, NoSuchElementError } from '../../src/errors.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  findElements(using: string, value: string): Promise<Array<{ [k: string]: string }>>
  findElementFromElement(parentId: string, using: string, value: string): Promise<{ [k: string]: string }>
  findElementsFromElement(parentId: string, using: string, value: string): Promise<Array<{ [k: string]: string }>>
  getElementShadowRoot(elementId: string): Promise<{ [k: string]: string }>
  findElementFromShadowRoot(shadowId: string, using: string, value: string): Promise<{ [k: string]: string }>
  findElementsFromShadowRoot(shadowId: string, using: string, value: string): Promise<Array<{ [k: string]: string }>>
  getActiveElement(): Promise<{ [k: string]: string }>
  elementClick(elementId: string): Promise<null>
  elementClear(elementId: string): Promise<null>
  elementSendKeys(elementId: string, text: string): Promise<null>
  getElementText(elementId: string): Promise<string>
  getElementAttribute(elementId: string, name: string): Promise<string | null>
  getElementProperty(elementId: string, name: string): Promise<unknown>
  isElementSelected(elementId: string): Promise<boolean>
  isElementEnabled(elementId: string): Promise<boolean>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  deleteSession(): Promise<null>
}

const HTML = `
  <!doctype html>
  <html>
    <head><title>Phase 2</title></head>
    <body>
      <form id="theform">
        <input id="name" type="text" value="initial" />
        <input id="cb" type="checkbox" checked />
        <input id="rad1" type="radio" name="r" value="a" />
        <input id="rad2" type="radio" name="r" value="b" checked />
        <select id="sel">
          <option value="x">x</option>
          <option value="y" selected>y</option>
        </select>
        <button id="submit" disabled>submit</button>
      </form>
      <ul id="list">
        <li class="item">a</li>
        <li class="item">b</li>
        <li class="item">c</li>
      </ul>
      <div id="parent">
        <span class="child">first</span>
        <span class="child">second</span>
      </div>
      <button id="remove-me" onclick="this.remove()">remove</button>
      <div id="host"></div>
      <script>
        // Open shadow root with two children for shadow-DOM tests.
        const host = document.getElementById('host');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<p class="inside">shadow text</p><span class="inside">also shadow</span>';
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
  // Re-load the fixture page between tests so DOM mutations from one test
  // don't leak into the next.
  await browser.navigateTo(URL)
})

describe('Phase 2 — scoped find', () => {
  it('findElementFromElement scopes to the parent', async () => {
    const parent = await browser.findElement('css selector', '#parent')
    const child = await browser.findElementFromElement(
      parent[ELEMENT_KEY]!,
      'css selector',
      '.child',
    )
    expect(await browser.getElementText(child[ELEMENT_KEY]!)).toBe('first')
  })

  it('findElementsFromElement returns only descendants', async () => {
    const parent = await browser.findElement('css selector', '#parent')
    const children = await browser.findElementsFromElement(
      parent[ELEMENT_KEY]!,
      'css selector',
      '.child',
    )
    expect(children).toHaveLength(2)
    // Should NOT include the .item siblings outside #parent.
    expect(await browser.getElementText(children[0]![ELEMENT_KEY]!)).toBe('first')
  })

  it('findElementFromElement returns the not-found body when miss', async () => {
    // Matches stock webdriver behavior: 404 'no such element' is delivered
    // as a SUCCESS response carrying `{error, message}`, not thrown — see
    // findOrNotFoundShape() in src/commands/element.ts.
    const parent = await browser.findElement('css selector', '#parent')
    const res = (await browser.findElementFromElement(
      parent[ELEMENT_KEY]!,
      'css selector',
      '.does-not-exist',
    )) as unknown as { error: string; message: string }
    expect(res.error).toBe('no such element')
    expect(typeof res.message).toBe('string')
  })
})

describe('Phase 2 — shadow root', () => {
  it('getElementShadowRoot returns a shadow reference', async () => {
    const host = await browser.findElement('css selector', '#host')
    const shadow = await browser.getElementShadowRoot(host[ELEMENT_KEY]!)
    expect(shadow).toHaveProperty(SHADOW_ELEMENT_KEY)
  })

  it('findElementFromShadowRoot reaches into the shadow tree', async () => {
    const host = await browser.findElement('css selector', '#host')
    const shadow = await browser.getElementShadowRoot(host[ELEMENT_KEY]!)
    const inner = await browser.findElementFromShadowRoot(
      shadow[SHADOW_ELEMENT_KEY]!,
      'css selector',
      'p.inside',
    )
    expect(await browser.getElementText(inner[ELEMENT_KEY]!)).toBe('shadow text')
  })

  it('findElementsFromShadowRoot returns multiple shadow descendants', async () => {
    const host = await browser.findElement('css selector', '#host')
    const shadow = await browser.getElementShadowRoot(host[ELEMENT_KEY]!)
    const all = await browser.findElementsFromShadowRoot(
      shadow[SHADOW_ELEMENT_KEY]!,
      'css selector',
      '.inside',
    )
    expect(all).toHaveLength(2)
  })

  it('getElementShadowRoot throws on a host with no shadow', async () => {
    const noShadow = await browser.findElement('css selector', '#parent')
    await expect(
      browser.getElementShadowRoot(noShadow[ELEMENT_KEY]!),
    ).rejects.toBeInstanceOf(NoSuchElementError)
  })
})

describe('Phase 2 — active element', () => {
  it('returns the focused element after focus()', async () => {
    await browser.executeScript('document.getElementById("name").focus(); return null;', [])
    const active = await browser.getActiveElement()
    const id = active[ELEMENT_KEY]!
    // The focused element should be the #name input — its value is "initial".
    expect(await browser.getElementProperty(id, 'value')).toBe('initial')
  })

  it('throws when only body is focused', async () => {
    await browser.executeScript('document.body.focus(); document.activeElement?.blur(); return null;', [])
    await expect(browser.getActiveElement()).rejects.toBeInstanceOf(NoSuchElementError)
  })
})

describe('Phase 2 — sticky stale element detection', () => {
  it('throws StaleElement when the node has been removed', async () => {
    const ref = await browser.findElement('css selector', '#remove-me')
    const id = ref[ELEMENT_KEY]!
    // Click triggers self-removal via onclick="this.remove()".
    await browser.elementClick(id)
    // Subsequent action on the same id should now report stale, not "no such".
    await expect(browser.getElementText(id)).rejects.toBeInstanceOf(StaleElementReferenceError)
  })

  it('isElementDisplayed returns false on detached, does NOT throw', async () => {
    const ref = await browser.findElement('css selector', '#remove-me')
    const id = ref[ELEMENT_KEY]!
    await browser.elementClick(id)
    // Per W3C, isDisplayed must not throw on a stale reference.
    // We use the underlying handler directly via an inline check; the
    // typed minimal client doesn't expose isElementDisplayed for brevity.
    const result = await (browser as unknown as { isElementDisplayed(id: string): Promise<boolean> }).isElementDisplayed(id)
    expect(result).toBe(false)
  })
})

describe('Phase 2 — forms', () => {
  it('clear + sendKeys replaces input value', async () => {
    const ref = await browser.findElement('css selector', '#name')
    const id = ref[ELEMENT_KEY]!
    expect(await browser.getElementProperty(id, 'value')).toBe('initial')
    await browser.elementClear(id)
    await browser.elementSendKeys(id, 'replaced')
    expect(await browser.getElementProperty(id, 'value')).toBe('replaced')
  })

  it('isElementSelected reports checkbox state', async () => {
    const cb = await browser.findElement('css selector', '#cb')
    expect(await browser.isElementSelected(cb[ELEMENT_KEY]!)).toBe(true)
    await browser.elementClick(cb[ELEMENT_KEY]!)
    expect(await browser.isElementSelected(cb[ELEMENT_KEY]!)).toBe(false)
  })

  it('isElementSelected reports radio state', async () => {
    const r1 = await browser.findElement('css selector', '#rad1')
    const r2 = await browser.findElement('css selector', '#rad2')
    expect(await browser.isElementSelected(r1[ELEMENT_KEY]!)).toBe(false)
    expect(await browser.isElementSelected(r2[ELEMENT_KEY]!)).toBe(true)
  })

  it('isElementSelected reports option state', async () => {
    const opts = await browser.findElements('css selector', '#sel option')
    expect(await browser.isElementSelected(opts[0]![ELEMENT_KEY]!)).toBe(false)
    expect(await browser.isElementSelected(opts[1]![ELEMENT_KEY]!)).toBe(true)
  })

  it('isElementEnabled reports disabled state', async () => {
    const submit = await browser.findElement('css selector', '#submit')
    expect(await browser.isElementEnabled(submit[ELEMENT_KEY]!)).toBe(false)
  })
})

describe('Phase 2 — multi-element queries', () => {
  it('findElements returns the right count', async () => {
    const items = await browser.findElements('css selector', '#list .item')
    expect(items).toHaveLength(3)
    expect(await browser.getElementText(items[2]![ELEMENT_KEY]!)).toBe('c')
  })
})
