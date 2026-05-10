/**
 * Phase 5 — BiDi events. Validates that Playwright's in-process events are
 * translated to W3C BiDi shapes and emitted on the WDIO client, gated by
 * sessionSubscribe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { EventEmitter } from 'node:events'

import PWDriver from '../../src/index.js'

interface MinimalClient extends EventEmitter {
  sessionId: string
  isBidi: boolean
  navigateTo(url: string): Promise<null>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  sessionSubscribe(body: { events: string[] }): Promise<null>
  sessionUnsubscribe(body: { events: string[] }): Promise<null>
  deleteSession(): Promise<null>
}

const HTML = `
  <!doctype html>
  <html>
    <head><title>Phase 5</title></head>
    <body>
      <h1>BiDi</h1>
      <script>
        console.log('hello world')
        console.warn('careful')
        console.error('uh oh')
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
      // BiDi is opt-in; default is off so WDIO's auto-installed ContextManager
      // doesn't try to call BiDi commands PW hasn't implemented.
      webSocketUrl: true,
      'wdio:pwOptions': { headless: true },
    },
  })) as MinimalClient
}, 30_000)

afterAll(async () => {
  if (browser) await browser.deleteSession()
})

beforeEach(async () => {
  // Clear any subscriptions left over from a prior test.
  await browser.sessionUnsubscribe({
    events: [
      'log.entryAdded',
      'network.beforeRequestSent',
      'network.responseStarted',
      'browsingContext.navigationStarted',
      'browsingContext.load',
      'browsingContext.domContentLoaded',
      'browsingContext.userPromptOpened',
    ],
  })
  browser.removeAllListeners('log.entryAdded')
  browser.removeAllListeners('network.beforeRequestSent')
  browser.removeAllListeners('network.responseStarted')
  browser.removeAllListeners('browsingContext.navigationStarted')
  browser.removeAllListeners('browsingContext.load')
  browser.removeAllListeners('browsingContext.domContentLoaded')
  browser.removeAllListeners('browsingContext.userPromptOpened')
})

describe('Phase 5 — environment', () => {
  it('isBidi reports true by default', () => {
    expect(browser.isBidi).toBe(true)
  })
})

describe('Phase 5 — log.entryAdded', () => {
  it('captures console.log/warn/error from the page', async () => {
    interface LogEntry {
      type: string
      level: string
      text: string
      method: string
    }
    const entries: LogEntry[] = []
    browser.on('log.entryAdded', (e: LogEntry) => entries.push(e))

    await browser.sessionSubscribe({ events: ['log.entryAdded'] })
    await browser.navigateTo(URL)
    // Wait for the script to run + events to propagate.
    await new Promise((r) => setTimeout(r, 100))

    const texts = entries.map((e) => e.text)
    expect(texts).toContain('hello world')
    expect(texts).toContain('careful')
    expect(texts).toContain('uh oh')

    const helloEntry = entries.find((e) => e.text === 'hello world')!
    expect(helloEntry.type).toBe('console')
    expect(helloEntry.level).toBe('info')
    expect(helloEntry.method).toBe('log')

    const warnEntry = entries.find((e) => e.text === 'careful')!
    expect(warnEntry.level).toBe('warn')

    const errorEntry = entries.find((e) => e.text === 'uh oh')!
    expect(errorEntry.level).toBe('error')
  })

  it('captures uncaught page errors as type=javascript', async () => {
    interface LogEntry {
      type: string
      level: string
      text: string
    }
    const entries: LogEntry[] = []
    browser.on('log.entryAdded', (e: LogEntry) => entries.push(e))
    await browser.sessionSubscribe({ events: ['log.entryAdded'] })

    const ERROR_HTML = `
      <!doctype html>
      <html><body><script>throw new Error('boom')</script></body></html>
    `
    await browser.navigateTo(`data:text/html,${encodeURIComponent(ERROR_HTML)}`)
    await new Promise((r) => setTimeout(r, 100))

    const jsErrors = entries.filter((e) => e.type === 'javascript')
    expect(jsErrors.length).toBeGreaterThan(0)
    expect(jsErrors[0]!.level).toBe('error')
    expect(jsErrors[0]!.text).toContain('boom')
  })
})

describe('Phase 5 — network events', () => {
  it('emits network.beforeRequestSent for fetched resources', async () => {
    interface ReqEvent {
      request: { url: string; method: string }
    }
    const requests: ReqEvent[] = []
    browser.on('network.beforeRequestSent', (e: ReqEvent) => requests.push(e))

    await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] })
    await browser.navigateTo(URL)
    // Trigger a fire-and-forget fetch from page context. The request URL
    // doesn't need to be reachable — we only care that the request event
    // fires. .catch(()=>{}) prevents an unhandled-rejection at the page level.
    await browser.executeScript(
      'fetch("https://127.0.0.1:1/pw-test", { mode: "no-cors" }).catch(function(){}); return null;',
      [],
    )
    // Give the request event time to propagate (well below test timeout).
    await new Promise((r) => setTimeout(r, 500))

    const fired = requests.find((r) => r.request.url.includes('pw-test'))
    expect(fired).toBeDefined()
    expect(fired!.request.method).toBe('GET')
  })

  it('module-level subscription "network" enables both events', async () => {
    interface AnyEvent { request?: unknown }
    const events: AnyEvent[] = []
    browser.on('network.beforeRequestSent', (e: AnyEvent) => events.push(e))
    browser.on('network.responseStarted', (e: AnyEvent) => events.push(e))

    await browser.sessionSubscribe({ events: ['network'] })
    await browser.navigateTo(URL)
    await browser.executeScript(
      'fetch("https://127.0.0.1:1/pw-test", { mode: "no-cors" }).catch(function(){}); return null;',
      [],
    )
    await new Promise((r) => setTimeout(r, 500))

    expect(events.length).toBeGreaterThan(0)
  })
})

describe('Phase 5 — browsingContext events', () => {
  it('emits browsingContext.load on navigation', async () => {
    interface LoadEvent { url: string }
    const loads: LoadEvent[] = []
    browser.on('browsingContext.load', (e: LoadEvent) => loads.push(e))

    await browser.sessionSubscribe({ events: ['browsingContext.load'] })
    await browser.navigateTo(URL)
    await new Promise((r) => setTimeout(r, 100))

    expect(loads.length).toBeGreaterThan(0)
    expect(loads[loads.length - 1]!.url).toContain('data:text/html')
  })

  it('emits browsingContext.userPromptOpened when a dialog fires', async () => {
    interface PromptEvent { type: string; message: string }
    const prompts: PromptEvent[] = []
    browser.on('browsingContext.userPromptOpened', (e: PromptEvent) => prompts.push(e))

    await browser.sessionSubscribe({ events: ['browsingContext.userPromptOpened'] })
    await browser.navigateTo(URL)
    await browser.executeScript('setTimeout(function(){ window.alert("from bidi"); }, 0); return null;', [])
    await new Promise((r) => setTimeout(r, 200))

    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0]!.type).toBe('alert')
    expect(prompts[0]!.message).toBe('from bidi')
  })
})

describe('Phase 5 — subscription gating', () => {
  it('does NOT emit events that have not been subscribed', async () => {
    let count = 0
    browser.on('log.entryAdded', () => count++)
    // Note: NO sessionSubscribe call here.
    await browser.navigateTo(URL)
    await new Promise((r) => setTimeout(r, 100))
    expect(count).toBe(0)
  })

  it('sessionUnsubscribe stops further events from being emitted', async () => {
    let count = 0
    browser.on('log.entryAdded', () => count++)
    await browser.sessionSubscribe({ events: ['log.entryAdded'] })
    await browser.navigateTo(URL)
    await new Promise((r) => setTimeout(r, 100))
    const beforeUnsub = count
    expect(beforeUnsub).toBeGreaterThan(0)

    await browser.sessionUnsubscribe({ events: ['log.entryAdded'] })
    await browser.executeScript('console.log("after unsubscribe"); return null;', [])
    await new Promise((r) => setTimeout(r, 100))
    expect(count).toBe(beforeUnsub)
  })
})
