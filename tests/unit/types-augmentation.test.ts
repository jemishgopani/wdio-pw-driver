/**
 * Type-only test: importing this file (which we do via vitest's normal
 * collection) is enough to compile-check that the WebdriverIO.Capabilities
 * augmentation declared in src/types.ts is in effect.
 *
 * If the augmentation breaks, `tsc --noEmit` (and therefore `vitest`) will
 * fail before any runtime assertion runs.
 */
import { describe, it, expect } from 'vitest'

import type { PWOptions } from '../../src/types.js'

describe('types augmentation', () => {
  it('WebdriverIO.Capabilities accepts wdio:pwOptions without casts', () => {
    const caps: WebdriverIO.Capabilities = {
      browserName: 'chromium',
      'wdio:pwOptions': {
        headless: true,
        slowMo: 100,
        trace: true,
        traceDir: './traces',
      },
    }
    // Type-narrow so the compiler asserts the field is the PWOptions shape.
    const opts: PWOptions | undefined = caps['wdio:pwOptions']
    expect(opts?.headless).toBe(true)
  })

  it('omitting wdio:pwOptions still compiles', () => {
    const caps: WebdriverIO.Capabilities = { browserName: 'firefox' }
    expect(caps.browserName).toBe('firefox')
  })
})
