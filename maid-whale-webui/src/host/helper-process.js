import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { CompanionMessageKind, createMessage, encodeMessage } from './protocol.js'
import { lowIntegrityEnvironment } from './windows-helper-env.js'

// Vendored from QCYTSN/dsh-dafeiyu (MIT). The DSH_DAFEIYU_* environment variable
// names are the runtime contract read by runtime/helper.py; renaming them here
// without the Python side would silently drop every configuration flag.
// This module runs from two layouts: unbundled at src/host/ (package root is
// two levels up) and bundled into lib/index.js (package root is one level
// up). Probe for runtime/helper.py so both resolve the same package root.
const here = dirname(fileURLToPath(import.meta.url))
const packageRoot =
  [resolve(here, '..'), resolve(here, '..', '..')].find((root) => existsSync(resolve(root, 'runtime', 'helper.py'))) ??
  resolve(here, '..')
const defaultHelperPath = resolve(packageRoot, 'runtime', 'helper.py')
const bundledHelperPath = resolve(packageRoot, 'runtime', 'bin', 'win32-x64', 'dsw-drool-helper.exe')
const DURABLE_MESSAGE_KINDS = new Set([
  CompanionMessageKind.HELLO,
  CompanionMessageKind.STATE,
  CompanionMessageKind.TASK,
  CompanionMessageKind.TASKS,
  CompanionMessageKind.CONFIG,
])

function isWsl() {
  if (process.platform !== 'linux') return false
  try {
    return readFileSync('/proc/sys/fs/binfmt_misc/WSLInterop', 'utf8').includes('enabled')
  } catch {
    try {
      return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
    } catch {
      return false
    }
  }
}

function toWindowsPath(path) {
  return execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim()
}

function defaultPowerShellExe({ wslpath = defaultWslPath, fileExists = existsSync } = {}) {
  // WSL visual mode launches the bundled EXE through Windows PowerShell.
  // Keep the executable path in an environment variable so it remains data:
  // interpolating it into cmd.exe syntax would let metacharacters become code.
  try {
    const candidate = wslpath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    if (candidate && fileExists(candidate)) return candidate
  } catch {
    // Fall through to the bare-name fallback below.
  }
  return 'powershell.exe'
}

function defaultWslPath(...args) {
  return execFileSync('wslpath', args, { encoding: 'utf8' }).trim()
}

function resolveHelperLaunch({
  platform,
  arch = process.arch,
  isWslEnv,
  bundledPath,
  helperPath,
  pythonEnv,
  headless = false,
  fileExists = existsSync,
  windowsPath = toWindowsPath,
  powerShellExe = defaultPowerShellExe,
}) {
  const supportsBundledHelper = arch === 'x64' && (platform === 'win32' || (platform === 'linux' && isWslEnv))
  if (platform === 'win32' && supportsBundledHelper && fileExists(bundledPath)) {
    return { command: bundledPath, args: [] }
  }
  if (platform === 'linux' && isWslEnv && supportsBundledHelper && !headless && fileExists(bundledPath)) {
    // npm archives created on Windows store ordinary files as 0644. Launching
    // the EXE directly from WSL can therefore fail with EACCES. PowerShell
    // opens the Windows path without relying on the Linux executable bit and
    // keeps stdin/stdout attached for the companion protocol. The fixed
    // expression contains no path text, so shell metacharacters stay inert.
    return {
      command: powerShellExe(),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& $env:DSH_DAFEIYU_HELPER_EXE'],
      env: { DSH_DAFEIYU_HELPER_EXE: windowsPath(bundledPath) },
    }
  }
  if (!supportsBundledHelper && !pythonEnv) return undefined
  const command = pythonEnv || (platform === 'win32' ? 'py' : 'python3')
  return { command, args: defaultArgs(command, helperPath) }
}

