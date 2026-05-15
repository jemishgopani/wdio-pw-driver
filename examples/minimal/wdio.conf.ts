/**
 * Smallest viable WebdriverIO config that uses wdio-pw-driver.
 *
 * Three driver-specific lines (everything else is stock WDIO):
 *
 *   1. import PWService              ← the launcher service
 *   2. automationProtocol: '...'     ← tells WDIO which driver to load
 *   3. services: [[PWService, {}]]   ← injects browser binary, registers overrides
 */
import { PWService } from 'wdio-pw-driver'

export const config: WebdriverIO.Config = {
  runner: 'local',
  automationProtocol: 'wdio-pw-driver',
  services: [[PWService, {}]] as WebdriverIO.Config['services'],

  specs: ['./test.spec.ts'],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 30_000 },

  capabilities: [{
    browserName: 'chromium',
    'wdio:pwOptions': { headless: true },
  }],

  logLevel: 'warn',
  reporters: ['spec'],
}
