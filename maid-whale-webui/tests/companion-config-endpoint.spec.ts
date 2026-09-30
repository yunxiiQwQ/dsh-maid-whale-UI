import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CONFIG_ENDPOINT, Config, createConfigHandler } from '../src/index.ts'

interface FixtureValue {
  enabled: boolean
  scale: number
  bubbleScale: number
  activityLevel: string
  reducedMotion: boolean
  includeSubagents: boolean
}

function settingsFixture() {
  let value: FixtureValue = {
    enabled: true,
    scale: 1,
    bubbleScale: 1,
    activityLevel: 'normal',
    reducedMotion: false,
    includeSubagents: false,
  }
  return {
    get: () => ({ ...value }),
    update: async (patch: Record<string, unknown>) => {
      value = { ...value, ...(patch as Partial<FixtureValue>) }
    },
    watch: () => () => {},
  }
}

interface HandlerResult {
  status: number | undefined
  body: Record<string, unknown>
}

type ConfigHandler = ReturnType<typeof createConfigHandler>

async function request(
  handler: ConfigHandler,
  {
    method = 'GET',
    body = '',
    address = '127.0.0.1',
    host = '127.0.0.1:2026',
    origin,
  }: { method?: string; body?: string; address?: string; host?: string; origin?: string } = {},
): Promise<HandlerResult> {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as Readable & {
    method: string
    socket: { remoteAddress: string }
    headers: Record<string, string>
  }
  req.method = method
  req.socket = { remoteAddress: address }
  req.headers = { host, ...(origin ? { origin } : {}) }
  let status: number | undefined
  let payload = ''
  const res = {
    writeHead(code: number) {
      status = code
    },
    end(chunk = '') {
      payload += chunk
    },
  }
  await handler(req, res)
  return { status, body: JSON.parse(payload) as Record<string, unknown> }
}

describe('companion local config endpoint', () => {
  it.each(['audit.invalid:2026', 'localhost.audit.invalid:2026', 'audit.invalid@localhost:2026', ''])(
    'rejects untrusted Host %s even without an Origin',
    async (host) => {
      const settings = settingsFixture()
      const handler = createConfigHandler(settings)
      expect((await request(handler, { host })).status).toBe(403)
      const result = await request(handler, {
        host,
        origin: `http://${host}`,
        method: 'PATCH',
        body: '{"enabled":false}',
      })
      expect(result.status).toBe(403)
      expect(settings.get().enabled).toBe(true)
    },
  )

  it.each(['localhost:2026', '127.0.0.1:2026', '[::1]:2026'])('accepts loopback Host %s', async (host) => {
    const result = await request(createConfigHandler(settingsFixture()), {
      host,
      origin: `http://${host}`,
      method: 'PATCH',
      body: '{"enabled":false}',
    })
    expect(result.status).toBe(200)
    expect(result.body.enabled).toBe(false)
  })

  it('exposes the endpoint under the plugin namespace', () => {
    expect(CONFIG_ENDPOINT).toBe('/plugins/maid-whale-webui/config')
  })

  it('reads and persists an allowed patch', async () => {
    const settings = settingsFixture()
    const handler = createConfigHandler(settings)
    const initial = await request(handler)
    expect(initial.status).toBe(200)
    expect(initial.body.enabled).toBe(true)

    const changed = await request(handler, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, scale: 0.8, bubbleScale: 0.8 }),
      origin: 'http://127.0.0.1:2026',
    })
    expect(changed.status).toBe(200)
    expect(changed.body.enabled).toBe(false)
    expect(changed.body.scale).toBe(0.8)
    expect(changed.body.bubbleScale).toBe(0.8)
  })

  it('uses the requested pet and bubble sizes when no saved sizes exist', async () => {
    const initial = Config({})
    expect(initial.scale).toBe(0.6552)
    expect(initial.bubbleScale).toBe(0.78)
    expect(Config({ scale: 0.6552, bubbleScale: 0.78 }).scale).toBe(0.6552)
    expect(Config({ scale: 0.6552, bubbleScale: 0.78 }).bubbleScale).toBe(0.78)
  })

  it('rejects remote, cross-origin, and unknown writes', async () => {
    const handler = createConfigHandler(settingsFixture())
    expect((await request(handler, { address: '192.168.1.8' })).status).toBe(403)
    expect((await request(handler, { origin: 'https://example.com' })).status).toBe(403)
    expect((await request(handler, { method: 'PATCH', body: '{"surprise":true}' })).status).toBe(400)
  })
})