function defaultLaunch(headless = false) {
  return resolveHelperLaunch({
    platform: process.platform,
    isWslEnv: isWsl(),
    bundledPath: bundledHelperPath,
    helperPath: defaultHelperPath,
    pythonEnv: process.env.DSH_DAFEIYU_PYTHON,
    headless,
  })
}

function defaultArgs(command, helperPath) {
  if (command === bundledHelperPath) return []
  if (process.platform === 'win32' && /(^|[\\/])py(?:\.exe)?$/i.test(command)) {
    return ['-3', helperPath]
  }
  return [helperPath]
}

export class HelperProcess {
  constructor(options = {}, logger = console) {
    this.options = options
    this.logger = logger
    this.child = undefined
    this.queue = []
    this.snapshot = new Map()
    this.pending = new Map()
    this.spawned = false
    this.stopping = false
    this.restartSuppressed = false
    this.startFailures = 0
    this.restartTimer = undefined
    this.heartbeatTimer = undefined
    this.startupTimer = undefined
    this.lastPongAt = 0
    this.recoveryAttempted = false
    this.recoveryEnv = undefined
    this.diagnostic = { stderr: '' }
    this.diagnosticPath =
      options.diagnosticPath ??
      (process.platform === 'win32' && !options.command && process.env.LOCALAPPDATA
        ? resolve(process.env.LOCALAPPDATA, 'DSH', 'maid-whale-webui', 'helper-startup.json')
        : undefined)
  }

