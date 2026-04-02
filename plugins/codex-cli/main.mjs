import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const CODEX_BIN = process.env.CRAFT_CODEX_BIN || 'codex'
const activeRequests = new Map()

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function safeCwd(requestedCwd) {
  if (typeof requestedCwd === 'string' && requestedCwd && existsSync(requestedCwd)) {
    return requestedCwd
  }
  return process.cwd()
}

function buildCodexArgs(message) {
  const args = ['exec', '--skip-git-repo-check', '--json']

  const resolvedCwd = safeCwd(message.cwd)
  if (resolvedCwd) {
    args.push('--cd', resolvedCwd)
  }

  if (message.model) {
    args.push('--model', message.model)
  }

  const prompt = typeof message.prompt === 'string' ? message.prompt : ''

  if (message.type === 'chat' && typeof message.sessionId === 'string' && message.sessionId.trim()) {
    args.push('resume', message.sessionId.trim(), prompt)
    return args
  }

  args.push(prompt)
  return args
}

function finishChat(state) {
  if (state.completed) return
  state.completed = true
  send({ type: 'event', event: { type: 'complete' } })
  send({ type: 'request_complete', requestId: state.requestId })
  activeRequests.delete(state.requestId)
}

function failRequest(state, message) {
  if (state.completed) return
  state.completed = true

  if (state.mode === 'mini') {
    send({
      type: 'mini_completion_result',
      requestId: state.requestId,
      text: null,
    })
  } else {
    send({
      type: 'error',
      requestId: state.requestId,
      message,
    })
    send({
      type: 'request_complete',
      requestId: state.requestId,
    })
  }

  activeRequests.delete(state.requestId)
}

function handleCodexEvent(state, payload) {
  switch (payload.type) {
    case 'thread.started':
      if (typeof payload.thread_id === 'string' && payload.thread_id) {
        state.sessionId = payload.thread_id
        send({ type: 'session_id', sessionId: payload.thread_id })
      }
      return

    case 'item.started':
      if (state.mode !== 'chat') return
      if (payload.item?.type === 'command_execution') {
        send({
          type: 'event',
          event: {
            type: 'tool_start',
            toolName: 'Bash',
            toolUseId: payload.item.id || `tool-${Date.now()}`,
            input: {
              command: payload.item.command || '',
            },
          },
        })
      }
      return

    case 'item.completed':
      if (payload.item?.type === 'command_execution') {
        if (state.mode === 'chat') {
          send({
            type: 'event',
            event: {
              type: 'tool_result',
              toolUseId: payload.item.id || `tool-${Date.now()}`,
              toolName: 'Bash',
              result: payload.item.aggregated_output || '',
              isError: (payload.item.exit_code ?? 0) !== 0 || payload.item.status === 'failed',
            },
          })
        }
        return
      }

      if (payload.item?.type === 'agent_message') {
        const text = typeof payload.item.text === 'string' ? payload.item.text : ''
        state.lastMessage = text
        if (state.mode === 'chat') {
          send({
            type: 'event',
            event: {
              type: 'text_complete',
              text,
            },
          })
        }
      }
      return

    case 'turn.completed':
      if (state.mode === 'mini') {
        state.completed = true
        send({
          type: 'mini_completion_result',
          requestId: state.requestId,
          text: state.lastMessage ?? null,
        })
        activeRequests.delete(state.requestId)
        return
      }

      finishChat(state)
      return
  }
}

function startCodexRequest(message, mode) {
  const args = buildCodexArgs(message)
  const child = spawn(CODEX_BIN, args, {
    cwd: safeCwd(message.cwd),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const state = {
    child,
    requestId: message.requestId,
    mode,
    completed: false,
    lastMessage: null,
    sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
    stderr: '',
  }

  activeRequests.set(message.requestId, state)

  const stdout = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  })

  stdout.on('line', (line) => {
    if (!line.trim()) return
    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      return
    }
    handleCodexEvent(state, payload)
  })

  child.stderr.on('data', (chunk) => {
    state.stderr += chunk.toString()
  })

  child.on('error', (error) => {
    failRequest(state, error instanceof Error ? error.message : String(error))
  })

  child.on('exit', (code, signal) => {
    if (state.completed) return
    const stderr = state.stderr.trim()
    if (code === 0) {
      if (state.mode === 'mini') {
        send({
          type: 'mini_completion_result',
          requestId: state.requestId,
          text: state.lastMessage ?? null,
        })
      } else {
        send({
          type: 'request_complete',
          requestId: state.requestId,
        })
      }
      activeRequests.delete(state.requestId)
      return
    }

    failRequest(
      state,
      stderr || `Codex CLI exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    )
  })
}

function abortActiveRequests() {
  for (const state of activeRequests.values()) {
    if (!state.child.killed) {
      state.child.kill('SIGTERM')
    }
    if (state.mode === 'mini') {
      send({
        type: 'mini_completion_result',
        requestId: state.requestId,
        text: null,
      })
    } else {
      send({
        type: 'request_complete',
        requestId: state.requestId,
      })
    }
    state.completed = true
  }
  activeRequests.clear()
}

const stdin = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

stdin.on('line', (line) => {
  if (!line.trim()) return

  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  switch (message.type) {
    case 'chat':
      startCodexRequest(message, 'chat')
      return
    case 'mini_completion':
      startCodexRequest(message, 'mini')
      return
    case 'abort':
      abortActiveRequests()
      return
  }
})

send({ type: 'ready' })
