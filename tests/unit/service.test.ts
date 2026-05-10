/**
 * Unit tests for PWService — the WDIO launcher service that injects
 * Playwright's binary path into capabilities. We exercise the onPrepare
 * hook directly rather than via WDIO's runner so the test stays in-process.
 */
import { describe, expect, it } from 'vitest'

import PWService from '../../src/service.js'

const FAKE_CONFIG = {}

describe('PWService.onPrepare', () => {
  it('injects chromium binary into a single-cap config', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = { browserName: 'chromium' }
    await svc.onPrepare(FAKE_CONFIG, caps)

    expect(caps['wdio:pwOptions']).toMatchObject({
      executablePath: expect.stringMatching(/chromium-.*chrome|Chrome for Testing/i),
    })
    expect(caps['goog:chromeOptions']).toMatchObject({ binary: expect.any(String) })
  })

  it('injects firefox binary using moz:firefoxOptions', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = { browserName: 'firefox' }
    await svc.onPrepare(FAKE_CONFIG, caps)

    expect(caps['wdio:pwOptions']).toMatchObject({
      executablePath: expect.stringMatching(/firefox/i),
    })
    expect(caps['moz:firefoxOptions']).toMatchObject({ binary: expect.any(String) })
  })

  it('handles webkit (no vendor binary cap, just wdio:pwOptions)', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = { browserName: 'webkit' }
    await svc.onPrepare(FAKE_CONFIG, caps)

    expect(caps['wdio:pwOptions']).toMatchObject({
      executablePath: expect.stringMatching(/webkit|pw_run/i),
    })
    expect(caps['goog:chromeOptions']).toBeUndefined()
    expect(caps['moz:firefoxOptions']).toBeUndefined()
  })

  it('preserves caller-set binary instead of overwriting', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = {
      browserName: 'chromium',
      'goog:chromeOptions': { binary: '/custom/chrome' },
    }
    await svc.onPrepare(FAKE_CONFIG, caps)

    expect(caps['goog:chromeOptions']).toEqual({ binary: '/custom/chrome' })
    // wdio:pwOptions stays untouched too — service treats vendor binary
    // as full configuration intent.
    expect(caps['wdio:pwOptions']).toBeUndefined()
  })

  it('preserves caller-set wdio:pwOptions.executablePath', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = {
      browserName: 'chromium',
      'wdio:pwOptions': { executablePath: '/custom/path' },
    }
    await svc.onPrepare(FAKE_CONFIG, caps)
    expect((caps['wdio:pwOptions'] as { executablePath: string }).executablePath).toBe('/custom/path')
  })

  it('processes a parallel-array of capabilities', async () => {
    const svc = new PWService()
    const caps: Array<Record<string, unknown>> = [
      { browserName: 'chromium' },
      { browserName: 'firefox' },
    ]
    await svc.onPrepare(FAKE_CONFIG, caps)
    expect((caps[0]['wdio:pwOptions'] as { executablePath?: string }).executablePath).toBeTruthy()
    expect((caps[1]['wdio:pwOptions'] as { executablePath?: string }).executablePath).toBeTruthy()
  })

  it('processes a multiremote-shaped capabilities map', async () => {
    const svc = new PWService()
    const caps: Record<string, { capabilities: Record<string, unknown> }> = {
      browserA: { capabilities: { browserName: 'chromium' } },
      browserB: { capabilities: { browserName: 'firefox' } },
    }
    await svc.onPrepare(FAKE_CONFIG, caps)
    expect((caps.browserA.capabilities['wdio:pwOptions'] as { executablePath?: string }).executablePath).toBeTruthy()
    expect((caps.browserB.capabilities['wdio:pwOptions'] as { executablePath?: string }).executablePath).toBeTruthy()
  })

  it('throws on unsupported browserName by default (fail fast)', async () => {
    const svc = new PWService()
    const caps: Record<string, unknown> = { browserName: 'safari-mobile' }
    await expect(svc.onPrepare(FAKE_CONFIG, caps)).rejects.toThrow(/unsupported browserName/i)
  })

  it('skips unsupported browserName when ignoreUnsupportedBrowsers=true', async () => {
    const svc = new PWService({ ignoreUnsupportedBrowsers: true })
    const caps: Record<string, unknown> = { browserName: 'safari-mobile' }
    await expect(svc.onPrepare(FAKE_CONFIG, caps)).resolves.toBeUndefined()
    expect(caps['wdio:pwOptions']).toBeUndefined()
  })
})
