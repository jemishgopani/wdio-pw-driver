/**
 * Shared base config — the per-engine configs (wdio.conf.ts,
 * wdio.firefox.conf.ts, wdio.webkit.conf.ts) all import this and
 * just override `browserName`.
 *
 * Why split: the only line that differs across engines is browserName,
 * and copy-pasting 60 lines across three files would inevitably drift.
 *
 * Three things this config demonstrates (regardless of engine):
 *
 *   1. `automationProtocol: 'wdio-pw-driver'` — the only line that
 *      switches WDIO from chromedriver to Playwright internals.
 *
 *   2. `services: [[PWService, {}]]` — auto-injects Playwright's
 *      bundled browser binary AND suppresses WDIO's redundant
 *      chromedriver download.
 *
 *   3. `'wdio:pwOptions': { trace: true, recordVideo: {...} }` —
 *      capability-driven tracing + per-page video recording.
 */
import { PWService } from 'wdio-pw-driver'

const HEADLESS = process.env.HEADLESS !== 'false'

type Engine = 'chromium' | 'firefox' | 'webkit'

export function buildConfig(engine: Engine): WebdriverIO.Config {
  return {
    runner: 'local',
    automationProtocol: 'wdio-pw-driver',
    services: [[PWService, {}]] as WebdriverIO.Config['services'],

    baseUrl: 'https://www.saucedemo.com',
    specs: ['./test/specs/**/*.spec.ts'],

    framework: 'mocha',
    mochaOpts: {
      ui: 'bdd',
      timeout: 60_000,
    },

    capabilities: [
      {
        browserName: engine,
        'wdio:pwOptions': {
          headless: HEADLESS,
          timeout: 10_000,
          trace: true,
          // Per-engine trace dir keeps zips from clobbering each other
          // when running configs in parallel.
          traceDir: `./traces/${engine}`,
          recordVideo: { dir: `./videos/${engine}` },
        },
      },
    ],

    logLevel: 'warn',
    reporters: ['spec'],

    maxInstances: 1,
    bail: 0,
    waitforTimeout: 10_000,
    connectionRetryCount: 0,
  }
}
