#!/usr/bin/env node
/**
 * wdioPW CLI — front-end for the pw driver's auxiliary tooling.
 * Routes browser-binary management and trace-viewer commands to the
 * underlying engine's CLI in `playwright-core`. Users never type that
 * package name themselves.
 *
 * Subcommands:
 *   install [browser...]        Download browser binaries. Default: chromium.
 *   install-deps [browser...]   OS-level deps the browsers need (Linux only).
 *   uninstall                   Remove all downloaded browsers from the cache.
 *   trace <file.zip>            Open a PW trace zip in the trace viewer.
 *   doctor                      Diagnose the PW environment.
 *   shard <patterns...>         Print the K-th of N shards of a spec list.
 *   --version, -V               Print PW version.
 *   --help, -h                  Show this message.
 *
 * Color: emitted only when stdout is a TTY and NO_COLOR is unset (POSIX
 * convention). FORCE_COLOR=1 overrides. Tests capture stdout, so isTTY is
 * false there and assertions match plain text without ANSI escapes.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir, platform, arch } from 'node:os'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

/* -------------------------------------------------------------------------- */
/* Tiny ANSI helper — no `chalk` dep                                          */
/* -------------------------------------------------------------------------- */

const COLOR_ENABLED = (() => {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  if (process.env.NO_COLOR != null) return false
  return Boolean(process.stdout.isTTY)
})()

const c = (open) => (s) => COLOR_ENABLED ? `\x1b[${open}m${s}\x1b[0m` : String(s)
const bold    = c('1')
const dim     = c('2')
const red     = c('31')
const green   = c('32')
const yellow  = c('33')
const blue    = c('34')
const magenta = c('35')
const cyan    = c('36')

function banner() {
  const name = bold(magenta('wdioPW'))
  const ver  = dim(`v${PKG.version}`)
  const tag  = dim('— WebdriverIO pw driver CLI')
  return `\n${name}  ${ver}  ${tag}\n`
}

function header(text) { return bold(cyan(text)) }
function command(text) { return bold(text) }
function flag(text) { return cyan(text) }
function example(text) { return green(text) }

/* -------------------------------------------------------------------------- */
/* Help text                                                                  */
/* -------------------------------------------------------------------------- */

function usage(out = console.log) {
  out(banner())
  out(`${header('USAGE')}
  ${command('wdioPW')} <command> [args]

${header('COMMANDS')}
  ${command('install')} [chromium|firefox|webkit|all ...]
                              Download browser binaries (default: chromium).
  ${command('install-deps')} [browser...]   Install OS-level browser deps (Linux only).
  ${command('uninstall')}                   Remove the downloaded browser cache.
  ${command('trace')} <file.zip>            Open a PW trace zip in the trace viewer.
  ${command('doctor')}                      Diagnose the PW environment (versions, browser cache).
  ${command('shard')} <patterns...>         Print the K-th of N shards of a spec list (CI parallelization).

${header('OPTIONS')}
  ${flag('-V')}, ${flag('--version')}               Print version.
  ${flag('-h')}, ${flag('--help')}                  Show this help.

${header('EXAMPLES')}
  ${example('wdioPW install')}                       ${dim('# chromium only')}
  ${example('wdioPW install chromium firefox')}      ${dim('# both')}
  ${example('wdioPW install all')}                   ${dim('# chromium + firefox + webkit')}
  ${example('wdioPW trace ./traces/run.zip')}
  ${example("wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 2")}

${dim('Disable colors: NO_COLOR=1 wdioPW ...')}
`)
}

