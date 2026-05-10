/**
 * Integration tests for the Tier C #11 BiDi expansion: script.*,
 * browsingContext.* (beyond getTree), and storage.*. These exercise the
 * commands directly off the WDIO client surface (since they're attached
 * via buildBidiPrototype) — same way WDIO-internal helpers like
 * `browser.addInitScript()` would call them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'

interface BidiClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  getUrl(): Promise<string>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  deleteSession(): Promise<null>

  scriptAddPreloadScript(params: { functionDeclaration: string }): Promise<{ script: string }>
  scriptRemovePreloadScript(params: { script: string }): Promise<null>
  scriptEvaluate(params: {
    expression: string
    target: { context: string }
    awaitPromise: boolean
  }): Promise<{ type: string; result: { type: string; value?: unknown }; realm: string }>
  scriptCallFunction(params: {
    functionDeclaration: string
    target: { context: string }
    awaitPromise: boolean
  }): Promise<{ type: string; result: { type: string; value?: unknown }; realm: string }>

  browsingContextActivate(params: { context: string }): Promise<null>
  browsingContextCreate(params: { type?: 'tab' | 'window' }): Promise<{ context: string }>
  browsingContextClose(params: { context: string }): Promise<null>
  browsingContextNavigate(params: {
    context: string
    url: string
    wait?: 'none' | 'interactive' | 'complete'
  }): Promise<{ navigation: string | null; url: string }>
  browsingContextReload(params: { context: string }): Promise<null>
  browsingContextTraverseHistory(params: { context: string; delta: number }): Promise<null>
  browsingContextSetViewport(params: {
    context?: string
    viewport?: { width: number; height: number } | null
  }): Promise<null>

  storageGetCookies(params: {
    filter?: { name?: string; domain?: string }
  }): Promise<{ cookies: Array<{ name: string; value: { value: string }; domain: string }> }>
  storageSetCookie(params: {
    cookie: {
      name: string
      value: string | { type: 'string'; value: string }
      domain: string
      path?: string
    }
  }): Promise<unknown>
  storageDeleteCookies(params: { filter?: { name?: string } }): Promise<unknown>
}

const HTML_PAGE_1 = `<!doctype html><html><head><title>Page One</title></head><body><h1 id="x">page-one</h1></body></html>`
const HTML_PAGE_2 = `<!doctype html><html><head><title>Page Two</title></head><body><h1 id="x">page-two</h1></body></html>`
const URL_1 = `data:text/html,${encodeURIComponent(HTML_PAGE_1)}`
const URL_2 = `data:text/html,${encodeURIComponent(HTML_PAGE_2)}`

/* -------------------------------------------------------------------------- */
/* script.*                                                                   */
/* -------------------------------------------------------------------------- */

describe('BiDi expansion — script.*', () => {
  let browser: BidiClient

  beforeAll(async () => {
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        webSocketUrl: true, // opt into BiDi mode so commands attach
        'wdio:pwOptions': { headless: true },
      },
    })) as BidiClient
  }, 30_000)

  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('addPreloadScript runs before page scripts on every navigation', async () => {
    const { script } = await browser.scriptAddPreloadScript({
      functionDeclaration: '() => { window.__preload_marker = "before-scripts" }',
    })
    expect(script).toMatch(/[a-f0-9-]{36}/)

    await browser.navigateTo(URL_1)
    const seen = await browser.executeScript('return window.__preload_marker;', [])
    expect(seen).toBe('before-scripts')
  })

  it('removePreloadScript accepts a known id', async () => {
    const { script } = await browser.scriptAddPreloadScript({
      functionDeclaration: '() => { window.__rm = 1 }',
    })
    await expect(browser.scriptRemovePreloadScript({ script })).resolves.toBeNull()
  })

  it('removePreloadScript throws on unknown id', async () => {
    await expect(
      browser.scriptRemovePreloadScript({ script: 'never-registered' })
    ).rejects.toThrow(/unknown script id/)
  })

  it('evaluate returns RemoteValue for primitive', async () => {
    const r = await browser.scriptEvaluate({
      expression: '40 + 2',
      target: { context: 'page-1' },
      awaitPromise: false,
    })
    expect(r.type).toBe('success')
    expect(r.result).toEqual({ type: 'number', value: 42 })
    expect(r.realm).toMatch(/[a-f0-9-]{36}:main/)
  })

  it('evaluate returns RemoteValue for object', async () => {
    const r = await browser.scriptEvaluate({
      expression: '({ a: 1, b: "two" })',
      target: { context: 'page-1' },
      awaitPromise: false,
    })
    expect(r.result.type).toBe('object')
  })

  it('evaluate awaits promise when awaitPromise=true', async () => {
    const r = await browser.scriptEvaluate({
      expression: 'Promise.resolve("done")',
      target: { context: 'page-1' },
      awaitPromise: true,
    })
    expect(r.result).toEqual({ type: 'string', value: 'done' })
  })

  it('callFunction invokes a no-arg function declaration', async () => {
    const r = await browser.scriptCallFunction({
      functionDeclaration: '() => 7 * 6',
      target: { context: 'page-1' },
      awaitPromise: false,
    })
    expect(r.result).toEqual({ type: 'number', value: 42 })
  })

  it('callFunction rejects `arguments` (not yet supported)', async () => {
    await expect(
      browser.scriptCallFunction({
        functionDeclaration: '(x) => x',
        target: { context: 'page-1' },
        awaitPromise: false,
        // @ts-expect-error — purposely testing rejection
        arguments: [{ type: 'number', value: 1 }],
      })
    ).rejects.toThrow(/arguments.*not supported/i)
  })
})

