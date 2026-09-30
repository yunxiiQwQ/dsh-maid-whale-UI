import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HelperProcess, isWsl, resolveHelperLaunch } from '../src/host/helper-process.js'
import { CompanionMessageKind, CompanionState, createMessage } from '../src/host/protocol.js'

const fakeNodeHelper = [
  "const readline = require('node:readline')",
  "const out = (line) => process.stdout.write(JSON.stringify(line) + '\\n')",
  "out({ protocolVersion: 1, kind: 'ready' })",
  "readline.createInterface({ input: process.stdin }).on('line', (line) => process.stdout.write(line))",
].join('; ')

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  throw new Error('timed out waiting for helper condition')
}

describe('helper process launch resolution', () => {
  it('detects WSL without throwing', () => {
    expect(typeof isWsl()).toBe('boolean')
  })

  it('does not auto-launch an unprovisioned Python helper on ordinary Linux', () => {
    const launch = resolveHelperLaunch({
      platform: 'linux',
      isWslEnv: false,
      bundledPath: '/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
      helperPath: '/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => true,
    })
    expect(launch).toBeUndefined()
  })

  it('does not launch the bundled x64 helper on Windows ARM64', () => {
    const launch = resolveHelperLaunch({
      platform: 'win32',
      arch: 'arm64',
      isWslEnv: false,
      bundledPath: 'C:/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
      helperPath: 'C:/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => true,
    })
    expect(launch).toBeUndefined()
  })

  it('prefers the bundled executable on win32 when it exists', () => {
    const launch = resolveHelperLaunch({
      platform: 'win32',
      isWslEnv: false,
      bundledPath: 'C:/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
      helperPath: 'C:/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => true,
    })
    expect(launch).toEqual({ command: 'C:/app/runtime/bin/win32-x64/dsw-drool-helper.exe', args: [] })
  })

  it('falls back to the python interpreter without a bundled executable', () => {
    const launch = resolveHelperLaunch({
      platform: 'win32',
      isWslEnv: false,
      bundledPath: 'C:/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
      helperPath: 'C:/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => false,
    })!
    expect(launch.command).toBe('py')
    // defaultArgs keys off the REAL process platform (vendored behavior), so
    // the '-3' launcher flag only appears when the suite itself runs on win32.
    expect(launch.args).toEqual(
      process.platform === 'win32' ? ['-3', 'C:/app/runtime/helper.py'] : ['C:/app/runtime/helper.py'],
    )
  })

  it('launches the bundled executable through a fixed PowerShell expression from WSL', () => {
    const launch = resolveHelperLaunch({
      platform: 'linux',
      isWslEnv: true,
      bundledPath: '/mnt/c/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
      helperPath: '/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => true,
      windowsPath: (path: string) => `C:\\${path}`,
      powerShellExe: () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    })!
    expect(launch.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(launch.args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '& $env:DSH_DAFEIYU_HELPER_EXE',
    ])
    expect(launch.env).toEqual({
      DSH_DAFEIYU_HELPER_EXE: 'C:\\/mnt/c/app/runtime/bin/win32-x64/dsw-drool-helper.exe',
    })
  })

  it('quotes the WSL helper as one cmd command even when its path has metacharacters', () => {
    const launch = resolveHelperLaunch({
      platform: 'linux',
      isWslEnv: true,
      bundledPath: '/mnt/c/Whale & echo INJECTED/helper.exe',
      helperPath: '/app/runtime/helper.py',
      pythonEnv: undefined,
      fileExists: () => true,
      windowsPath: () => 'C:\\Whale & echo INJECTED\\helper.exe',
      powerShellExe: () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    })!
    expect(launch.args.join(' ')).not.toContain('INJECTED')
    expect(launch.env).toEqual({ DSH_DAFEIYU_HELPER_EXE: 'C:\\Whale & echo INJECTED\\helper.exe' })
  })

  it.runIf(process.platform === 'win32')('executes a metacharacter path without interpreting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'maid-whale-launch-'))
    const unsafeDirectory = join(root, 'Whale & echo INJECTED')
    const script = join(unsafeDirectory, 'helper.cmd')
    mkdirSync(unsafeDirectory)
    writeFileSync(script, '@echo SAFE_MARKER\r\n', 'ascii')
    try {
      const launch = resolveHelperLaunch({
        platform: 'linux',
        isWslEnv: true,
        bundledPath: '/mnt/c/Whale & echo INJECTED/helper.cmd',
        helperPath: '/app/runtime/helper.py',
        pythonEnv: undefined,
        fileExists: () => true,
        windowsPath: () => script,
        powerShellExe: () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      })!
      const result = spawnSync(launch.command, launch.args, {
        encoding: 'utf8',
        env: { ...process.env, ...launch.env },
        windowsHide: true,
      })
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('SAFE_MARKER')
      expect(result.stderr.trim()).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('helper process bridge', () => {
  it.each([false, true])(
    'bounds blocked writes and drains cleanly (stop while blocked: %s)',
    async (stopEarly) => {
      const source = [
        "console.log(JSON.stringify({ protocolVersion: 1, kind: 'ready' }))",
        "setTimeout(() => require('node:readline').createInterface({ input: process.stdin }).on('line', line => { const message = JSON.parse(line); console.log(JSON.stringify({ kind: message.kind, index: message.index })) }), 800)",
      ].join('; ')
      const bridge = new HelperProcess(
        { command: process.execPath, args: ['-e', source], heartbeatMs: 0, maxQueuedMessages: 4 },
        { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console,
      )
      const child = bridge.start()!
      const replies: string[] = []
      child.stdout.on('data', (chunk: Buffer) => replies.push(chunk.toString()))
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      try {
        await waitFor(() => bridge.spawned)
        for (let index = 0; index < 128; index += 1) {
          bridge.send(
            createMessage(CompanionMessageKind.STATE, {
              state: CompanionState.WORKING,
              message: 'x'.repeat(65536),
              index,
            }),
          )
        }
        for (let index = 0; index < 8; index += 1) {
          bridge.send(createMessage(CompanionMessageKind.PULSE, { state: CompanionState.SUCCESS, index }))
        }
        expect(child.stdin.writableLength).toBeLessThan(128 * 1024)
        expect(bridge.queue.length).toBeLessThanOrEqual(4)
        if (!stopEarly) {
          await waitFor(() => replies.join('').includes('"kind":"state","index":127'))
          await waitFor(() => replies.join('').includes('"kind":"pulse","index":7'))
        }
        bridge.stop('backpressure-test')
        await waitFor(() => replies.join('').includes('"kind":"shutdown"'))
        await closed
        expect(child.exitCode).toBe(0)
      } finally {
        bridge.stop('test-cleanup')
        if (child.exitCode === null) child.kill()
        await closed
      }
    },
    15000,
  )

  it('keeps only durable snapshots and a bounded transient queue before READY', () => {
    const bridge = new HelperProcess({ maxQueuedMessages: 4 }, console)
    for (let index = 0; index < 20; index += 1) {
      bridge.send(
        createMessage(CompanionMessageKind.STATE, {
          state: CompanionState.WORKING,
          message: `state-${index}`,
        }),
      )
      bridge.send(
        createMessage(CompanionMessageKind.PULSE, {
          state: CompanionState.SUCCESS,
          ttlMs: 1000,
          message: `pulse-${index}`,
        }),
      )
    }
    expect(bridge.snapshot.size).toBe(1)
    expect(bridge.queue).toHaveLength(4)
    expect(bridge.queue.at(-1)).toContain('pulse-19')
  })

  it('does not retain new traffic after restart suppression', () => {
    const bridge = new HelperProcess({ maxQueuedMessages: 4 }, console)
    bridge.restartSuppressed = true
    bridge.send(
      createMessage(CompanionMessageKind.PULSE, {
        state: CompanionState.ERROR,
        ttlMs: 1000,
      }),
    )
    expect(bridge.queue).toHaveLength(0)
  })

  it('queues messages before readiness, flushes them after, and shuts down cleanly', async () => {
    const replies: string[] = []
    const logger = { debug() {}, info() {}, warn() {}, error() {} }
    const bridge = new HelperProcess(
      {
        command: process.execPath,
        args: ['-e', fakeNodeHelper],
        heartbeatMs: 0,
      },
      logger as unknown as Console,
    )
    const child = bridge.start()
    expect(child).toBeDefined()
    if (!child) return
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      replies.push(...chunk.split(/\r?\n/))
    })
    const exited = new Promise<void>((resolveExit, rejectExit) => {
      child.once('exit', (code) =>
        code === 0 ? resolveExit() : rejectExit(new Error(`helper exited with ${String(code)}`)),
      )
      child.once('error', rejectExit)
    })

    const stateMessage = createMessage(CompanionMessageKind.STATE, {
      state: CompanionState.WORKING,
      message: 'running a test',
    })
    bridge.send(stateMessage)
    await waitFor(() => replies.some((line) => line.includes('"kind":"state"') && line.includes('running a test')))

    bridge.stop('test-complete')
    await exited
    expect(replies.some((line) => line.includes('"kind":"shutdown"'))).toBe(true)
  }, 15000)
})
