import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { bridges, MockBridge } = vi.hoisted(() => {
  const instances: Array<{
    options: { env: Record<string, string> }
    start: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }> = []
  class Bridge {
    start = vi.fn()
    send = vi.fn()
    stop = vi.fn()

    constructor(public options: { env: Record<string, string> }) {
      instances.push(this)
    }
  }
  return { bridges: instances, MockBridge: Bridge }
})

vi.mock('../src/host/helper-process.js', () => ({ HelperProcess: MockBridge }))

import { CompanionReducer, apply } from '../src/index.ts'

describe('companion host lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bridges.length = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    ['C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe', 'dsh://open'],
    [undefined, 'http://127.0.0.1:19387/'],
  ])('uses the matching app entry for desktop executable %s', (executable, expected) => {
    vi.stubEnv('DSH_DESKTOP_NODE_EXECUTABLE', executable)
    apply({ on: () => () => {}, logger: { info: vi.fn() } }, { webuiUrl: 'http://127.0.0.1:19387/' })
    expect(bridges[0].options.env.DSH_DAFEIYU_WEBUI_URL).toBe(expected)
  })

  it('starts, stops, isolates reducer errors, and tears down every registration', () => {
    let watchListener: ((next: Record<string, unknown>) => void) | undefined
    let lifecycleTeardown: (() => void) | undefined
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const offEvent = vi.fn()
    const offDisposed = vi.fn()
    const unwatch = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const settings = {
      get: vi.fn(() => ({ enabled: false })),
      watch: vi.fn((listener: (next: Record<string, unknown>) => void) => {
        watchListener = listener
        return unwatch
      }),
    }
    const context = {
      logger,
      settings: { register: vi.fn(() => settings) },
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
        return event === 'session/event' ? offEvent : offDisposed
      }),
      effect: vi.fn((register: () => () => void) => {
        lifecycleTeardown = register()
      }),
    }

    apply(context)
    expect(bridges).toHaveLength(0)

    watchListener?.({ enabled: true })
    vi.advanceTimersByTime(399)
    expect(bridges).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(bridges).toHaveLength(1)
    expect(bridges[0].start).toHaveBeenCalledTimes(1)

    vi.spyOn(CompanionReducer.prototype, 'handle').mockImplementationOnce(() => {
      throw new Error('bad event')
    })
    expect(() => listeners.get('session/event')?.({}, {})).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith('maid-whale companion failed to handle session event', expect.any(Error))

    watchListener?.({ enabled: false })
    expect(bridges[0].stop).toHaveBeenCalledWith('settings-change')

    lifecycleTeardown?.()
    expect(offEvent).toHaveBeenCalledTimes(1)
    expect(offDisposed).toHaveBeenCalledTimes(1)
    expect(unwatch).toHaveBeenCalledTimes(1)
  })
})
