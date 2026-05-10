import { describe, expect, it } from 'vitest'

import {
  resolveEngine,
  toLaunchOptions,
  toContextOptions,
  buildResponseCapabilities,
} from '../../src/capabilities.js'
import type { PWCapabilities } from '../../src/types.js'

describe('resolveEngine', () => {
  it('maps chrome variants to chromium', () => {
    expect(resolveEngine('chrome')).toBe('chromium')
    expect(resolveEngine('chromium')).toBe('chromium')
    expect(resolveEngine('msedge')).toBe('chromium')
    expect(resolveEngine('edge')).toBe('chromium')
    expect(resolveEngine('')).toBe('chromium')
    expect(resolveEngine(undefined)).toBe('chromium')
  })

  it('maps safari to webkit', () => {
    expect(resolveEngine('safari')).toBe('webkit')
    expect(resolveEngine('webkit')).toBe('webkit')
  })

  it('maps firefox to firefox', () => {
    expect(resolveEngine('firefox')).toBe('firefox')
  })

  it('throws on unknown', () => {
    expect(() => resolveEngine('netscape')).toThrowError(/unsupported browserName/)
  })
})

describe('toLaunchOptions', () => {
  it('honors wdio:pwOptions', () => {
    const caps: PWCapabilities = {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true, args: ['--no-sandbox'], slowMo: 50 },
    } as PWCapabilities
    const opts = toLaunchOptions(caps)
    expect(opts.headless).toBe(true)
    expect(opts.args).toContain('--no-sandbox')
    expect(opts.slowMo).toBe(50)
  })

  it('merges goog:chromeOptions.args with pwOptions.args', () => {
    const caps = {
      browserName: 'chrome',
      'goog:chromeOptions': { args: ['--mute-audio'] },
      'wdio:pwOptions': { args: ['--no-sandbox'] },
    } as unknown as PWCapabilities
    const opts = toLaunchOptions(caps)
    expect(opts.args).toEqual(expect.arrayContaining(['--no-sandbox', '--mute-audio']))
  })

  it('honors goog:chromeOptions.binary as executablePath', () => {
    const caps = {
      browserName: 'chrome',
      'goog:chromeOptions': { binary: '/path/to/chrome' },
    } as unknown as PWCapabilities
    expect(toLaunchOptions(caps).executablePath).toBe('/path/to/chrome')
  })

  it('extracts proxy from W3C proxy capability', () => {
    const caps = {
      browserName: 'chrome',
      proxy: { httpProxy: 'http://proxy:8080', noProxy: ['localhost', '127.0.0.1'] },
    } as unknown as PWCapabilities
    const opts = toLaunchOptions(caps)
    expect(opts.proxy?.server).toBe('http://proxy:8080')
    expect(opts.proxy?.bypass).toBe('localhost,127.0.0.1')
  })

  it('omits proxy when none provided', () => {
    const opts = toLaunchOptions({ browserName: 'chrome' } as PWCapabilities)
    expect(opts.proxy).toBeUndefined()
  })
})

describe('toContextOptions', () => {
  it('translates acceptInsecureCerts -> ignoreHTTPSErrors', () => {
    const caps = { browserName: 'chrome', acceptInsecureCerts: true } as unknown as PWCapabilities
    expect(toContextOptions(caps).ignoreHTTPSErrors).toBe(true)
  })

  it('honors mobileEmulation deviceMetrics', () => {
    const caps = {
      browserName: 'chrome',
      'goog:chromeOptions': { mobileEmulation: { deviceMetrics: { width: 375, height: 812 } } },
    } as unknown as PWCapabilities
    expect(toContextOptions(caps).viewport).toEqual({ width: 375, height: 812 })
  })
})

describe('buildResponseCapabilities', () => {
  it('preserves user keys, sets engine + version + platform', () => {
    const caps = buildResponseCapabilities(
      { browserName: 'chrome' } as PWCapabilities,
      'chromium',
      '120.0.0.0',
    )
    expect(caps.browserName).toBe('chromium')
    expect(caps.browserVersion).toBe('120.0.0.0')
    expect(caps.platformName).toBe(process.platform)
  })
})