const SUBCOMMAND_HELP = {
  install: () => `${banner()}${header('wdioPW install')} ${dim('— download browser binaries.')}

${header('USAGE')}
  ${command('wdioPW install')} [browser...] [options]

${header('BROWSERS')} ${dim('(any combination)')}
  ${bold('chromium')}                  Default if none specified.
  ${bold('firefox')}
  ${bold('webkit')}
  ${bold('all')}                       Shorthand for: chromium firefox webkit

${header('OPTIONS')} ${dim('(forwarded to the engine)')}
  ${flag('--with-deps')}               Also install OS-level dependencies (Linux only).
  ${flag('--dry-run')}                 Print what would be installed; do not download.
  ${flag('--force')}                   Reinstall even if already cached.
  ${flag('--only-shell')}              For chromium: only install the headless shell.

${header('EXAMPLES')}
  ${example('wdioPW install')}
  ${example('wdioPW install chromium firefox')}
  ${example('wdioPW install all')}
  ${example('wdioPW install chromium --with-deps')}
`,

  'install-deps': () => `${banner()}${header('wdioPW install-deps')} ${dim('— install OS-level browser dependencies (Linux).')}

${header('USAGE')}
  ${command('wdioPW install-deps')} [browser...]

Will prompt for sudo. Most relevant for Linux CI; macOS/Windows ignore.
`,

  uninstall: () => `${banner()}${header('wdioPW uninstall')} ${dim('— remove the downloaded browser cache.')}

${header('USAGE')}
  ${command('wdioPW uninstall')}

Frees disk by removing the bundled browser binaries.
`,

  trace: () => `${banner()}${header('wdioPW trace')} ${dim('— open a PW trace zip in the trace viewer.')}

${header('USAGE')}
  ${command('wdioPW trace')} <file.zip> [options]

The viewer launches a local server and opens a browser window. Close the
window to stop the viewer. You can also drag-and-drop the zip onto
${blue('https://trace.playwright.dev/')} for a hosted alternative.
`,

  shard: () => `${banner()}${header('wdioPW shard')} ${dim('— print one slice of a sharded spec list.')}

${header('USAGE')}
  ${command('wdioPW shard')} <patterns...> ${flag('--of')} <total> ${flag('--shard')} <index>

Splits a sorted spec-file list into ${bold('total')} contiguous shards and prints the
${bold('index')}-th (1-based) on stdout, one path per line. Sort order is alphabetical
so the same input produces the same shard across machines.

${header('PATTERNS')} ${dim('(any combination)')}
  ${bold('plain path')}                 e.g. ${cyan('specs/login.spec.ts')} — passed through if it exists.
  ${bold('directory')}                  e.g. ${cyan('specs')} — recursively walked.
  ${bold('glob')}                       e.g. ${cyan("'specs/**/*.spec.ts'")} — quote it so the shell doesn't expand.

${header('OPTIONS')}
  ${flag('--of')} <N>                  Total number of shards. Required.
  ${flag('--shard')} <K>               1-based shard index (1..N). Required.

${header('EXAMPLES')}
  ${example("wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 1")}
  ${example("pnpm wdio --spec $(wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 2)")}

${header('CI matrix snippet')} ${dim('(GitHub Actions)')}
  ${dim('strategy:')}
  ${dim('  matrix:')}
  ${dim('    shard: [1, 2, 3, 4]')}
  ${dim('steps:')}
  ${dim("    - run: pnpm wdio --spec $(wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard \${{ matrix.shard }})")}
`,

  doctor: () => `${banner()}${header('wdioPW doctor')} ${dim('— diagnose PW environment.')}

${header('USAGE')}
  ${command('wdioPW doctor')}

Prints a checklist of the things that have to be in place for PW to run:
  - PW driver version
  - playwright-core version (peer dep — required)
  - Browser binaries cached locally (chromium / firefox / webkit)
  - Node version
  - OS + arch

Exit code 0 if everything is healthy, 1 if a required component is missing.
`,
}

/* -------------------------------------------------------------------------- */
/* Engine resolution + dispatch                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the engine CLI path. We use playwright-core's CLI because it
 * already implements every subcommand we need (install / install-deps /
 * uninstall / show-trace) and is a peer dep of this package.
 */
function resolveEngineCli() {
  try {
    const pkgPath = require.resolve('playwright-core/package.json')
    return join(dirname(pkgPath), 'cli.js')
  } catch (err) {
    console.error(red(bold('error:')) + ' wdioPW cannot find ' + bold('playwright-core') + ' — install it as a peer dependency:\n' +
      '  ' + cyan('npm install playwright-core') + '\n')
    process.exit(1)
  }
}

function info(msg)  { console.log(`${cyan('›')} ${msg}`) }
function ok(msg)    { console.log(`${green('✓')} ${msg}`) }
function warn(msg)  { console.error(`${yellow('!')} ${msg}`) }
function fail(msg)  { console.error(`${red('✗')} ${msg}`) }

function runEngine(label, args) {
  const cli = resolveEngineCli()
  if (label) info(label)
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
  const code = result.status ?? 1
  if (label) {
    if (code === 0) ok(`${label} — done`)
    else fail(`${label} — failed (exit ${code})`)
  }
  process.exit(code)
}

function isHelpFlag(arg) { return arg === '--help' || arg === '-h' }

