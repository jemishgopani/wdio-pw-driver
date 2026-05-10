/**
 * PWService — the WDIO launcher service that auto-resolves Playwright's
 * browser-binary path and injects it into each capability set before
 * WDIO's own launcher tries to download its own Chromium.
 *
 *   import PWService from 'wdio-pw-driver'
 *
 *   services: [[PWService, {}]]
 *
 * Per-test trace + context rotation (the "isolation" feature) lives in
 * a separate spec-level helper at `wdio-pw-driver` → `installPerTestHooks`
 * — see that module for usage. WDIO 9 doesn't expose `beforeTest` /
 * `afterTest` as service hooks (those are Mocha-framework hooks
 * configured at the top-level config OR via Mocha's own `beforeEach` /
 * `afterEach`), so isolation can't be a service concern; it has to be
 * either inline in `wdio.conf.ts` or installed by the spec itself.
 */
import { resolveEngine } from './capabilities.js'
import { log } from './logger.js'
import type { PWOptions } from './types.js'

export interface PWServiceOptions {
  /**
   * If true, the service silently skips capabilities whose browserName
   * isn't one PW supports. If false (default), unsupported names raise
   * an error during onPrepare so misconfigured runs fail fast.
   */
  ignoreUnsupportedBrowsers?: boolean
}

type CapsRecord = Record<string, unknown> & {
  browserName?: string
  'goog:chromeOptions'?: { binary?: string; args?: string[] }
  'moz:firefoxOptions'?: { binary?: string; args?: string[] }
  'wdio:pwOptions'?: PWOptions
}

export default class PWService {
  private readonly options: PWServiceOptions

  constructor(options: PWServiceOptions = {}) {
    this.options = options
  }

  /**
   * Launcher hook fired once before any worker is spawned. Mutates the
   * capabilities array in place — that's the convention WDIO services
   * have followed since v5; returning a new array doesn't propagate.
   */
  async onPrepare(
    _config: unknown,
    capabilities: CapsRecord | CapsRecord[] | Record<string, { capabilities: CapsRecord }>,
  ): Promise<void> {
    const targets = collectCapabilitySets(capabilities)
    if (!targets.length) return

    let pw: typeof import('playwright-core')
    try {
      pw = await import('playwright-core')
    } catch (err) {
      throw new Error(
        'PWService: requires "playwright-core" as a peer dependency. ' +
        'Install with: npm install playwright-core && npx wdioPW install\n' +
        `Original error: ${(err as Error).message}`,
      )
    }

    for (const caps of targets) {
      let engine: 'chromium' | 'firefox' | 'webkit'
      try {
        engine = resolveEngine(caps.browserName)
      } catch (err) {
        if (this.options.ignoreUnsupportedBrowsers) continue
        throw err instanceof Error ? err : new Error(String(err))
      }

      const existing = readExistingBinary(caps, engine)
      if (existing) {
        log.info(`PWService: skipping ${engine} — caller already set binary at ${existing}`)
        continue
      }

      const binary = pw[engine].executablePath()
      writeBinary(caps, engine, binary)
      log.info(`PWService: ${engine} binary → ${binary}`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* internal helpers                                                            */
/* -------------------------------------------------------------------------- */

function collectCapabilitySets(
  capabilities: CapsRecord | CapsRecord[] | Record<string, { capabilities: CapsRecord }> | unknown,
): CapsRecord[] {
  if (!capabilities || typeof capabilities !== 'object') return []
  if (Array.isArray(capabilities)) {
    return capabilities.map((c) => c as CapsRecord)
  }
  const values = Object.values(capabilities as Record<string, unknown>)
  const looksLikeMultiremote = values.some(
    (v) => v && typeof v === 'object' && 'capabilities' in (v as object),
  )
  if (looksLikeMultiremote) {
    return values
      .map((v) => {
        if (v && typeof v === 'object' && 'capabilities' in (v as object)) {
          return (v as { capabilities: CapsRecord }).capabilities
        }
        return v as CapsRecord
      })
      .filter((c): c is CapsRecord => Boolean(c) && typeof c === 'object')
  }
  return [capabilities as CapsRecord]
}

function readExistingBinary(caps: CapsRecord, engine: 'chromium' | 'firefox' | 'webkit'): string | undefined {
  if (caps['wdio:pwOptions']?.executablePath) return caps['wdio:pwOptions'].executablePath
  if (engine === 'chromium' && caps['goog:chromeOptions']?.binary) return caps['goog:chromeOptions'].binary
  if (engine === 'firefox' && caps['moz:firefoxOptions']?.binary) return caps['moz:firefoxOptions'].binary
  return undefined
}

function writeBinary(caps: CapsRecord, engine: 'chromium' | 'firefox' | 'webkit', binary: string): void {
  caps['wdio:pwOptions'] = { ...(caps['wdio:pwOptions'] ?? {}), executablePath: binary }
  if (engine === 'chromium') {
    caps['goog:chromeOptions'] = { ...(caps['goog:chromeOptions'] ?? {}), binary }
  } else if (engine === 'firefox') {
    caps['moz:firefoxOptions'] = { ...(caps['moz:firefoxOptions'] ?? {}), binary }
  }
}
