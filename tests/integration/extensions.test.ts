/**
 * Tier B extensions — storage state, fresh context, network mocking.
 *
 * Each section is a self-contained describe so a flake in one doesn't
 * cascade. All tests run against a real headless Chromium plus a
 * data:URL or in-memory fake server.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'
import { ELEMENT_KEY } from '../../src/types.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  getUrl(): Promise<string>
  getTitle(): Promise<string>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  getElementText(elementId: string): Promise<string>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  pwSaveStorage(path: string): Promise<string>
  pwLoadStorage(): Promise<unknown>
  pwNewContext(overrides?: Record<string, unknown>): Promise<null>
  pwSwitchDevice(name: string | null): Promise<null>
  pwRoute(pattern: string, response: unknown): Promise<null>
  pwUnroute(pattern: string): Promise<null>
  deleteSession(): Promise<null>
}

const HTML = `<!doctype html><html><head><title>Ext Demo</title></head>
<body><h1 id="hi">hi</h1></body></html>`
const URL = `data:text/html,${encodeURIComponent(HTML)}`

/* -------------------------------------------------------------------------- */
/* Storage state                                                              */
/* -------------------------------------------------------------------------- */

describe('PW extension — storage state save/load', () => {
  let tmpDir: string
  let storagePath: string
  let firstBrowser: MinimalClient
  let secondBrowser: MinimalClient

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pw-storage-'))
    storagePath = join(tmpDir, 'auth.json')
  })

  afterAll(() => {
    if (firstBrowser) firstBrowser.deleteSession().catch(() => {})
    if (secondBrowser) secondBrowser.deleteSession().catch(() => {})
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('first session: navigates and writes storage state', async () => {
    firstBrowser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        'wdio:pwOptions': { headless: true },
      },
    })) as MinimalClient

    // Navigate to a same-origin URL so we can set localStorage.
    await firstBrowser.navigateTo('https://example.com')
    await firstBrowser.executeScript(
      'localStorage.setItem("pw-test-key", "saved-value"); return null;',
      [],
    )

    const written = await firstBrowser.pwSaveStorage(storagePath)
    expect(written).toBe(storagePath)
    expect(existsSync(storagePath)).toBe(true)

    const parsed = JSON.parse(readFileSync(storagePath, 'utf8'))
    expect(parsed).toHaveProperty('cookies')
    expect(parsed).toHaveProperty('origins')
    await firstBrowser.deleteSession()
  }, 60_000)

  it('second session: loads storage state via capability and reads value back', async () => {
    secondBrowser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        'wdio:pwOptions': { headless: true, storageState: storagePath },
      },
    })) as MinimalClient

    await secondBrowser.navigateTo('https://example.com')
    const value = await secondBrowser.executeScript(
      'return localStorage.getItem("pw-test-key");',
      [],
    )
    expect(value).toBe('saved-value')
  }, 60_000)

  it('pwLoadStorage mid-session throws with clear message', async () => {
    await expect(secondBrowser.pwLoadStorage())
      .rejects.toThrow(/cannot run mid-session/i)
  })
})

/* -------------------------------------------------------------------------- */
/* pwNewContext                                                           */
/* -------------------------------------------------------------------------- */