/* -------------------------------------------------------------------------- */
/* doctor                                                                     */
/* -------------------------------------------------------------------------- */

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Recursively sum file sizes under `root`. Returns 0 if root doesn't exist. */
function dirSize(root) {
  if (!existsSync(root)) return 0
  let total = 0
  const stack = [root]
  while (stack.length) {
    const p = stack.pop()
    let entries
    try { entries = readdirSync(p, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = join(p, e.name)
      if (e.isDirectory()) stack.push(full)
      else { try { total += statSync(full).size } catch { /* skip */ } }
    }
  }
  return total
}

function check(label, ok, detail) {
  const mark = ok ? green('✓') : red('✗')
  console.log(`  ${mark} ${label}${detail ? `  ${dim(detail)}` : ''}`)
  return ok
}

function doctor() {
  console.log(banner())
  console.log(header('PW environment'))

  let allOk = true

  // 1. PW driver itself
  check(`PW driver  ${bold(`v${PKG.version}`)}`, true)

  // 2. playwright-core peer dep
  let pwVersion = null
  try {
    const pw = require('playwright-core/package.json')
    pwVersion = pw.version
    check(`playwright-core peer dep  ${bold(`v${pwVersion}`)}`, true)
  } catch {
    allOk = check('playwright-core peer dep', false, 'not installed — run `npm install playwright-core`') && allOk
  }

  // 3. Node + OS
  check(`Node.js  ${bold(process.version)}`, process.versions.node.split('.')[0] >= 18, process.versions.node.split('.')[0] < 18 ? 'PW requires Node 18+' : '')
  check(`OS  ${bold(`${platform()} (${arch()})`)}`, true)

  // Playwright's browser cache lives in a different place per platform
  // (and `PLAYWRIGHT_BROWSERS_PATH` overrides all of them). Resolve here
  // so the check works on linux runners and Windows users, not just mac.
  const cacheRoot = (() => {
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
    const p = platform()
    if (p === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright')
    if (p === 'win32') return join(homedir(), 'AppData', 'Local', 'ms-playwright')
    return join(homedir(), '.cache', 'ms-playwright')
  })()
  console.log('\n' + header('Browser binaries') + dim(`  (${cacheRoot}/)`))
  if (!existsSync(cacheRoot)) {
    allOk = check('cache directory', false, 'not found — run `wdioPW install`') && allOk
  } else {
    let entries = []
    try { entries = readdirSync(cacheRoot) } catch { /* ignore */ }
    const groups = {
      chromium: entries.filter((e) => /^chromium(-|_)/.test(e) && !/headless_shell/.test(e)),
      'chromium (headless shell)': entries.filter((e) => /^chromium_headless_shell/.test(e)),
      firefox:  entries.filter((e) => /^firefox-/.test(e)),
      webkit:   entries.filter((e) => /^webkit-/.test(e)),
      ffmpeg:   entries.filter((e) => /^ffmpeg-/.test(e)),
    }
    for (const [name, dirs] of Object.entries(groups)) {
      if (dirs.length === 0) {
        check(name, false, 'not installed')
      } else {
        const totalSize = dirs.reduce((s, d) => s + dirSize(join(cacheRoot, d)), 0)
        check(`${name}  ${bold(dirs.join(', '))}`, true, fmtBytes(totalSize))
      }
    }
    const totalCache = dirSize(cacheRoot)
    console.log(`  ${dim('total cache size:')} ${bold(fmtBytes(totalCache))}`)
  }

  console.log('')
  if (allOk) {
    ok('PW looks healthy.')
    process.exit(0)
  } else {
    fail('One or more required components are missing — see above.')
    process.exit(1)
  }
}

/* -------------------------------------------------------------------------- */
/* shard                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Convert a glob pattern (with `**`, `*`, `?`) into an anchored regex.
 * Posix-only — Windows callers should pass forward-slashes (Node's fs APIs
 * accept either, and this CLI is the same surface).
 */
function globToRegex(glob) {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 2
        if (glob[i] === '/') i++ // consume the `/` after `**/`
      } else {
        re += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      re += '[^/]'
      i++
    } else if ('.+^$()|{}[]\\'.includes(ch)) {
      re += '\\' + ch
      i++
    } else {
      re += ch
      i++
    }
  }
  return new RegExp('^' + re + '$')
}

/**
 * Expand one pattern into the matching file paths. Sorted lexicographically
 * so the result is stable across machines and runs.
 */
function expandPattern(pattern) {
  // 1. Plain file path that exists → return it unchanged.
  try {
    const s = statSync(pattern)
    if (s.isFile()) return [pattern]
    if (s.isDirectory()) {
      // Walk the directory; only return regular files.
      const out = []
      for (const entry of readdirSync(pattern, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) {
          // Node 20+ adds `parentPath`; older versions use `path`.
          const dir = entry.parentPath ?? entry.path ?? pattern
          out.push(join(dir, entry.name))
        }
      }
      return out.sort()
    }
  } catch {
    /* not a path — fall through to glob handling */
  }

  // 2. Glob: split off the static prefix (everything before the first `*`/`?`)
  //    and scan that root recursively, then filter by regex.
  const wild = pattern.search(/[*?]/)
  if (wild === -1) return [] // no wildcard, no file → empty
  const prefix = pattern.slice(0, wild).replace(/[^/]*$/, '') || '.'
  const re = globToRegex(pattern)
  let entries = []
  try { entries = readdirSync(prefix, { recursive: true, withFileTypes: true }) } catch { return [] }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const dir = entry.parentPath ?? entry.path ?? prefix
    const full = join(dir, entry.name)
    if (re.test(full)) out.push(full)
  }
  return out.sort()
}

