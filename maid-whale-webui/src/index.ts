/**
 * Host entry: registers the cloud-paper skin's desktop companion (vendored and
 * rebranded from QCYTSN/dsh-dafeiyu, MIT). The companion is a transparent
 * always-on-top native window whose lifecycle is bound to the DSH host: it
 * starts with DSH, keeps rendering while the WebUI is minimized, and exits on
 * host shutdown.
 */
import Schema from '@deepseek-ai/schemastery'
import { CompanionReducer } from './host/companion-reducer.js'
import { HelperProcess } from './host/helper-process.js'
import { CompanionMessageKind, CompanionState, createMessage } from './host/protocol.js'

const PKG_VERSION = '0.1.1'

export const name = '@yunxii/dsh-client-ui-skin-maid-whale-webui'
// The companion is built on session events, and mounting requires the settings
// service (used to read live config). Keep the declared inject in sync with
// those real hard dependencies instead of listing a service that is never
// consumed directly.
export const inject = ['sessions', 'settings']
export const CONFIG_ENDPOINT = '/plugins/maid-whale-webui/config'
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用鲸鱼桌宠'),
  scale: Schema.number().min(0.4).max(1.4).step(0.0001).default(0.6552).role('slider').description('角色大小'),
  bubbleScale: Schema.number().min(0.6).max(1.2).step(0.01).default(0.78).role('slider').description('气泡大小'),
  activityLevel: Schema.union([
    Schema.const('quiet').description('安静'),
    Schema.const('normal').description('标准'),
    Schema.const('lively').description('活泼'),
  ])
    .default('normal')
    .description('空闲微动作频率'),
  reducedMotion: Schema.boolean().default(false).description('减少走动、循环帧和程序化晃动'),
  bubbleMode: Schema.union([
    Schema.const('always').description('常驻显示'),
    Schema.const('hidden').description('完全隐藏'),
    Schema.const('custom').description('自定义显示状态'),
  ])
    .default('always')
    .description('气泡显示模式'),
  bubbleStates: Schema.array(Schema.string())
    .default(['SUCCESS', 'ERROR', 'WAITING'])
    .description('自定义模式下显示气泡的状态'),
  includeSubagents: Schema.boolean().default(false).description('允许子 Agent 抢占宠物状态'),
}).description('由 DeepSeek Harness 状态驱动的鲸鱼桌宠')

const defaults = Object.freeze({
  enabled: true,
  scale: 0.6552,
  bubbleScale: 0.78,
  activityLevel: 'normal',
  reducedMotion: false,
  bubbleMode: 'always',
  bubbleStates: ['SUCCESS', 'ERROR', 'WAITING'],
  includeSubagents: false,
})

interface CompanionConfig {
  enabled?: boolean
  scale?: number
  bubbleScale?: number
  activityLevel?: string
  reducedMotion?: boolean
  bubbleMode?: string
  bubbleStates?: string[]
  includeSubagents?: boolean
  helper?: { env?: Record<string, string>; command?: string; args?: string[]; cwd?: string }
  webuiUrl?: string
}

interface SettingsScope {
  get: () => CompanionConfig
  watch: (listener: (next: CompanionConfig) => void) => () => void
  update?: (patch: Record<string, unknown>) => Promise<void> | void
}

interface SettingsService {
  register?: (id: string, schema: unknown, options: Record<string, unknown>) => SettingsScope
}

interface HttpRegistration {
  kind: 'exact'
  path: string
  handler: (req: ServerRequestLike, res: ServerResponseLike) => Promise<void> | void
}

interface WebServerService {
  webServer: { register: (registration: HttpRegistration) => unknown }
  effect: (teardown: () => unknown, description: string) => unknown
}

