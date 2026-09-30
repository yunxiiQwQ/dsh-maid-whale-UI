import { describe, expect, it } from 'vitest'
import { CompanionReducer } from '../src/host/companion-reducer.js'
import { CompanionMessageKind, CompanionState } from '../src/host/protocol.js'

const session = { header: { id: 'session-main' } }

interface FakeEvent {
  type: string
  data: Record<string, unknown>
  seq: number
  time: number
}

function event(type: string, data: Record<string, unknown> = {}, seq = 0): FakeEvent {
  return { type, data, seq, time: Date.now() }
}

describe('companion reducer', () => {
  it('keeps waiting for approval when a parallel tool finishes', () => {
    const reducer = new CompanionReducer()
    reducer.handle(session, event('turn/start'))
    reducer.handle(session, event('tool/call', { callId: 'a', name: 'shell' }))
    reducer.handle(session, event('tool/call', { callId: 'b', name: 'read_file' }))
    const [waiting] = reducer.handle(session, event('approval/asked', { id: 'approval-a', toolName: 'shell' }))
    expect(waiting.state).toBe(CompanionState.WAITING)
    expect(reducer.handle(session, event('tool/result', { callId: 'b' }))).toEqual([])
    expect(reducer.handle(session, event('approval/decided', { id: 'unrelated' }))).toEqual([])
    const [resumed] = reducer.handle(session, event('approval/decided', { id: 'approval-a' }))
    expect(resumed.state).toBe(CompanionState.WORKING)
  })

  it('turn and tool events produce stable companion states', () => {
    const reducer = new CompanionReducer()
    expect(reducer.handle(session, event('turn/start', { turn: 1 }, 1))[0].state).toBe(CompanionState.THINKING)

    const working = reducer.handle(
      session,
      event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'shell_command' }, 2),
    )[0]
    expect(working.state).toBe(CompanionState.WORKING)
    expect(working.activity).toBe('commanding')

    const thinking = reducer.handle(
      session,
      event('tool/result', { turn: 1, step: 1, message: { toolCallId: 'call-1' } }, 3),
    )[0]
    expect(thinking.state).toBe(CompanionState.THINKING)

    const complete = reducer.handle(session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))[0]
    expect(complete.kind).toBe(CompanionMessageKind.PULSE)
    expect(complete.state).toBe(CompanionState.SUCCESS)
    expect(complete.resumeState).toBe(CompanionState.IDLE)
  })

  it('assistant chunks keep one stable thinking message within the same phase', () => {
    const reducer = new CompanionReducer()
    reducer.handle(session, event('turn/start', { turn: 1 }, 1))

    const [thinking] = reducer.handle(session, event('assistant/chunk', { message: { content: '第一段' } }, 2))
    expect(thinking.state).toBe(CompanionState.THINKING)
    expect(thinking.phase).toBe('thinking')

    expect(reducer.handle(session, event('assistant/chunk', { message: { content: '第二段' } }, 3))).toEqual([])
    expect(reducer.handle(session, event('assistant/message', { message: { content: '完整消息' } }, 4))).toEqual([])
  })

  it('tool result callId paths clear completed tools', () => {
    const reducer = new CompanionReducer()
    reducer.handle(session, event('turn/start', { turn: 1 }, 1))
    reducer.handle(session, event('tool/call', { callId: 'source-call', name: 'read_file' }, 2))

    const [afterSourceResult] = reducer.handle(
      session,
      event('tool/result', { message: { source: { callId: 'source-call' } } }, 3),
    )
    expect(afterSourceResult.state).toBe(CompanionState.THINKING)

    reducer.handle(session, event('tool/call', { callId: 'content-call', name: 'shell_command' }, 4))
    const [afterContentResult] = reducer.handle(
      session,
      event('tool/result', { message: { content: [{ type: 'tool-result', toolCallId: 'content-call' }] } }, 5),
    )
    expect(afterContentResult.state).toBe(CompanionState.THINKING)
  })

  it('question tools show waiting and resume on result or user response', () => {
    const reducer = new CompanionReducer()
    reducer.handle(session, event('turn/start', { turn: 1 }, 1))

    const [waitingForResult] = reducer.handle(
      session,
      event('tool/call', { callId: 'question-one', name: 'ask_user_question' }, 2),
    )
    expect(waitingForResult.state).toBe(CompanionState.WAITING)
    expect(waitingForResult.stage).toBe('等待确认')

    expect(
      reducer.handle(session, event('tool/result', { message: { source: { callId: 'unrelated-call' } } }, 3)),
    ).toEqual([])

    const [resumedFromResult] = reducer.handle(
      session,
      event('tool/result', { message: { source: { callId: 'question-one' } } }, 4),
    )
    expect(resumedFromResult.state).toBe(CompanionState.THINKING)

    const [waitingForUser] = reducer.handle(
      session,
      event('tool/call', { callId: 'question-two', name: 'request_user_input' }, 5),
    )
    expect(waitingForUser.state).toBe(CompanionState.WAITING)

    const [resumedFromUser] = reducer.handle(session, event('user/message', { message: { content: '继续' } }, 6))
    expect(resumedFromUser.state).toBe(CompanionState.THINKING)
  })

  it('tool failure pulses error without losing the underlying work state', () => {
    const reducer = new CompanionReducer()
    reducer.handle(session, event('turn/start', { turn: 1 }, 1))
    reducer.handle(session, event('tool/call', { callId: 'one', name: 'read_file' }, 2))
    reducer.handle(session, event('tool/call', { callId: 'two', name: 'write_file' }, 3))
    const [failure] = reducer.handle(
      session,
      event('tool/result', { message: { toolCallId: 'one' }, error: { name: 'ToolError', code: 'FAILED' } }, 4),
    )
    expect(failure.state).toBe(CompanionState.ERROR)
    expect(failure.resumeState).toBe(CompanionState.WORKING)
  })

  it('multi-session selection follows attention priority instead of latest-event order', () => {
    type CompanionMessage = {
      kind: string
      sessionId?: string
      state?: string
      tasks?: { sessionId: string; state: string }[]
    }
    const reducer = new CompanionReducer()
    const waiting = { header: { id: 'waiting-session' } }
    const working = { header: { id: 'working-session' } }

    reducer.handle(waiting, event('turn/start', { turn: 1 }, 1))
    const [blocked] = reducer.handle(
      waiting,
      event('turn/end', { turn: 1, reason: { kind: 'blocked' } }, 2),
    ) as CompanionMessage[]
    expect(blocked.state).toBe(CompanionState.WAITING)

    const [tasksAfterStart] = reducer.handle(working, event('turn/start', { turn: 1 }, 1)) as CompanionMessage[]
    expect(tasksAfterStart.kind).toBe(CompanionMessageKind.TASKS)
    expect(tasksAfterStart.tasks!.length).toBe(2)
    expect(tasksAfterStart.tasks![0].sessionId).toBe('waiting-session')
    const [tasksAfterTool] = reducer.handle(
      working,
      event('tool/call', { callId: 'call-working', name: 'shell_command' }, 2),
    ) as CompanionMessage[]
    expect(tasksAfterTool.kind).toBe(CompanionMessageKind.TASKS)
    expect(tasksAfterTool.tasks![0].state).toBe(CompanionState.WAITING)
    expect(tasksAfterTool.tasks![1].state).toBe(CompanionState.WORKING)

    const [revealed] = reducer.disposeSession(waiting) as CompanionMessage[]
    expect(revealed.sessionId).toBe('working-session')
    expect(revealed.state).toBe(CompanionState.WORKING)
  })
})
