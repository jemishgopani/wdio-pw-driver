/**
 * Phase 6 — cross-browser smoke. PW's `resolveEngine` accepts firefox
 * and webkit, but the integration suite only ever exercised chromium until
 * now. This file launches one PW session per non-Chromium engine,
 * navigates, and asserts the basic happy path works.
 *
 * Each test is auto-skipped if the browser binary isn't cached locally —
 * we don't want CI to fail noisily just because someone hasn't run
 * `wdioPW install all`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  getTitle(): Promise<string>
  getElementText(elementId: string): Promise<string>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  deleteSession(): Promise<null>
}

const HTML = `
  <!doctype html>
  <html>
    <head><title>Cross-browser smoke</title></head>
    <body><h1 id="hello">Hello from $ENGINE$</h1></body>
  </html>
`

function isInstalled(prefix: string): boolean {
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(root)) return false
  try {
    return readdirSync(root).some((d) => d.startsWith(prefix))
  } catch {
    return false
  }
}

function urlFor(engine: string): string {
  return `data:text/html,${encodeURIComponent(HTML.replace('$ENGINE$', engine))}`
}

async function smokeTest(engine: 'firefox' | 'webkit'): Promise<void> {
  const browser = (await PWDriver.newSession({
    capabilities: {
      browserName: engine,
      'wdio:pwOptions': { headless: true },
    },
  })) as MinimalClient

  try {
    await browser.navigateTo(urlFor(engine))
    expect(await browser.getTitle()).toBe('Cross-browser smoke')
    const ref = await browser.findElement('css selector', '#hello')
    const id = ref['element-6066-11e4-a52e-4f735466cecf']!
    expect(await browser.getElementText(id)).toBe(`Hello from ${engine}`)
  } finally {
    await browser.deleteSession()
  }
}

describe('Phase 6 — cross-browser smoke', () => {
  it.skipIf(!isInstalled('firefox-'))('firefox: navigates and reads element text', async () => {
    await smokeTest('firefox')
  }, 60_000)

  it.skipIf(!isInstalled('webkit-'))('webkit: navigates and reads element text', async () => {
    await smokeTest('webkit')
  }, 60_000)
})