interface MinimalContext {
  logger?: {
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
  inject?: (services: string[], callback: (ctx: unknown) => void) => unknown
  effect?: (teardown: () => unknown, description: string) => unknown
  on: (event: string, listener: (...args: never[]) => void, options?: Record<string, unknown>) => () => void
  settings?: SettingsService
}

function publicConfig(config: CompanionConfig = {}): Record<string, unknown> {
  return {
    enabled: config.enabled ?? defaults.enabled,
    scale: config.scale ?? defaults.scale,
    bubbleScale: config.bubbleScale ?? defaults.bubbleScale,
    activityLevel: config.activityLevel ?? defaults.activityLevel,
    reducedMotion: config.reducedMotion ?? defaults.reducedMotion,
    bubbleMode: config.bubbleMode ?? defaults.bubbleMode,
    bubbleStates: Array.isArray(config.bubbleStates) ? config.bubbleStates : [...defaults.bubbleStates],
    includeSubagents: config.includeSubagents ?? defaults.includeSubagents,
  }
}

function localSettingsScope(value: CompanionConfig): SettingsScope {
  return {
    get: () => value,
    watch: () => () => {},
  }
}

interface ServerResponseLike {
  writeHead: (status: number, headers: Record<string, string | number>) => void
  end: (payload: string) => void
}

interface ServerRequestLike {
  method?: string
  headers?: { origin?: string; host?: string }
  socket?: { remoteAddress?: string }
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>
}

function jsonResponse(res: ServerResponseLike, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readPatch(req: ServerRequestLike): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  const body = req as AsyncIterable<Buffer>
  for await (const chunk of body) {
    bytes += chunk.length
    if (bytes > 8192) throw new Error('request body is too large')
    chunks.push(Buffer.from(chunk))
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('patch must be an object')
  const allowed = new Set(Object.keys(defaults))
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('patch contains an unknown setting')
  return value as Record<string, unknown>
}

export function createConfigHandler(
  settings: SettingsScope,
): (req: ServerRequestLike, res: ServerResponseLike) => Promise<void> {
  return async (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    // Origin and Host can both name an attacker-controlled domain after DNS
    // rebinding. Require a loopback authority before comparing the two.
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.headers?.host ?? '')) {
      jsonResponse(res, 403, { error: 'untrusted host' })
      return
    }
    const origin = req.headers?.origin
    if (origin) {
      let originHost: string | undefined
      try {
        originHost = new URL(origin).host
      } catch {}
      if (!originHost || originHost !== req.headers?.host) {
        jsonResponse(res, 403, { error: 'origin mismatch' })
        return
      }
    }
    if (req.method === 'GET') {
      jsonResponse(res, 200, settings.get())
      return
    }
    if (req.method !== 'PATCH') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const patch = await readPatch(req)
      await settings.update?.(patch)
      jsonResponse(res, 200, settings.get())
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function mount(ctx: MinimalContext, config: CompanionConfig = {}, eventCtx: MinimalContext = ctx): void {
  const logger = ctx.logger ?? console
  const base = publicConfig(config)
  const settings =
    ctx.settings?.register?.('maid-whale-webui', Config, {
      base,
      applies: 'live',
    }) ?? localSettingsScope(base)

  let bridge: HelperProcess | undefined
  let reducer: CompanionReducer | undefined
  let restartTimer: NodeJS.Timeout | undefined

  const stopRuntime = (reason = 'settings-change'): void => {
    bridge?.stop(reason)
    bridge = undefined
    reducer = undefined
  }

  const restartRuntime = (next: CompanionConfig): void => {
    stopRuntime('settings-change')
    startRuntime(next)
  }

  const applyLiveSettings = (next: CompanionConfig): void => {
    if (!bridge || !reducer) return
    for (const message of reducer.setIncludeSubagents(next.includeSubagents === true)) bridge.send(message)
    bridge.send(
      createMessage(CompanionMessageKind.CONFIG, {
        scale: next.scale ?? defaults.scale,
        bubbleScale: next.bubbleScale ?? defaults.bubbleScale,
        activityLevel: next.activityLevel ?? defaults.activityLevel,
        reducedMotion: next.reducedMotion === true,
        bubbleMode: next.bubbleMode ?? defaults.bubbleMode,
        bubbleStates: Array.isArray(next.bubbleStates) ? next.bubbleStates : [...defaults.bubbleStates],
      }),
    )
  }

  const scheduleRestart = (next: CompanionConfig): void => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      restartRuntime(next)
    }, 400)
    restartTimer.unref?.()
  }

  const startRuntime = (resolved: CompanionConfig): void => {
    if (resolved.enabled === false) {
      logger.info?.('maid-whale companion is disabled')
      return
    }
    const helperConfig = config.helper ?? {}
    bridge = new HelperProcess(
      {
        ...helperConfig,
        env: {
          ...helperConfig.env,
          // DSH_DAFEIYU_* names are the runtime contract read by
          // runtime/helper.py; renaming them here would silently drop every
          // configuration flag.
          DSH_DAFEIYU_SCALE: String(resolved.scale ?? defaults.scale),
          DSH_DAFEIYU_BUBBLE_SCALE: String(resolved.bubbleScale ?? defaults.bubbleScale),
          DSH_DAFEIYU_ACTIVITY_LEVEL: String(resolved.activityLevel ?? defaults.activityLevel),
          DSH_DAFEIYU_REDUCED_MOTION: resolved.reducedMotion === true ? '1' : '0',
          DSH_DAFEIYU_BUBBLE_MODE: String(resolved.bubbleMode ?? defaults.bubbleMode),
          DSH_DAFEIYU_BUBBLE_STATES: (Array.isArray(resolved.bubbleStates)
            ? resolved.bubbleStates
            : defaults.bubbleStates
          ).join(','),
          DSH_DAFEIYU_WEBUI_URL: String(
            process.env.DSH_DESKTOP_NODE_EXECUTABLE
              ? 'dsh://open'
              : (config.webuiUrl ?? process.env.DSH_DAFEIYU_WEBUI_URL ?? 'http://127.0.0.1:3080/'),
          ),
        },
      },
      logger as unknown as Console,
    )
    reducer = new CompanionReducer({ includeSubagents: resolved.includeSubagents === true })
    bridge.start()
    bridge.send(
      createMessage(CompanionMessageKind.HELLO, {
        state: CompanionState.IDLE,
        host: 'deepseek-harness',
        pluginVersion: PKG_VERSION,
        message: 'Cloud whale connected to DSH',
      }),
    )
    bridge.send(
      createMessage(CompanionMessageKind.STATE, {
        state: CompanionState.IDLE,
        phase: 'plugin-start',
        stage: '等待任务',
        message: '鲸鲸在这儿等新任务哦',
        detail: 'DSH · 等待下一次任务',
      }),
    )
    logger.info?.('maid-whale companion bridge started')
  }

  startRuntime(settings.get())

  // The companion intentionally observes every DSH session. Loader entries may
  // live inside a scoped composition, so use the unscoped root bus and dispose
  // the registrations explicitly with this plugin's lifecycle.
  // Never let an exception from this optional companion escape into the shared
  // session bus: a throw here could stop every other subscriber from seeing
  // the event, which would look exactly like "installing the pet broke other
  // plugins".
  const offEvent = eventCtx.on(
    'session/event',
    ((session: unknown, event: unknown) => {
      if (!bridge || !reducer) return
      try {
        for (const message of reducer.handle(session, event)) bridge.send(message)
      } catch (error) {
        logger.error?.('maid-whale companion failed to handle session event', error)
      }
    }) as (...args: never[]) => void,
    { global: true },
  )
  const offDisposed = eventCtx.on('session/disposed', ((session: unknown) => {
    if (!bridge || !reducer) return
    try {
      for (const message of reducer.disposeSession(session)) bridge.send(message)
    } catch (error) {
      logger.error?.('maid-whale companion failed to dispose session', error)
    }
  }) as (...args: never[]) => void)

  const unwatch = settings.watch((next) => {
    // Disabling is the only path that tears the helper down. Every other
    // setting is applied live through a CONFIG message, so sliders never
    // restart the pet. Starting a previously-disabled runtime is debounced
    // to avoid spawning repeatedly while settings settle.
    if (next.enabled === false) {
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      stopRuntime('settings-change')
      return
    }
    if (!bridge) {
      scheduleRestart(next)
      return
    }
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = undefined
    }
    applyLiveSettings(next)
  })
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      const server = webCtx as unknown as WebServerService
      server.effect(
        () =>
          server.webServer.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: createConfigHandler(settings) }),
        'maid-whale-webui: local companion settings endpoint',
      )
    })
  }
  ctx.effect?.(
    () => () => {
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = undefined
      offEvent?.()
      offDisposed?.()
      unwatch()
      stopRuntime('dsh-host-stop')
    },
    'ui-skin-maid-whale-webui: companion lifecycle',
  )
}

export function apply(ctx: unknown, config: CompanionConfig = {}): void {
  const context = ctx as MinimalContext
  if (typeof context.inject === 'function') {
    context.inject(['settings'], (settingsCtx: unknown) => mount(settingsCtx as MinimalContext, config, context))
    return
  }
  mount(context, config)
}

export { CompanionReducer, CompanionState, HelperProcess }