describe('PW extension — pwNewContext', () => {
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

  it('a route registered on the old context is gone after pwNewContext', async () => {
    await browser.pwRoute('**/iso-check', { status: 200, body: 'mocked-old' })
    await browser.navigateTo('about:blank')
    const before = await browser.executeScript(
      `return fetch("https://example.com/iso-check").then(r => r.text()).catch(e => String(e));`,
      [],
    )
    expect(before).toBe('mocked-old')

    await browser.pwNewContext()
    await browser.navigateTo('about:blank')
    const after = await browser.executeScript(
      `return fetch("https://example.com/iso-check").then(r => r.text()).catch(e => String(e));`,
      [],
    )
    expect(after).not.toBe('mocked-old')
  })

  it('current page is fresh (data: URL) and basic commands work after rotate', async () => {
    await browser.navigateTo(URL)
    expect(await browser.getTitle()).toBe('Ext Demo')
    const ref = await browser.findElement('css selector', '#hi')
    expect(await browser.getElementText(ref[ELEMENT_KEY]!)).toBe('hi')
  })

  it('pwNewContext({ device: "iPhone 13" }) switches to mobile UA mid-session', async () => {
    await browser.pwNewContext({ device: 'iPhone 13' })
    // Use a viewport-meta page so Chromium honors the mobile viewport (the
    // same Chromium quirk documented in pw-features.test.ts).
    const VP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>`
    await browser.navigateTo(`data:text/html,${encodeURIComponent(VP_HTML)}`)
    const ua = await browser.executeScript('return navigator.userAgent;', [])
    expect(String(ua)).toMatch(/iPhone|Mobile/i)
    const w = await browser.executeScript('return window.innerWidth;', [])
    expect(w).toBe(390)
  })

  it('override is sticky — plain pwNewContext() inherits the iPhone preset', async () => {
    await browser.pwNewContext()
    const VP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>`
    await browser.navigateTo(`data:text/html,${encodeURIComponent(VP_HTML)}`)
    const w = await browser.executeScript('return window.innerWidth;', [])
    expect(w).toBe(390) // still 390 — override persisted
  })

  it('pwSwitchDevice(null) clears the override; viewport returns to default', async () => {
    await browser.pwSwitchDevice(null)
    const VP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>`
    await browser.navigateTo(`data:text/html,${encodeURIComponent(VP_HTML)}`)
    const w = await browser.executeScript('return window.innerWidth;', [])
    expect(w).not.toBe(390)
  })

  it('pwSwitchDevice("Pixel 7") switches to a different mobile preset', async () => {
    await browser.pwSwitchDevice('Pixel 7')
    const VP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>`
    await browser.navigateTo(`data:text/html,${encodeURIComponent(VP_HTML)}`)
    const ua = await browser.executeScript('return navigator.userAgent;', [])
    // Pixel 7 reports an Android Chrome UA.
    expect(String(ua)).toMatch(/Android|Pixel|Linux/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Network mocking                                                            */
/* -------------------------------------------------------------------------- */

describe('PW extension — pwRoute network mocking', () => {
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

  it('fulfill: returns canned JSON for the matched pattern', async () => {
    await browser.pwRoute('**/api/users', {
      status: 200,
      body: { users: [{ id: 1, name: 'jemish' }] },
    })
    await browser.navigateTo('about:blank')
    const result = await browser.executeScript(
      `return fetch("https://example.com/api/users")
         .then(r => r.json())
         .catch(e => ({ error: String(e) }));`,
      [],
    )
    expect(result).toEqual({ users: [{ id: 1, name: 'jemish' }] })
  })

  it('fulfill: text body + custom content type', async () => {
    await browser.pwRoute('**/api/text', {
      status: 200,
      body: 'plain ok',
      contentType: 'text/plain',
    })
    const result = await browser.executeScript(
      `return fetch("https://example.com/api/text").then(r => r.text());`,
      [],
    )
    expect(result).toBe('plain ok')
  })

  it('abort: request fails with the named error code', async () => {
    await browser.pwRoute('**/blocked', { abort: 'failed' })
    const result = await browser.executeScript(
      `return fetch("https://example.com/blocked")
         .then(() => "ok")
         .catch(e => "blocked");`,
      [],
    )
    expect(result).toBe('blocked')
  })

  it('pwUnroute removes a registered mock', async () => {
    await browser.pwRoute('**/once', { status: 200, body: 'mocked' })
    const before = await browser.executeScript(
      `return fetch("https://example.com/once").then(r => r.text()).catch(e => 'err');`,
      [],
    )
    expect(before).toBe('mocked')

    await browser.pwUnroute('**/once')
    // After unroute, the mock is gone — fetch reaches the real network and
    // either succeeds or fails depending on network. We only assert it's
    // NOT the mocked body anymore.
    const after = await browser.executeScript(
      `return fetch("https://example.com/once").then(r => r.text()).catch(e => 'err');`,
      [],
    )
    expect(after).not.toBe('mocked')
  })
})
