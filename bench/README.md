# Benchmarks

Continuous performance regression detection for the driver.

## Run locally

```bash
pnpm bench                         # all 7 scenarios, ~30s
pnpm bench --only findElement      # subset
pnpm bench --only navigateTo,findElement,elementClick
```

Output:

- `bench/results/<timestamp>.json` — keep these for ad-hoc analysis
- `bench/results/latest.json` — overwritten each run; the CI comparison anchor

Both are gitignored.

## Compare two runs

```bash
pnpm bench:compare bench/results/baseline.json bench/results/latest.json
```

Prints a markdown table with per-scenario p50 / p95 / mean deltas. Exits
1 if any scenario's p95 regressed by more than 20%.

## Scenarios

| Name | What it measures | Iterations |
|---|---|---:|
| `sessionLifecycle` | newSession + deleteSession round-trip (cold start) | 5 |
| `navigateTo` | page.goto + waitFor domcontentloaded against a data: URL | 30 |
| `findElement` | single CSS find + locator materialization | 50 |
| `findElements x100` | bulk locator allocation for a 100-item list | 20 |
| `elementClick` | full actionability cycle (visible + enabled + stable + hit-target + dispatch) | 50 |
| `executeScript` | JS round-trip with no real script work | 50 |
| `composite (find+fill+click+read)` | realistic 4-command interaction sequence | 15 |

All scenarios except `sessionLifecycle` reuse a single shared session
(cold-launch cost is amortized away from per-command overhead). All HTML
is `data:` URLs — zero network latency, zero CDN race.

## Methodology

Each scenario runs `warmup` iterations (results discarded) before
`iterations` measured runs. Times come from `process.hrtime.bigint()`
in nanoseconds, converted to milliseconds.

Stats reported per scenario:

| Stat | Use |
|---|---|
| `p50` | typical cost; tracks "did the median get slower?" |
| `p95` | tail latency; tracks "did the worst case get worse?" — primary regression indicator |
| `p99` | extreme tail; sensitive to GC pauses, less reliable for trend analysis |
| `mean` | sanity check vs p50 — large divergence indicates skew |
| `min` / `max` | best / worst single iteration |
| `stdDev` | how stable the run was |

CI uses **p95** as the regression signal. p50 is too forgiving (a doubled
worst case at 1% rate doesn't move the median); p99 is too noisy at the
iteration counts we run.

## Threshold

- **p95 increase > 20%**: job fails (regression, requires investigation).
- **p95 increase 5-20%**: yellow status, no fail (could be jitter).
- **p95 decrease > 10%**: green "faster" status (suggests an improvement —
  worth a CHANGELOG entry if intentional).

Configure in `bench/compare.ts` (`REGRESSION_THRESHOLD_PCT`,
`IMPROVEMENT_THRESHOLD_PCT`).

## Adding a scenario

1. Add a new entry to the `scenarios` array in `bench/scenarios.ts`.
2. Pick `iterations` so the total scenario time is 1-5 seconds (keeps
   the full bench under 30s).
3. Run `pnpm bench --only <yourname>` to verify shape.
4. The CI workflow auto-picks it up — no workflow change needed.