/**
 * Compute the K-of-N shard slice. Pure function for testability — no I/O.
 * Returns a contiguous sub-array preserving the input order. K is 1-based,
 * matching Playwright Test's `--shard=K/N` convention.
 */
function shardSlice(items, total, index) {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard: --of must be a positive integer (got "${total}")`)
  }
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard: --shard must be in [1..${total}] (got "${index}")`)
  }
  const size = items.length
  const start = Math.floor(((index - 1) * size) / total)
  const end = Math.floor((index * size) / total)
  return items.slice(start, end)
}

function parseShardArgs(rest) {
  const patterns = []
  let total, index
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--of') {
      total = Number(rest[++i])
    } else if (a.startsWith('--of=')) {
      total = Number(a.slice('--of='.length))
    } else if (a === '--shard') {
      index = Number(rest[++i])
    } else if (a.startsWith('--shard=')) {
      index = Number(a.slice('--shard='.length))
    } else {
      patterns.push(a)
    }
  }
  if (total === undefined) throw new Error('shard: --of <N> is required')
  if (index === undefined) throw new Error('shard: --shard <K> is required')
  if (!patterns.length) throw new Error('shard: at least one path/glob pattern is required')
  return { patterns, total, index }
}

function shardCommand(rest) {
  let parsed
  try { parsed = parseShardArgs(rest) } catch (err) {
    fail(err.message)
    console.error(`  ${dim('see:')} ${cyan('wdioPW shard --help')}`)
    process.exit(2)
  }

  // Expand → flatten → dedupe → sort. Dedupe matters when patterns overlap
  // (e.g. user passes both `specs` and `specs/login.spec.ts`).
  const seen = new Set()
  for (const pat of parsed.patterns) {
    for (const f of expandPattern(pat)) seen.add(f)
  }
  const all = [...seen].sort()

  let slice
  try { slice = shardSlice(all, parsed.total, parsed.index) } catch (err) {
    fail(err.message)
    process.exit(2)
  }

  if (all.length === 0) {
    // Surface zero matches on stderr so it's noticed in CI logs, but keep
    // stdout empty so consumers piping into `xargs` don't get a stray line.
    warn(`shard: no files matched ${parsed.patterns.map((p) => `"${p}"`).join(' ')}`)
    process.exit(0)
  }

  // stdout: one path per line, no decoration. This is the pipe-able output;
  // anything fancier breaks `$(wdioPW shard ...)` in shell substitution.
  process.stdout.write(slice.join('\n') + (slice.length ? '\n' : ''))
  process.exit(0)
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main(argv) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    usage()
    process.exit(0)
  }
  if (argv[0] === '-V' || argv[0] === '--version') {
    console.log(PKG.version)
    process.exit(0)
  }

  const [cmd, ...rest] = argv

  if (rest.some(isHelpFlag) && SUBCOMMAND_HELP[cmd]) {
    process.stdout.write(SUBCOMMAND_HELP[cmd]())
    process.exit(0)
  }

  switch (cmd) {
    case 'install': {
      // Split positional browsers from forwarded flags so the user-facing
      // label says "installing firefox" not "installing firefox, --dry-run".
      const positional = rest.filter((a) => !a.startsWith('-'))
      const flags = rest.filter((a) => a.startsWith('-'))
      const browsers = positional.includes('all')
        ? ['chromium', 'firefox', 'webkit']
        : positional
      const list = browsers.length ? browsers.join(', ') : 'chromium (default)'
      runEngine(`installing ${bold(list)}`, ['install', ...browsers, ...flags])
      return
    }
    case 'install-deps':
      runEngine('installing browser OS-level dependencies', ['install-deps', ...rest])
      return
    case 'uninstall':
      runEngine('removing browser cache', ['uninstall', ...rest])
      return
    case 'trace': {
      if (rest.length === 0) {
        fail('wdioPW trace: missing trace zip path')
        console.error(`  usage: ${cyan('wdioPW trace <file.zip>')}`)
        process.exit(2)
      }
      runEngine(`opening trace ${bold(rest[0])}`, ['show-trace', ...rest])
      return
    }
    case 'doctor':
      doctor()
      return
    case 'shard':
      shardCommand(rest)
      return
    default:
      fail(`wdioPW: unknown command ${bold(`"${cmd}"`)}`)
      console.error('')
      usage(console.error)
      process.exit(2)
  }
}

main(process.argv.slice(2))
