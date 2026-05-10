/**
 * Unit tests for `installPerTestHooks`. The helper installs Mocha
 * `beforeEach` / `afterEach` hooks that drive trace lifecycle + (in
 * `per-test-isolated` mode) context rotation. Vitest doesn't have Mocha's
 * hooks natively, so we mock them as captured callbacks and invoke them
 * by hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { installPerTestHooks } from '../../src/testHelpers.js'

interface MockBrowser {
  pwStartTrace: ReturnType<typeof vi.fn>
  pwStopTrace: ReturnType<typeof vi.fn>
  pwNewContext: ReturnType<typeof vi.fn>
}

let captured: { beforeEach?: () => Promise<unknown>; afterEach?: (this: { currentTest?: unknown }) => Promise<unknown> }
let mockBrowser: MockBrowser
let emittedContexts: Array<{ title: string; value: unknown }>

beforeEach(() => {
  captured = {}
  emittedContexts = []
  mockBrowser = {
    pwStartTrace: vi.fn().mockResolvedValue(null),
    pwStopTrace: vi.fn().mockResolvedValue(null),
    pwNewContext: vi.fn().mockResolvedValue(null),
  }

  // Stub Mocha's beforeEach / afterEach by installing them on globalThis
  // so the helper finds them. The helper passes the callback in; we
  // just store it for hand-invocation in each test.
  ;(globalThis as unknown as { beforeEach: (fn: () => unknown) => void }).beforeEach = (fn) => { captured.beforeEach = fn as never }
  ;(globalThis as unknown as { afterEach: (fn: (this: unknown) => unknown) => void }).afterEach = (fn) => { captured.afterEach = fn as never }
  ;(globalThis as unknown as { browser: MockBrowser }).browser = mockBrowser

  // Stub the wdio-mochawesome-reporter event channel so we can capture
  // emitMetrics output without needing the real reporter.
  process.removeAllListeners('wdio-mochawesome-reporter:addContext')
  process.on('wdio-mochawesome-reporter:addContext', (entry) => {
    emittedContexts.push(entry as { title: string; value: unknown })
  })
})

describe('installPerTestHooks', () => {
  it('per-test-trace mode: installs both Mocha hooks', () => {
    installPerTestHooks({ mode: 'per-test-trace' })
    expect(captured.beforeEach).toBeTypeOf('function')
    expect(captured.afterEach).toBeTypeOf('function')
  })

  it('beforeEach calls pwStartTrace', async () => {
    installPerTestHooks({ mode: 'per-test-trace' })
    await captured.beforeEach!()
    expect(mockBrowser.pwStartTrace).toHaveBeenCalledTimes(1)
    // No rotation in beforeEach regardless of mode.
    expect(mockBrowser.pwNewContext).not.toHaveBeenCalled()
  })

  it('afterEach in per-test-trace mode: stops trace, emits metrics, no rotation', async () => {
    installPerTestHooks({ mode: 'per-test-trace', traceDir: './out/traces' })
    await captured.afterEach!.call({
      currentTest: { fullTitle: () => 'My suite > my test', duration: 42 },
    })

    expect(mockBrowser.pwStopTrace).toHaveBeenCalledWith('./out/traces/My_suite_my_test.zip')
    expect(mockBrowser.pwNewContext).not.toHaveBeenCalled()
    expect(emittedContexts).toEqual([
      { title: 'Trace zip', value: './out/traces/My_suite_my_test.zip' },
      { title: 'Duration', value: '42 ms' },
    ])
  })

  it('afterEach in per-test-isolated mode: stops trace AND rotates context', async () => {
    installPerTestHooks({ mode: 'per-test-isolated' })
    await captured.afterEach!.call({
      currentTest: { fullTitle: () => 'iso test', duration: 5 },
    })
    expect(mockBrowser.pwStopTrace).toHaveBeenCalled()
    expect(mockBrowser.pwNewContext).toHaveBeenCalledTimes(1)
  })

  it('emitMetrics: false suppresses Trace zip + Duration emissions', async () => {
    installPerTestHooks({ mode: 'per-test-trace', emitMetrics: false })
    await captured.afterEach!.call({
      currentTest: { fullTitle: () => 'quiet', duration: 1 },
    })
    expect(emittedContexts).toEqual([])
    // Trace stop still happens — only the reporter side is silenced.
    expect(mockBrowser.pwStopTrace).toHaveBeenCalled()
  })

  it('extraContext callback fires after stop with resolved tracePath', async () => {
    const extra = vi.fn().mockResolvedValue(null)
    installPerTestHooks({ mode: 'per-test-trace', extraContext: extra })
    await captured.afterEach!.call({
      currentTest: { fullTitle: () => 'cb test', duration: 12 },
    })
    expect(extra).toHaveBeenCalledOnce()
    const [, durationMs, extras] = extra.mock.calls[0]!
    expect(durationMs).toBe(12)
    expect(extras).toMatchObject({ tracePath: './traces/cb_test.zip', mode: 'per-test-trace' })
  })

  it('test name with path-hostile chars gets sanitized', async () => {
    installPerTestHooks({ mode: 'per-test-trace' })
    await captured.afterEach!.call({
      currentTest: { fullTitle: () => 'OAuth: GET /api/v1/users (200)', duration: 0 },
    })
    expect(mockBrowser.pwStopTrace).toHaveBeenCalledWith(
      './traces/OAuth_GET_api_v1_users_200_.zip',
    )
  })

  it('hooks swallow errors silently — never fail a test for reporting', async () => {
    mockBrowser.pwStartTrace.mockRejectedValue(new Error('oops'))
    mockBrowser.pwStopTrace.mockRejectedValue(new Error('also oops'))
    mockBrowser.pwNewContext.mockRejectedValue(new Error('rotation broke'))
    installPerTestHooks({ mode: 'per-test-isolated' })
    // Both hooks should resolve — never reject.
    await expect(captured.beforeEach!()).resolves.toBeUndefined()
    await expect(captured.afterEach!.call({
      currentTest: { fullTitle: () => 'fail test', duration: 1 },
    })).resolves.toBeUndefined()
  })
})
