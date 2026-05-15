/**
 * Compare two bench JSON reports — the freshly-generated `latest.json`
 * vs a `baseline.json` (the previous run, downloaded as a CI artifact
 * before the new runner fires).
 *
 * Output: a markdown table summarizing per-scenario p95 deltas, plus a
 * non-zero exit code if any scenario regressed by more than
 * REGRESSION_THRESHOLD percent. The CI workflow uses both the table
 * (printed to GITHUB_STEP_SUMMARY) and the exit code (job pass/fail).
 *
 * Usage:
 *   tsx bench/compare.ts <baseline.json> <new.json>
 *
 * If the baseline file doesn't exist, the comparison is skipped and the
 * job passes — we don't want a fresh repo's first nightly to fail just
 * because there's nothing to compare against.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const REGRESSION_THRESHOLD_PCT = 20
const IMPROVEMENT_THRESHOLD_PCT = 10

interface ScenarioStats {
  mean: number
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  stdDev: number
}

interface ScenarioResult {
  name: string
  iterations: number
  stats: ScenarioStats
}

interface BenchReport {
  timestamp: string
  driverVersion: string
  playwrightCoreVersion: string
  node: string
  os: string
  arch: string
  results: ScenarioResult[]
}

function pctChange(prev: number, next: number): number {
  if (prev === 0) return next === 0 ? 0 : Infinity
  return ((next - prev) / prev) * 100
}

function fmtPct(p: number): string {
  if (p === 0) return '—'
  const sign = p > 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function badge(p: number): string {
  if (p > REGRESSION_THRESHOLD_PCT) return '🔴 regressed'
  if (p > 5) return '🟡 slower'
  if (p < -IMPROVEMENT_THRESHOLD_PCT) return '🟢 faster'
  return '✅'
}

function main() {
  const [baselinePath, newPath] = process.argv.slice(2)
  if (!baselinePath || !newPath) {
    console.error('Usage: tsx bench/compare.ts <baseline.json> <new.json>')
    process.exit(2)
  }

  const newReport: BenchReport = JSON.parse(readFileSync(newPath, 'utf8'))

  if (!existsSync(baselinePath)) {
    const summary = [
      '## Benchmark report',
      '',
      `_No baseline available — this is the first run on this branch._`,
      '',
      `Driver \`${newReport.driverVersion}\` · playwright-core \`${newReport.playwrightCoreVersion}\` · ${newReport.node} on ${newReport.os}/${newReport.arch}`,
      '',
      summarizeAbsolute(newReport),
    ].join('\n')
    writeSummary(summary)
    console.log(summary)
    process.exit(0)
  }

  const baselineReport: BenchReport = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const baselineByName = new Map(baselineReport.results.map((r) => [r.name, r]))

  const rows: Array<{
    name: string
    pP50: number
    pP95: number
    pMean: number
    note: string
  }> = []
  let regressed = false
  for (const cur of newReport.results) {
    const prev = baselineByName.get(cur.name)
    if (!prev) {
      rows.push({ name: cur.name, pP50: NaN, pP95: NaN, pMean: NaN, note: 'new' })
      continue
    }
    const pP50 = pctChange(prev.stats.p50, cur.stats.p50)
    const pP95 = pctChange(prev.stats.p95, cur.stats.p95)
    const pMean = pctChange(prev.stats.mean, cur.stats.mean)
    if (pP95 > REGRESSION_THRESHOLD_PCT) regressed = true
    rows.push({ name: cur.name, pP50, pP95, pMean, note: badge(pP95) })
  }

  const lines: string[] = [
    '## Benchmark report',
    '',
    `Driver \`${newReport.driverVersion}\` · playwright-core \`${newReport.playwrightCoreVersion}\` · ${newReport.node} on ${newReport.os}/${newReport.arch}`,
    `Baseline: \`${baselineReport.driverVersion}\` from \`${baselineReport.timestamp}\``,
    '',
    '| Scenario | p50 Δ | p95 Δ | mean Δ | status |',
    '|---|---:|---:|---:|---|',
  ]
  for (const r of rows) {
    lines.push(`| ${r.name} | ${fmtPct(r.pP50)} | ${fmtPct(r.pP95)} | ${fmtPct(r.pMean)} | ${r.note} |`)
  }
  lines.push('')
  lines.push(`Threshold: any p95 increase > ${REGRESSION_THRESHOLD_PCT}% fails the job.`)
  lines.push('')
  lines.push('### Absolute numbers (this run)')
  lines.push('')
  lines.push(summarizeAbsolute(newReport))

  const out = lines.join('\n')
  console.log(out)
  writeSummary(out)

  if (regressed) {
    console.error(`\n💥 One or more scenarios regressed by more than ${REGRESSION_THRESHOLD_PCT}% on p95.`)
    process.exit(1)
  }
}

function summarizeAbsolute(report: BenchReport): string {
  const lines = [
    '| Scenario | iterations | mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) |',
    '|---|---:|---:|---:|---:|---:|',
  ]
  for (const r of report.results) {
    lines.push(
      `| ${r.name} | ${r.iterations} | ${r.stats.mean} | ${r.stats.p50} | ${r.stats.p95} | ${r.stats.p99} |`,
    )
  }
  return lines.join('\n')
}

function writeSummary(content: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (!path) return
  // Append; CI may write to summary from multiple steps.
  writeFileSync(path, content + '\n', { flag: 'a' })
}

main()
