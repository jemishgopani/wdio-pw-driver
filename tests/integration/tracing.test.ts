/**
 * Trace recording — both modes:
 *   A) capability-driven auto-trace (start at session create, dump at delete)
 *   B) explicit pwStartTrace() / pwStopTrace(path)
 *
 * Asserts the .zip file is actually written and is a real Playwright trace
 * (zip files start with "PK\003\004").
 */
import { existsSync, statSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import PWDriver from '../../src/index.js'

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  pwStartTrace(opts?: { name?: string; snapshots?: boolean; screenshots?: boolean; sources?: boolean }): Promise<null>
  pwStopTrace(path?: string): Promise<string | null>
  deleteSession(): Promise<null>
}

const HTML = `<!doctype html><html><head><title>Trace Demo</title></head>
<body><h1>tracing</h1><button id="b">click</button></body></html>`
const URL = `data:text/html,${encodeURIComponent(HTML)}`

function isPlaywrightTraceZip(path: string): boolean {
  // Playwright trace zips are valid ZIP files — header magic "PK\x03\x04".
  if (!existsSync(path) || statSync(path).size < 200) return false
  const head = readFileSync(path).subarray(0, 4)
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

describe('PW tracing — Option A (capability auto-trace)', () => {
  let tmpDir: string
  let browser: MinimalClient
  let expectedPath: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pw-trace-A-'))
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        ...({
          'wdio:pwOptions': { headless: true, trace: true, traceDir: tmpDir },
        } as Record<string, unknown>),
      },
    })) as MinimalClient
    expectedPath = join(tmpDir, `${browser.sessionId}.zip`)
  }, 30_000)

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs a few actions to populate the trace', async () => {
    await browser.navigateTo(URL)
    await browser.navigateTo('about:blank')
    await browser.navigateTo(URL)
  })

  it('deleteSession writes the trace zip to {traceDir}/{sessionId}.zip', async () => {
    await browser.deleteSession()
    expect(existsSync(expectedPath)).toBe(true)
    expect(isPlaywrightTraceZip(expectedPath)).toBe(true)
    expect(statSync(expectedPath).size).toBeGreaterThan(1000)
  })
})

describe('PW tracing — Option B (explicit start/stop)', () => {
  let tmpDir: string
  let browser: MinimalClient
  let zipPath: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pw-trace-B-'))
    browser = (await PWDriver.newSession({
      capabilities: {
        browserName: 'chromium',
        ...({ 'wdio:pwOptions': { headless: true } } as Record<string, unknown>),
      },
    })) as MinimalClient
    zipPath = join(tmpDir, 'explicit.zip')
  }, 30_000)

  afterAll(async () => {
    if (browser) await browser.deleteSession()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('pwStartTrace starts a fresh trace', async () => {
    const result = await browser.pwStartTrace()
    expect(result).toBeNull()
  })

  it('pwStartTrace twice in a row throws', async () => {
    await expect(browser.pwStartTrace()).rejects.toThrow(/already in progress/i)
  })

  it('exercises the page so the trace has content', async () => {
    await browser.navigateTo(URL)
    await browser.navigateTo('about:blank')
  })

  it('pwStopTrace(path) writes the zip and returns the absolute path', async () => {
    const written = await browser.pwStopTrace(zipPath)
    expect(written).toBe(zipPath)
    expect(existsSync(zipPath)).toBe(true)
    expect(isPlaywrightTraceZip(zipPath)).toBe(true)
  })

  it('pwStopTrace without an active trace throws', async () => {
    await expect(browser.pwStopTrace('/tmp/never.zip')).rejects.toThrow(/No trace is in progress/i)
  })

  it('pwStopTrace() with no path discards the trace', async () => {
    await browser.pwStartTrace()
    await browser.navigateTo(URL)
    const result = await browser.pwStopTrace()
    expect(result).toBeNull()
  })
})
