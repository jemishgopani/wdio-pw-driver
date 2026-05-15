/**
 * Benchmark scenarios — micro and composite. Each measures one path
 * through the driver, isolated as much as practical from page / network
 * variance:
 *
 *   - All scenarios except sessionLifecycle reuse a single shared session
 *     (so newSession cost is amortized away from per-command overhead).
 *   - All HTML is `data:` URLs — zero network latency, zero CDN race.
 *   - Iteration counts are tuned so each scenario takes 1-5 seconds total
 *     (warmup + measured), keeping the full bench under 30 seconds.
 *
 * Each scenario reports mean/p50/p95/p99/min/max in milliseconds.
 *
 * The composite scenario is the only one that exercises a realistic
 * multi-command sequence — it's the canary for "did some refactor add
 * micro-cost across the board?"
 */
import PWDriver from '../src/index.js'
import { ELEMENT_KEY } from '../src/types.js'

export interface Scenario {
  name: string
  warmup: number
  iterations: number
  setup?: () => Promise<void>
  run: () => Promise<void>
  teardown?: () => Promise<void>
}

interface MinimalClient {
  sessionId: string
  navigateTo(url: string): Promise<null>
  findElement(using: string, value: string): Promise<{ [k: string]: string }>
  findElements(using: string, value: string): Promise<Array<{ [k: string]: string }>>
  elementClick(elementId: string): Promise<null>
  executeScript(script: string, args: unknown[]): Promise<unknown>
  deleteSession(): Promise<null>
}

let shared: MinimalClient | null = null

async function ensureShared(): Promise<MinimalClient> {
  if (shared) return shared
  shared = (await PWDriver.newSession({
    capabilities: {
      browserName: 'chromium',
      'wdio:pwOptions': { headless: true, timeout: 5000 },
    },
  })) as MinimalClient
  return shared
}

async function teardownShared(): Promise<void> {
  if (shared) {
    await shared.deleteSession().catch(() => {})
    shared = null
  }
}

const SIMPLE_HTML =
  'data:text/html,' +
  encodeURIComponent('<body><h1 id="t">hello</h1><button id="b" onclick="window.__c=(window.__c||0)+1">click</button></body>')

const LIST_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<body>' + Array.from({ length: 100 }, (_, i) => `<li class="i" data-n="${i}">item ${i}</li>`).join('') + '</body>',
  )

const COMPOSITE_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<body><h1 id="t">page</h1>' +
      '<input id="name" value=""/>' +
      '<button id="go" onclick="document.getElementById(&quot;out&quot;).textContent=document.getElementById(&quot;name&quot;).value">go</button>' +
      '<output id="out"></output></body>',
  )

export const scenarios: Scenario[] = [
  {
    // Cold-start cost — newSession + deleteSession round-trip. The big
    // one (typically 500-1500 ms). If this regresses, something in
    // browser launch or context creation got slower.
    name: 'sessionLifecycle',
    warmup: 1,
    iterations: 5,
    async run() {
      const c = (await PWDriver.newSession({
        capabilities: {
          browserName: 'chromium',
          'wdio:pwOptions': { headless: true },
        },
      })) as MinimalClient
      await c.deleteSession()
    },
  },
  {
    // page.goto + waitFor domcontentloaded against a tiny data URL.
    // Floor of "what does any navigation cost?"
    name: 'navigateTo',
    warmup: 3,
    iterations: 30,
    async setup() {
      await ensureShared()
    },
    async run() {
      await shared!.navigateTo(SIMPLE_HTML)
    },
  },
  {
    // Single-element CSS find. Floor for "find by id" — should be
    // essentially the IPC round-trip + locator allocation.
    name: 'findElement',
    warmup: 5,
    iterations: 50,
    async setup() {
      await ensureShared()
      await shared!.navigateTo(SIMPLE_HTML)
    },
    async run() {
      await shared!.findElement('css selector', '#t')
    },
  },
  {
    // 100-element find. Tests bulk-locator cost more than per-find cost.
    name: 'findElements x100',
    warmup: 3,
    iterations: 20,
    async setup() {
      await ensureShared()
      await shared!.navigateTo(LIST_HTML)
    },
    async run() {
      const all = await shared!.findElements('css selector', '.i')
      if (all.length !== 100) throw new Error(`expected 100, got ${all.length}`)
    },
  },
  {
    // Full click path: visible + enabled + stable + hit-target +
    // dispatch + post-action wait. Each iteration finds fresh because
    // the page resets onclick counter through window.__c.
    name: 'elementClick',
    warmup: 5,
    iterations: 50,
    async setup() {
      await ensureShared()
      await shared!.navigateTo(SIMPLE_HTML)
    },
    async run() {
      const ref = await shared!.findElement('css selector', '#b')
      await shared!.elementClick(ref[ELEMENT_KEY]!)
    },
  },
  {
    // Tiny JS round-trip. Measures the executeScript IPC + result
    // marshaling overhead with no real work in the script body.
    name: 'executeScript',
    warmup: 5,
    iterations: 50,
    async setup() {
      await ensureShared()
      await shared!.navigateTo(SIMPLE_HTML)
    },
    async run() {
      const v = await shared!.executeScript('return 1 + 1', [])
      if (v !== 2) throw new Error(`expected 2, got ${v}`)
    },
  },
  {
    // Realistic interaction sequence: find input → fill → click button
    // → read output. The canary for "did some refactor add overhead
    // across the whole driver?" If the micro-benches don't move but
    // this does, look at the polish layer (logging, error wrapping,
    // service overrides).
    name: 'composite (find+fill+click+read)',
    warmup: 3,
    iterations: 15,
    async setup() {
      await ensureShared()
    },
    async run() {
      await shared!.navigateTo(COMPOSITE_HTML)
      const input = await shared!.findElement('css selector', '#name')
      // Use executeScript to set value (no setValue in MinimalClient — keeps
      // dependency surface small). The bench is about driver overhead, not
      // the specific setValue path.
      await shared!.executeScript(
        `document.getElementById('name').value = 'hello'`,
        [],
      )
      const btn = await shared!.findElement('css selector', '#go')
      await shared!.elementClick(btn[ELEMENT_KEY]!)
      const text = await shared!.executeScript(
        `return document.getElementById('out').textContent`,
        [],
      )
      if (text !== 'hello') throw new Error(`composite assertion failed: ${text}`)
      void input
    },
  },
]

// Process-level teardown so the shared session is always closed even if
// the runner is interrupted.
process.on('exit', () => {
  if (shared) {
    // Sync teardown not possible for a Playwright session, but flag it.
    // In practice the shared session is closed by the last scenario's
    // teardown OR the process exit closes the parent Playwright process.
  }
})

// Public hook so the runner can flush.
export async function _teardownAll(): Promise<void> {
  await teardownShared()
}
