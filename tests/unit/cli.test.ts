/**
 * CLI smoke test — invokes bin/wdio-pw.js as a real subprocess and
 * checks the help/version paths. Doesn't run `install` (downloads a browser)
 * or `trace` (opens a viewer); those are covered by hand and via the
 * underlying engine's own test suite.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', '..', 'bin', 'wdio-pw.js')

function run(args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, stdout: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

describe('wdioPW CLI', () => {
  it('--help prints usage with all four commands', () => {
    const { code, stdout } = run(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('wdioPW')
    expect(stdout).toMatch(/install/)
    expect(stdout).toMatch(/install-deps/)
    expect(stdout).toMatch(/uninstall/)
    expect(stdout).toMatch(/trace/)
  })

  it('no args prints usage and exits 0', () => {
    const { code, stdout } = run([])
    expect(code).toBe(0)
    // Match the new branded banner — case-insensitive so a future re-skin
    // doesn't break the assertion.
    expect(stdout.toLowerCase()).toContain('usage')
  })

  it('--version prints a semver-ish string', () => {
    const { code, stdout } = run(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('unknown command exits non-zero with usage', () => {
    const { code, stdout } = run(['nope'])
    expect(code).not.toBe(0)
    expect(stdout).toMatch(/unknown command/i)
  })

  it('trace without arg exits non-zero with a clear message', () => {
    const { code, stdout } = run(['trace'])
    expect(code).not.toBe(0)
    expect(stdout).toMatch(/missing trace zip path/i)
  })

  it('install --help prints PW-branded help (not the engine\'s)', () => {
    const { code, stdout } = run(['install', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('wdioPW install')
    expect(stdout).not.toMatch(/playwright/i)
  })

  it('trace --help prints PW-branded help', () => {
    const { code, stdout } = run(['trace', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('wdioPW trace')
  })

  it('doctor prints environment checklist and exits 0 when healthy', () => {
    const { code, stdout } = run(['doctor'])
    expect(code).toBe(0)
    expect(stdout).toContain('PW environment')
    expect(stdout).toContain('PW driver')
    expect(stdout).toContain('playwright-core peer dep')
    expect(stdout).toContain('Node.js')
    expect(stdout).toContain('Browser binaries')
  })

  it('doctor --help prints PW-branded help', () => {
    const { code, stdout } = run(['doctor', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('wdioPW doctor')
  })

  /* ---- shard ---------------------------------------------------------- */

  it('shard --help prints usage with --of and --shard flags', () => {
    const { code, stdout } = run(['shard', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('wdioPW shard')
    expect(stdout).toMatch(/--of/)
    expect(stdout).toMatch(/--shard/)
  })

  it('shard requires --of and --shard', () => {
    const { code: c1, stdout: s1 } = run(['shard', 'specs'])
    expect(c1).not.toBe(0)
    expect(s1).toMatch(/--of/i)

    const { code: c2 } = run(['shard', 'specs', '--of', '4'])
    expect(c2).not.toBe(0)
  })

  it('shard validates --shard is in [1..total]', () => {
    const { code, stdout } = run(['shard', 'tests', '--of', '4', '--shard', '0'])
    expect(code).not.toBe(0)
    expect(stdout).toMatch(/\[1\.\.4\]/)
  })

  it('shard 1/N + 2/N ... N/N covers every input file exactly once', () => {
    // tests/ exists in this repo and has multiple .ts files — use it as the
    // input set so we don't depend on pw-demo. Sort matters: same input
    // → same sort → predictable union.
    const total = 4
    const collected = new Set<string>()
    const counts = new Map<string, number>()
    for (let k = 1; k <= total; k++) {
      const { code, stdout } = run(['shard', 'tests', '--of', String(total), '--shard', String(k)])
      expect(code).toBe(0)
      for (const f of stdout.split('\n').filter(Boolean)) {
        collected.add(f)
        counts.set(f, (counts.get(f) ?? 0) + 1)
      }
    }
    // Every file appears in exactly one shard — slice math is correct.
    for (const c of counts.values()) expect(c).toBe(1)
    expect(collected.size).toBeGreaterThan(0)
  })

  it('shard accepts a glob pattern (`**` recursion)', () => {
    const { code, stdout } = run(['shard', 'tests/**/*.test.ts', '--of', '1', '--shard', '1'])
    expect(code).toBe(0)
    const files = stdout.split('\n').filter(Boolean)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(f).toMatch(/\.test\.ts$/)
  })

  it('shard prints a warning to stderr (not stdout) when nothing matches', () => {
    // Use spawnSync directly so we get stdout + stderr regardless of exit.
    const r = spawnSync(
      process.execPath,
      [CLI, 'shard', 'definitely-nonexistent-dir', '--of', '2', '--shard', '1'],
      { encoding: 'utf8' },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')                    // stdout stays clean for piping
    expect(r.stderr).toMatch(/no files matched/i) // warning visible in CI logs
  })

  it('shard 0-result slice produces empty stdout (pipe-safe)', () => {
    // bin/ has 1 file; shard 1 of 50 (start=floor(0)=0, end=floor(1/50)=0)
    // is the empty-range case. Stdout must be empty so `$(...)` in shell
    // doesn't pass a stray empty line to consumers.
    const { code, stdout } = run(['shard', 'bin', '--of', '50', '--shard', '1'])
    expect(code).toBe(0)
    expect(stdout).toBe('')
  })
})