/* -------------------------------------------------------------------------- */
/* browsingContext.*                                                          */
/* -------------------------------------------------------------------------- */

describe('BiDi expansion — browsingContext.*', () => {
  let browser: BidiClient

  beforeAll(async () => {
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        webSocketUrl: true,
        'wdio:pwOptions': { headless: true },
      },
    })) as BidiClient
  }, 30_000)

  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('navigate then getUrl reflects the new URL', async () => {
    const r = await browser.browsingContextNavigate({
      context: 'page-1',
      url: URL_1,
      wait: 'complete',
    })
    expect(r.url).toContain('Page%20One')
    expect(await browser.getUrl()).toBe(r.url)
  })

  it('create opens a new tab and switches to it (foreground)', async () => {
    const { context: handle } = await browser.browsingContextCreate({ type: 'tab' })
    expect(handle).toMatch(/^page-\d+$/)
    expect(handle).not.toBe('page-1')
    await browser.browsingContextNavigate({ context: handle, url: URL_2, wait: 'complete' })
    expect(await browser.getUrl()).toContain('Page%20Two')
  })

  it('activate switches the current page back to page-1', async () => {
    await browser.browsingContextActivate({ context: 'page-1' })
    expect(await browser.getUrl()).toContain('Page%20One')
  })

  it('close removes the new tab and falls back to page-1', async () => {
    const { context: handle } = await browser.browsingContextCreate({ type: 'tab' })
    await browser.browsingContextNavigate({ context: handle, url: URL_2, wait: 'complete' })
    await browser.browsingContextClose({ context: handle })
    // The closed handle is unknown again.
    await expect(
      browser.browsingContextNavigate({ context: handle, url: URL_2, wait: 'complete' })
    ).rejects.toThrow(/No browsing context/i)
  })

  it('reload re-runs page', async () => {
    await browser.browsingContextNavigate({ context: 'page-1', url: URL_1, wait: 'complete' })
    await expect(browser.browsingContextReload({ context: 'page-1' })).resolves.toBeNull()
  })

  it('traverseHistory(-1) goes back', async () => {
    await browser.browsingContextNavigate({ context: 'page-1', url: URL_1, wait: 'complete' })
    await browser.browsingContextNavigate({ context: 'page-1', url: URL_2, wait: 'complete' })
    expect(await browser.getUrl()).toContain('Page%20Two')
    await browser.browsingContextTraverseHistory({ context: 'page-1', delta: -1 })
    expect(await browser.getUrl()).toContain('Page%20One')
  })

  it('setViewport updates window.innerWidth', async () => {
    await browser.browsingContextSetViewport({
      context: 'page-1',
      viewport: { width: 800, height: 600 },
    })
    const w = await browser.executeScript('return window.innerWidth;', [])
    expect(w).toBe(800)
  })
})

/* -------------------------------------------------------------------------- */
/* storage.*                                                                  */
/* -------------------------------------------------------------------------- */

describe('BiDi expansion — storage.*', () => {
  let browser: BidiClient

  beforeAll(async () => {
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        webSocketUrl: true,
        'wdio:pwOptions': { headless: true },
      },
    })) as BidiClient
  }, 30_000)

  afterAll(async () => { if (browser) await browser.deleteSession() })

  it('setCookie + getCookies round-trips a cookie', async () => {
    await browser.storageSetCookie({
      cookie: {
        name: 'bidi_test',
        value: 'set-by-bidi',
        domain: 'example.com',
        path: '/',
      },
    })
    const r = await browser.storageGetCookies({ filter: { name: 'bidi_test' } })
    expect(r.cookies).toHaveLength(1)
    expect(r.cookies[0].name).toBe('bidi_test')
    expect(r.cookies[0].value).toEqual({ type: 'string', value: 'set-by-bidi' })
    expect(r.cookies[0].domain).toBe('example.com')
  })

  it('setCookie accepts BiDi-shaped value envelope', async () => {
    await browser.storageSetCookie({
      cookie: {
        name: 'bidi_envelope',
        value: { type: 'string', value: 'enveloped' },
        domain: 'example.com',
      },
    })
    const r = await browser.storageGetCookies({ filter: { name: 'bidi_envelope' } })
    expect(r.cookies[0].value.value).toBe('enveloped')
  })

  it('deleteCookies(filter.name) removes only the matched cookie', async () => {
    await browser.storageDeleteCookies({ filter: { name: 'bidi_envelope' } })
    const r = await browser.storageGetCookies({ filter: { name: 'bidi_envelope' } })
    expect(r.cookies).toHaveLength(0)
    // The other cookie still exists.
    const r2 = await browser.storageGetCookies({ filter: { name: 'bidi_test' } })
    expect(r2.cookies).toHaveLength(1)
  })

  it('deleteCookies() with no filter clears everything', async () => {
    await browser.storageDeleteCookies({})
    const r = await browser.storageGetCookies({})
    expect(r.cookies).toHaveLength(0)
  })
})
