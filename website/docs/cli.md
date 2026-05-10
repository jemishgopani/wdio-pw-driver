---
sidebar_position: 6
title: CLI
description: "wdioPW commands: install, doctor, shard, trace"
---

The driver ships a small CLI for browser-binary management, trace viewing, environment diagnostics, and CI sharding. Bin name: `wdioPW` (the file is `bin/wdio-pw.js`).

```bash
npx wdioPW <command> [args]
```

Or via your package manager: `pnpm exec wdioPW`, `yarn wdioPW`.

---

## Commands

| Command | What it does |
|---|---|
| `install` | Download Playwright browser binaries |
| `install-deps` | Install OS-level browser dependencies (Linux only) |
| `uninstall` | Remove cached browser binaries |
| `trace` | Open a trace zip in the trace viewer |
| `doctor` | Diagnose the PW environment |
| `shard` | Print one slice of a sharded spec list (CI parallelization) |
| `--version`, `-V` | Print version |
| `--help`, `-h` | Show usage |

Each command has its own `--help` page: `wdioPW install --help`, etc.

---

## `wdioPW install`

Downloads Playwright's bundled browser binaries to `~/Library/Caches/ms-playwright/` (macOS) or `~/.cache/ms-playwright/` (Linux/Windows).

```bash
wdioPW install                       # chromium only (default)
wdioPW install chromium firefox      # specific browsers
wdioPW install all                   # chromium + firefox + webkit
wdioPW install chromium --with-deps  # also install Linux OS deps
```

| Flag | What it does |
|---|---|
| `--with-deps` | Also run `install-deps` afterwards (Linux only) |
| `--dry-run` | Print what would be downloaded; don't actually download |
| `--force` | Reinstall even if already cached |
| `--only-shell` | (Chromium only) Install the headless shell, not the full browser |

Under the hood: delegates to `playwright-core`'s install CLI. Output is colorized when stdout is a TTY.

---

## `wdioPW install-deps`

Installs OS-level browser dependencies. Linux only — macOS and Windows ship the right libraries by default. Will prompt for sudo.

```bash
wdioPW install-deps              # all installed browsers
wdioPW install-deps chromium     # specific
```

Useful in CI Docker images where the base layer is minimal.

---

## `wdioPW uninstall`

Wipes the browser cache, freeing several hundred MB of disk.

```bash
wdioPW uninstall
```

After running this you'd need `wdioPW install` again before launching any session.

---

## `wdioPW trace <path>`

Opens a Playwright trace zip in the trace viewer (a local web app with timeline scrubbing, action history, network requests, console output, etc.).

```bash
wdioPW trace ./traces/abc123.zip
wdioPW trace ./traces/login_flow.zip
```

The viewer launches a local server and opens a browser window to it. Close the window to stop.

Alternative: drag-and-drop the zip onto [trace.playwright.dev](https://trace.playwright.dev/) — same viewer hosted publicly.

---

## `wdioPW doctor`

Prints a diagnostic checklist:
- PW driver version
- `playwright-core` version (peer dep)
- Browser binaries cached locally + their sizes
- Node version
- OS + arch
- Total cache size

```bash
wdioPW doctor
```

Sample output:
```
wdioPW  v0.1.0-alpha.0  — WebdriverIO pw driver CLI

PW environment
  ✓ PW driver  v0.1.0-alpha.0
  ✓ playwright-core peer dep  v1.59.1
  ✓ Node.js  v22.12.0
  ✓ OS  darwin (arm64)

Browser binaries  (~/Library/Caches/ms-playwright/)
  ✓ chromium  chromium-1217  281.4 MB
  ✓ firefox  firefox-1511  102.7 MB
  ✓ webkit  webkit-2272  127.3 MB
  total cache size: 511.4 MB

✓ PW looks healthy.
```

Exit code 0 if everything is healthy, 1 if a required component is missing. Run this in CI as a pre-flight check.

---

## `wdioPW shard`

Splits a sorted spec-file list into N contiguous shards and prints the K-th. Standard CI matrix parallelization.

```bash
wdioPW shard <patterns...> --of <total> --shard <index>
```

| Arg | What it does |
|---|---|
| `<patterns...>` | One or more file paths, directories, or globs (`**` / `*` / `?`) |
| `--of N` | Total number of shards (positive integer) |
| `--shard K` | 1-based shard index (1..N) |

Patterns:
- **Plain file path** — `specs/login.spec.ts` (passed through if it exists)
- **Directory** — `specs` (recursively walked)
- **Glob** — `'specs/**/*.spec.ts'` (quote it so the shell doesn't expand)

Output: one path per line on stdout. Empty matches print a warning to stderr and exit 0 with empty stdout (pipe-safe).

### Examples

```bash
# Print shard 2 of 4
wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 2

# Pipe directly into the runner
pnpm wdio --spec $(wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard 2)
```

### GitHub Actions matrix

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: pnpm wdio --spec $(npx wdioPW shard 'specs/**/*.spec.ts' --of 4 --shard ${{ matrix.shard }})
```

### Slicing strategy

Sorted alphabetically + contiguous slice. Same input always produces the same shard regardless of machine. Adding a new spec file shifts only the boundary between shards (one file moves from shard K to K+1).

Slice math: `items.slice(floor((K-1)*size/N), floor(K*size/N))`. For 9 files across 4 shards: 2 + 2 + 2 + 3 (last shard absorbs the remainder).

---

## Color + terminal behavior

- Colorized output when stdout is a TTY (POSIX convention).
- `NO_COLOR=1 wdioPW ...` disables colors.
- `FORCE_COLOR=1 wdioPW ...` forces colors even when piping.

The CLI's `--help` text is fully PW-branded — won't leak `playwright` package names. The branded help intercepts `--help` / `-h` even for delegated subcommands (install / install-deps / uninstall / trace) and prints a PW-authored description instead of the upstream banner.

The actual installer/viewer output during the operation is NOT rewritten — we don't hijack stdout.

---

## Inside the package

`bin/wdio-pw.js` is a 300-ish-line Node script with zero runtime dependencies (except `playwright-core` which is the driver's peer dep already). It uses `spawnSync(playwrightCli, ...)` for the install/trace operations and pure Node `fs`/`os` for `doctor` and `shard`. No native binaries, no postinstall hooks.

Resolution: `require.resolve('playwright-core/package.json')` then `path.join(dir, 'cli.js')` — works under both flat npm and pnpm's nested `.pnpm/` layouts.