  start() {
    if (this.child || this.stopping || this.restartSuppressed) return this.child
    // Resolving the launch command can throw synchronously (e.g. WSL interop
    // probing). Never let that escape: it would crash the host when it happens
    // inside the restart timer. Treat it like any other start failure instead.
    let child
    let command
    let env
    let tempDirectoryFailed = false
    try {
      const headless = this.options.headless ?? process.env.DSH_DAFEIYU_HEADLESS === '1'
      const helperPath = this.options.helperPath || defaultHelperPath
      const launch = this.options.command
        ? { command: this.options.command, args: defaultArgs(this.options.command, helperPath) }
        : defaultLaunch(headless)
      if (!launch) {
        this.restartSuppressed = true
        this.logger.info?.('companion helper is disabled on this platform')
        return undefined
      }
      command = launch.command
      const args = this.options.args || launch.args
      const extraArgs = []
      const eventLog = this.options.eventLog || process.env.DSH_DAFEIYU_EVENT_LOG
      const snapshot = this.options.snapshot || process.env.DSH_DAFEIYU_SNAPSHOT
      if (headless) extraArgs.push('--headless')
      if (eventLog) extraArgs.push('--event-log', eventLog)
      if (snapshot) extraArgs.push('--snapshot', snapshot)

      env = { ...process.env, ...this.options.env, ...launch.env }
      // Recheck after a crash/restart: a replaced EXE may have a different label.
      if (this.recoveryEnv) this.recoveryEnv = lowIntegrityEnvironment(command, env)
      Object.assign(env, this.recoveryEnv)
      this.#recordDiagnostic({
        command,
        startedAt: new Date().toISOString(),
        temp: env.TMP || env.TEMP,
        readyAt: undefined,
        exitCode: undefined,
        signal: undefined,
        error: undefined,
      })
      child = spawn(command, [...args, ...extraArgs], {
        cwd: this.options.cwd || packageRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      this.child = undefined
      this.spawned = false
      this.logger.error?.(`companion helper failed to start: ${error.message}`)
      this.#recordDiagnostic({ error: error.message })
      if (!this.stopping && !this.restartSuppressed) {
        this.#countStartFailure(`launch error: ${error.message}`)
      }
      return undefined
    }
    this.child = child
    // A broken pipe on any child channel must never crash the DSH host.
    // EPIPE on stdin is expected after the helper dies before we flush.
    child.stdin.on('error', () => {})
    child.stdin.on('drain', () => {
      if (this.child === child) this.#flushOutgoing()
    })
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.once('spawn', () => {
      const startupTimeoutMs = this.options.startupTimeoutMs ?? 60000
      this.startupTimer = setTimeout(() => {
        if (this.child === child && !this.spawned) {
          this.logger.warn?.('companion helper readiness timed out')
          this.#recordDiagnostic({ error: 'readiness timed out' })
          child.kill()
        }
      }, startupTimeoutMs)
      this.startupTimer.unref?.()
    })
    child.once('error', (error) => {
      this.logger.error?.(`companion helper failed to start: ${error.message}`)
      this.#recordDiagnostic({ error: error.message })
      if (this.child !== child) return
      this.child = undefined
      this.spawned = false
      this.#clearHeartbeat()
      this.#clearStartupTimer()
      if (!this.stopping && !this.restartSuppressed) {
        this.#countStartFailure(`spawn error: ${error.message}`)
      }
    })
    // close follows stderr EOF, so even a fast bootloader failure is available
    // before deciding whether to retry with the Low-integrity environment.
    child.once('close', (code, signal) => {
      if (this.child !== child) return
      this.child = undefined
      const wasReady = this.spawned
      this.spawned = false
      this.#clearHeartbeat()
      this.#clearStartupTimer()
      this.#recordDiagnostic({ exitCode: code, signal })
      if (!this.stopping && !this.restartSuppressed) {
        if (!wasReady) {
          if (process.platform === 'win32' && tempDirectoryFailed && !this.recoveryAttempted) {
            this.recoveryAttempted = true
            try {
              this.recoveryEnv = lowIntegrityEnvironment(command, env)
              if (this.recoveryEnv) {
                this.#recordDiagnostic({ recovery: 'low-integrity-temp' })
                this.logger.info?.('companion helper has a Low integrity label; retrying with LocalLow storage')
                this.#scheduleRestart()
                return
              }
            } catch (error) {
              this.#recordDiagnostic({ recoveryError: error.message })
              this.logger.warn?.(`companion helper integrity check failed: ${error.message}`)
            }
          }
          // The helper never became ready during this attempt (crashed before
          // READY or timed out). Count it as a failed start so a broken
          // helper cannot restart forever.
          this.#countStartFailure(`exited before ready (code=${String(code)}, signal=${String(signal)})`)
          return
        }
        this.logger.warn?.(`companion helper exited (code=${String(code)}, signal=${String(signal)}); restarting`)
        this.#scheduleRestart()
      }
    })
    createInterface({ input: child.stdout }).on('line', (line) => this.#handleReply(line))
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) this.logger.warn?.(`companion helper: ${line}`)
      if (!this.spawned) {
        tempDirectoryFailed ||= /\[PYI-\d+:ERROR\] Could not create temporary directory!/.test(line)
        this.#recordDiagnostic({ stderr: `${this.diagnostic.stderr}${line}\n`.slice(-4096) })
      }
    })
    return child
  }

  send(message) {
    if (this.stopping || this.restartSuppressed) return
    const line = encodeMessage(message)
    const durable = DURABLE_MESSAGE_KINDS.has(message.kind)
    if (durable) this.snapshot.set(message.kind, line)
    if (
      !this.child ||
      !this.spawned ||
      !this.child.stdin.writable ||
      this.child.stdin.destroyed ||
      this.child.stdin.writableNeedDrain
    ) {
      if (durable) this.pending.set(message.kind, line)
      else this.#enqueue(line)
      return
    }
    this.child.stdin.write(line)
  }

  #recordDiagnostic(fields) {
    Object.assign(this.diagnostic, fields)
    if (!this.diagnosticPath) return
    try {
      mkdirSync(dirname(this.diagnosticPath), { recursive: true })
      writeFileSync(this.diagnosticPath, `${JSON.stringify(this.diagnostic, null, 2)}\n`)
    } catch (error) {
      this.logger.warn?.(`companion helper diagnostic could not be saved: ${error.message}`)
    }
  }

  stop(reason = 'plugin-disposed') {
    this.stopping = true
    this.#clearHeartbeat()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    if (!child) return
    this.pending.clear()
    this.queue = [encodeMessage(createMessage(CompanionMessageKind.SHUTDOWN, { reason }))]
    this.#flushOutgoing()
    const timer = setTimeout(() => {
      if (this.child === child) child.kill()
    }, this.options.shutdownTimeoutMs ?? 10000)
    timer.unref?.()
  }

  #enqueue(line) {
    const limit = Math.max(0, this.options.maxQueuedMessages ?? 64)
    if (limit === 0) return
    this.queue.push(line)
    if (this.queue.length > limit) this.queue.splice(0, this.queue.length - limit)
  }

  #flushOutgoing() {
    const child = this.child
    if (!this.spawned || !child?.stdin.writable || child.stdin.destroyed || child.stdin.writableNeedDrain) return
    // A false write result means the line was accepted, but subsequent lines
    // must wait for drain. Coalesce durable updates while that pipe is full.
    for (const [kind, line] of this.pending) {
      this.pending.delete(kind)
      if (!child.stdin.write(line)) return
    }
    while (this.queue.length) {
      if (!child.stdin.write(this.queue.shift())) return
    }
    if (this.stopping) this.#endInput(child)
  }

  #handleReply(line) {
    if (!line.trim()) return
    try {
      const reply = JSON.parse(line)
      if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.READY) {
        if (this.spawned) return
        this.spawned = true
        this.#recordDiagnostic({ readyAt: new Date().toISOString(), exitCode: undefined, signal: undefined })
        this.startFailures = 0
        this.lastPongAt = Date.now()
        this.#clearStartupTimer()
        this.pending = new Map(this.stopping ? [] : this.snapshot)
        this.#flushOutgoing()
        if (!this.stopping) this.#startHeartbeat()
        return
      }
      if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.PONG) {
        this.lastPongAt = Date.now()
        return
      }
      if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.CLOSED) {
        this.restartSuppressed = true
        return
      }
    } catch {
      // Non-protocol stdout is still useful in development logs.
    }
    this.logger.debug?.(`companion helper: ${line}`)
  }

  #startHeartbeat() {
    const heartbeatMs = this.options.heartbeatMs ?? 5000
    if (heartbeatMs <= 0) return
    const timeoutMs = this.options.heartbeatTimeoutMs ?? Math.max(heartbeatMs * 3, 12000)
    this.heartbeatTimer = setInterval(() => {
      const child = this.child
      if (!child || !this.spawned) return
      if (Date.now() - this.lastPongAt > timeoutMs) {
        this.logger.warn?.('companion helper heartbeat timed out')
        child.kill()
        return
      }
      this.send(createMessage(CompanionMessageKind.PING))
    }, heartbeatMs)
    this.heartbeatTimer.unref?.()
  }

  #clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  #clearStartupTimer() {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = undefined
  }

  #countStartFailure(reason) {
    this.startFailures += 1
    const maxFailures = this.options.maxStartFailures ?? 5
    if (this.startFailures >= maxFailures) {
      this.restartSuppressed = true
      this.queue.length = 0
      this.logger.error?.(`companion helper failed to start ${this.startFailures} times; giving up (${reason})`)
      return
    }
    this.logger.warn?.(
      `companion helper failed to start; scheduling restart (${this.startFailures}/${maxFailures}) (${reason})`,
    )
    this.#scheduleRestart()
  }

  #scheduleRestart() {
    if (this.restartTimer || this.stopping || this.restartSuppressed) return
    const delay = this.options.restartDelayMs ?? 750
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.start()
    }, delay)
    this.restartTimer.unref?.()
  }

  #endInput(child) {
    if (child.stdin.writable && !child.stdin.destroyed) child.stdin.end()
  }
}

export {
  bundledHelperPath,
  defaultHelperPath,
  defaultArgs,
  defaultPowerShellExe,
  defaultLaunch,
  isWsl,
  resolveHelperLaunch,
  toWindowsPath,
}
