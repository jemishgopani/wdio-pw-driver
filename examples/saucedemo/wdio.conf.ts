/**
 * SauceDemo example — WebdriverIO 9 + wdio-pw-driver against
 * https://www.saucedemo.com.
 *
 * Three things this config demonstrates:
 *
 *   1. `automationProtocol: 'wdio-pw-driver'` — the only line that
 *      switches WDIO from chromedriver to Playwright internals.
 *
 *   2. `services: [[PWService, {}]]` — auto-injects Playwright's
 *      bundled browser binary AND suppresses WDIO's redundant
 *      chromedriver download.
 *
 *   3. `'wdio:pwOptions': { trace: true, recordVideo: {...} }` —
 *      capability-driven tracing + per-page video recording. Both
 *      written to `./traces` / `./videos` on session close.
 */
import { PWService } from 'wdio-pw-driver'

const HEADLESS = process.env.HEADLESS !== 'false'

export const config: WebdriverIO.Config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',
  // WDIO's strict type for `services` doesn't accept a class constructor
  // as the first tuple element directly — it expects either a string
  // service-name or a hook-functions object. The runtime accepts the
  // class form (as documented), so we cast to keep TypeScript happy.
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
      browserName: 'chromium',
      'wdio:pwOptions': {
        headless: HEADLESS,
        // Per-test action timeout. Auto-wait inherits from this.
        timeout: 10_000,
        // Trace zip per session — open with `npx wdioPW trace ./traces/<file>.zip`
        trace: true,
        traceDir: './traces',
        // 1280×720 webm per page; renamed by the spec on save.
        recordVideo: { dir: './videos' },
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
