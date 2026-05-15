/**
 * Performance benchmark runner.
 *
 * Runs a small set of micro + composite scenarios against the driver,
 * times each iteration with `process.hrtime.bigint()` (nanosecond
 * precision), and writes a JSON report.
 *
 * Output: bench/results/<timestamp>.json AND bench/results/latest.json
 * (overwrites). The nightly CI workflow downloads the previous run's
 * latest.json as an artifact, computes per-scenario p95 deltas, and
 * fails the build on any regression > REGRESSION_THRESHOLD.
 *
 * Run locally:   pnpm bench
 * Run a subset:  pnpm bench --only findElement,elementClick
 *
 * Each scenario warms up for WARMUP iterations (results discarded) before
 * the timed runs — first runs hit cold caches and skew the percentile
 * tail. Default: 5 warmup, then ITERATIONS measured.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Silence the driver's INFO-level "launching chromium" / "closing session"
// chatter — it interleaves with the per-scenario progress line and makes
// the output unreadable. Must be set BEFORE the driver is imported (via
// scenarios.js below) so the @wdio/logger init picks it up.
process.env.WDIO_LOG_LEVEL = process.env.BENCH_LOG_LEVEL ?? 'silent'

import { scenarios, _teardownAll, type Scenario } from './scenarios.js'

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results')
const LATEST_PATH = join(RESULTS_DIR, 'latest.json')

interface ScenarioResult {
  name: string
  iterations: number
  stats: {
    mean: number
    p50: number
    p95: number
    p99: number
    min: number
    max: number
    stdDev: number
  }
}

interface BenchReport {
  timestamp: string
  driverVersion: string
  playwrightCoreVersion: string
  node: string
  os: NodeJS.Platform
  arch: string
  results: ScenarioResult[]
}

function pct(sortedAsc: number[], p: number): number {
  // Linear-interpolation percentile so a 100-iteration run gives
  // sensible p95/p99 values rather than just picking nth element.
  const idx = (sortedAsc.length - 1) * (p / 100)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

function summarize(samples: number[]): ScenarioResult['stats'] {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / sorted.length
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length
  return {
    mean: round(mean),
    p50: round(pct(sorted, 50)),
    p95: round(pct(sorted, 95)),
    p99: round(pct(sorted, 99)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    stdDev: round(Math.sqrt(variance)),
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const samples: number[] = []
  // Warmup
  for (let i = 0; i < s.warmup; i++) {
    await s.run()
  }
  // Measured runs
  for (let i = 0; i < s.iterations; i++) {
    const t0 = process.hrtime.bigint()
    await s.run()
    const elapsedNs = process.hrtime.bigint() - t0
    samples.push(Number(elapsedNs) / 1e6) // ns → ms
  }
  return {
    name: s.name,
    iterations: s.iterations,
    stats: summarize(samples),
  }
}

function parseArgs(): { only: string[] | null } {
  const onlyIdx = process.argv.indexOf('--only')
  if (onlyIdx === -1) return { only: null }
  const v = process.argv[onlyIdx + 1]
  if (!v) throw new Error('--only requires a comma-separated scenario list')
  return { only: v.split(',').map((s) => s.trim()) }
}

async function main() {
  const { only } = parseArgs()
  const toRun = only ? scenarios.filter((s) => only.includes(s.name)) : scenarios
  if (only && toRun.length === 0) {
    throw new Error(`No matching scenarios. Available: ${scenarios.map((s) => s.name).join(', ')}`)
  }

  console.log(`Running ${toRun.length} scenarios (warmup + ${toRun.reduce((a, s) => a + s.iterations, 0)} measured iterations total)...`)
  console.log('')

  const results: ScenarioResult[] = []
  for (const s of toRun) {
    process.stdout.write(`  ${s.name.padEnd(28)} `)
    if (s.setup) await s.setup()
    try {
      const r = await runScenario(s)
      results.push(r)
      console.log(
        `mean ${r.stats.mean.toString().padStart(7)}ms  p50 ${r.stats.p50.toString().padStart(7)}ms  p95 ${r.stats.p95.toString().padStart(7)}ms`,
      )
    } finally {
      if (s.teardown) await s.teardown()
    }
  }

  const driverPkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
  const pwPkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'playwright-core', 'package.json'), 'utf8'))

  const report: BenchReport = {
    timestamp: new Date().toISOString(),
    driverVersion: driverPkg.version,
    playwrightCoreVersion: pwPkg.version,
    node: process.version,
    os: process.platform,
    arch: process.arch,
    results,
  }

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
  const stamped = join(RESULTS_DIR, `${report.timestamp.replace(/[:.]/g, '-')}.json`)
  writeFileSync(stamped, JSON.stringify(report, null, 2))
  writeFileSync(LATEST_PATH, JSON.stringify(report, null, 2))

  console.log('')
  console.log(`Wrote ${stamped}`)
  console.log(`Wrote ${LATEST_PATH}`)

  await _teardownAll()
}

main().catch(async (err) => {
  console.error(err)
  await _teardownAll().catch(() => {})
  process.exit(1)
})
