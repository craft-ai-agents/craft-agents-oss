import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const DEFAULT_PROFILE = process.env.CRAFT_HERMES_PROFILE || 'craft-bridge'
const HERMES_BIN = process.env.CRAFT_HERMES_BIN || 'hermes'
const activeRequests = new Map()

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function getBaseUrl() {
  return process.env.CRAFT_HERMES_BASE_URL || 'http://127.0.0.1:8642'
}

function getTransport() {
  return process.env.CRAFT_HERMES_TRANSPORT === 'cli' ? 'cli' : 'api'
}

function getAuthHeaders() {
  const apiKey = process.env.CRAFT_HERMES_API_KEY
  if (!apiKey) return {}
  return { authorization: `Bearer ${apiKey}` }
}

function createChatState(message) {
  return {
    requestId: message.requestId,
    completed: false,
    mode: 'chat',
    abortController: null,
    child: null,
  }
}

function createMiniState(message) {
  return {
    requestId: message.requestId,
    completed: false,
    mode: 'mini',
    abortController: null,
    child: null,
  }
}

function finishChat(state) {
  if (state.completed) return
  state.completed = true
  send({ type: 'event', event: { type: 'complete' } })
  send({ type: 'request_complete', requestId: state.requestId })
  activeRequests.delete(state.requestId)
}

function finishMini(state, text) {
  if (state.completed) return
  state.completed = true
  send({ type: 'mini_completion_result', requestId: state.requestId, text })
  activeRequests.delete(state.requestId)
}

function failRequest(state, message) {
  if (state.completed) return
  state.completed = true

  if (state.mode === 'mini') {
    send({ type: 'mini_completion_result', requestId: state.requestId, text: null })
  } else {
    send({ type: 'error', requestId: state.requestId, message })
    send({ type: 'request_complete', requestId: state.requestId })
  }

  activeRequests.delete(state.requestId)
}

function buildResponsesInput(message) {
  return typeof message.prompt === 'string' ? message.prompt : ''
}

function buildRecoveryInput(message) {
  const history = Array.isArray(message.recoveryMessages) ? message.recoveryMessages : []
  const replay = history.map((entry) => ({
    role: entry.type === 'assistant' ? 'assistant' : 'user',
    content: entry.content || '',
  }))
  replay.push({
    role: 'user',
    content: typeof message.prompt === 'string' ? message.prompt : '',
  })
  return replay
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) {
    return payload.output_text
  }

  if (!Array.isArray(payload?.output)) {
    return ''
  }

  return payload.output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text)
    .filter((text) => typeof text === 'string' && text.length > 0)
    .join('')
}

async function callResponsesApi(message, state) {
  const abortController = new AbortController()
  state.abortController = abortController

  const headers = {
    'content-type': 'application/json',
    ...getAuthHeaders(),
  }

  const makeBody = (override = {}) => ({
    input: buildResponsesInput(message),
    instructions: typeof message.instructions === 'string' ? message.instructions : undefined,
    previous_response_id: typeof message.sessionId === 'string' && message.sessionId.trim()
      ? message.sessionId.trim()
      : undefined,
    store: true,
    ...override,
  })

  const endpoint = `${getBaseUrl().replace(/\/$/, '')}/v1/responses`
  let response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(makeBody()),
    signal: abortController.signal,
  })

  if (response.status === 404 && makeBody().previous_response_id) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(makeBody({
        input: buildRecoveryInput(message),
        previous_response_id: undefined,
      })),
      signal: abortController.signal,
    })
  }

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(bodyText || `Hermes API request failed with status ${response.status}`)
  }

  const payload = await response.json()
  if (state.mode === 'chat' && typeof payload?.id === 'string' && payload.id) {
    send({ type: 'session_id', sessionId: payload.id })
  }

  if (state.mode === 'mini') {
    finishMini(state, extractOutputText(payload) || null)
    return
  }

  send({
    type: 'event',
    event: {
      type: 'text_complete',
      text: extractOutputText(payload),
    },
  })
  finishChat(state)
}

function buildCliArgs(message) {
  const args = ['--profile', DEFAULT_PROFILE, 'chat', '-Q', '-q']
  if (typeof message.sessionId === 'string' && message.sessionId.trim()) {
    args.push('--resume', message.sessionId.trim())
  }
  args.push(typeof message.prompt === 'string' ? message.prompt : '')
  return args
}

function parseCliOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const sessionLine = [...lines].reverse().find((line) => line.startsWith('session_id:'))
  const sessionId = sessionLine ? sessionLine.slice('session_id:'.length).trim() : null
  const text = lines
    .filter((line) => !line.startsWith('session_id:'))
    .join('\n')
    .trim()

  return { sessionId, text }
}

function runCliRequest(message, state) {
  const child = spawn(HERMES_BIN, buildCliArgs(message), {
    cwd: typeof message.cwd === 'string' && message.cwd ? message.cwd : process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  state.child = child
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.on('error', (error) => {
    failRequest(state, error instanceof Error ? error.message : String(error))
  })
  child.on('exit', (code, signal) => {
    if (state.completed) return
    if (code !== 0) {
      failRequest(state, stderr.trim() || `Hermes CLI exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      return
    }

    const result = parseCliOutput(stdout)
    if (result.sessionId) {
      send({ type: 'session_id', sessionId: result.sessionId })
    }

    if (state.mode === 'mini') {
      finishMini(state, result.text || null)
      return
    }

    send({
      type: 'event',
      event: {
        type: 'text_complete',
        text: result.text,
      },
    })
    finishChat(state)
  })
}

function startChat(message) {
  const state = createChatState(message)
  activeRequests.set(message.requestId, state)

  if (getTransport() === 'cli') {
    runCliRequest(message, state)
    return
  }

  callResponsesApi(message, state).catch((error) => {
    failRequest(state, error instanceof Error ? error.message : String(error))
  })
}

function startMiniCompletion(message) {
  const state = createMiniState(message)
  activeRequests.set(message.requestId, state)

  if (getTransport() === 'cli') {
    runCliRequest(message, state)
    return
  }

  callResponsesApi(message, state).catch((error) => {
    failRequest(state, error instanceof Error ? error.message : String(error))
  })
}

function abortRequests() {
  for (const state of activeRequests.values()) {
    state.abortController?.abort()
    if (state.child && !state.child.killed) {
      state.child.kill('SIGTERM')
    }

    if (state.mode === 'mini') {
      finishMini(state, null)
    } else {
      send({ type: 'request_complete', requestId: state.requestId })
      activeRequests.delete(state.requestId)
    }
    state.completed = true
  }
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
      startChat(message)
      break
    case 'mini_completion':
      startMiniCompletion(message)
      break
    case 'abort':
      abortRequests()
      break
  }
})

send({ type: 'ready' })
