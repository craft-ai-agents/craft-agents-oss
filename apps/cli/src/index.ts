#!/usr/bin/env bun
/**
 * craft-cli — Terminal client for Craft Agent server.
 *
 * Connects over WebSocket (ws:// or wss://) to a running Craft Agent server
 * and provides commands for listing resources, managing sessions, sending
 * messages with real-time streaming, and validating server health.
 */

import { resolve } from 'path'
import { CliRpcClient } from './client.ts'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  url: string
  token: string
  workspace?: string
  timeout: number
  json: boolean
  tlsCa?: string
  sendTimeout: number
  command: string
  rest: string[]
  // run-specific flags
  sources: string[]
  mode: string
  outputFormat: string
  noCleanup: boolean
  serverEntry?: string
  workspaceDir?: string
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2) // skip bun + script path
  let url = ''
  let token = ''
  let workspace: string | undefined
  let timeout = 10_000
  let json = false
  let tlsCa: string | undefined
  let sendTimeout = 300_000 // 5 min
  const rest: string[] = []
  let command = ''
  const sources: string[] = []
  let mode = ''
  let outputFormat = 'text'
  let noCleanup = false
  let serverEntry: string | undefined
  let workspaceDir: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--url':
        url = args[++i] ?? ''
        break
      case '--token':
        token = args[++i] ?? ''
        break
      case '--workspace':
        workspace = args[++i]
        break
      case '--timeout':
        timeout = parseInt(args[++i] ?? '10000', 10)
        break
      case '--json':
        json = true
        break
      case '--tls-ca':
        tlsCa = args[++i]
        break
      case '--send-timeout':
        sendTimeout = parseInt(args[++i] ?? '300000', 10)
        break
      case '--source':
        sources.push(args[++i] ?? '')
        break
      case '--mode':
        mode = args[++i] ?? ''
        break
      case '--output-format':
        outputFormat = args[++i] ?? 'text'
        break
      case '--no-cleanup':
        noCleanup = true
        break
      case '--server-entry':
        serverEntry = args[++i]
        break
      case '--workspace-dir':
        workspaceDir = args[++i]
        break
      case '--help':
      case '-h':
        command = 'help'
        break
      case '--version':
        command = 'version'
        break
      case '--validate-server':
        command = 'validate'
        break
      default:
        if (!command && !arg.startsWith('-')) {
          command = arg
        } else {
          rest.push(arg)
        }
    }
  }

  // Env var fallbacks
  if (!url) url = process.env.CRAFT_SERVER_URL ?? ''
  if (!token) token = process.env.CRAFT_SERVER_TOKEN ?? ''
  if (!tlsCa) tlsCa = process.env.CRAFT_TLS_CA

  return { url, token, workspace, timeout, json, tlsCa, sendTimeout, command, rest, sources, mode, outputFormat, noCleanup, serverEntry, workspaceDir }
}

// ---------------------------------------------------------------------------
// Auto workspace resolution
// ---------------------------------------------------------------------------

async function resolveWorkspace(
  client: CliRpcClient,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) {
    // Bind client to the workspace so push events reach us
    await client.invoke('window:switchWorkspace', explicit).catch(() => {})
    return explicit
  }
  try {
    const workspaces = (await client.invoke('workspaces:get')) as any[]
    if (workspaces?.length > 0) {
      const id = workspaces[0].id
      await client.invoke('window:switchWorkspace', id).catch(() => {})
      return id
    }
  } catch {
    // Fall through — workspace may not be needed
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function out(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n')
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  }
}

function err(msg: string): void {
  process.stderr.write(`Error: ${msg}\n`)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdPing(client: CliRpcClient, args: CliArgs): Promise<void> {
  const start = performance.now()
  const clientId = await client.connect()
  const latency = Math.round(performance.now() - start)
  out(
    args.json
      ? { clientId, latencyMs: latency }
      : `Connected: clientId=${clientId} latency=${latency}ms`,
    args.json,
  )
}

async function cmdHealth(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const result = await client.invoke('credentials:healthCheck')
  out(result, args.json)
}

async function cmdVersions(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const result = await client.invoke('system:versions')
  out(result, args.json)
}

async function cmdWorkspaces(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const result = (await client.invoke('workspaces:get')) as any[]
  if (args.json) {
    out(result, true)
  } else {
    if (!result?.length) {
      out('No workspaces found', false)
      return
    }
    for (const ws of result) {
      out(`${ws.id}  ${ws.name ?? '(unnamed)'}  ${ws.path ?? ''}`, false)
    }
  }
}

async function cmdSessions(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const workspaceId = await resolveWorkspace(client, args.workspace)
  if (!workspaceId) {
    err('No workspace available. Use --workspace <id>')
    process.exit(1)
  }
  const result = (await client.invoke('sessions:get', workspaceId)) as any[]
  if (args.json) {
    out(result, true)
  } else {
    if (!result?.length) {
      out('No sessions found', false)
      return
    }
    for (const s of result) {
      const name = s.name ?? '(unnamed)'
      const preview = s.preview ? `  ${s.preview.slice(0, 60)}` : ''
      const status = s.isProcessing ? ' [processing]' : ''
      out(`${s.id}  ${name}${preview}${status}`, false)
    }
  }
}

async function cmdConnections(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const result = await client.invoke('LLM_Connection:list')
  out(result, args.json)
}

async function cmdSources(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const workspaceId = await resolveWorkspace(client, args.workspace)
  if (!workspaceId) {
    err('No workspace available. Use --workspace <id>')
    process.exit(1)
  }
  const result = await client.invoke('sources:get', workspaceId)
  out(result, args.json)
}

async function cmdSessionCreate(client: CliRpcClient, args: CliArgs): Promise<void> {
  await client.connect()
  const workspaceId = await resolveWorkspace(client, args.workspace)
  if (!workspaceId) {
    err('No workspace available. Use --workspace <id>')
    process.exit(1)
  }

  // Parse sub-args: --name <n>
  let name: string | undefined
  for (let i = 0; i < args.rest.length; i++) {
    if (args.rest[i] === '--name') name = args.rest[++i]
  }

  const opts: Record<string, unknown> = {}
  if (name) opts.name = name
  if (args.mode) opts.permissionMode = args.mode

  const result = await client.invoke('sessions:create', workspaceId, opts)
  out(result, args.json)
}

async function cmdSessionMessages(client: CliRpcClient, args: CliArgs): Promise<void> {
  const sessionId = args.rest[0]
  if (!sessionId) {
    err('Usage: session messages <session-id>')
    process.exit(1)
  }
  await client.connect()
  const result = await client.invoke('sessions:getMessages', sessionId)
  out(result, args.json)
}

async function cmdSessionDelete(client: CliRpcClient, args: CliArgs): Promise<void> {
  const sessionId = args.rest[0]
  if (!sessionId) {
    err('Usage: session delete <session-id>')
    process.exit(1)
  }
  await client.connect()
  await client.invoke('sessions:delete', sessionId)
  out(args.json ? { deleted: sessionId } : `Deleted session: ${sessionId}`, args.json)
}

/**
 * Read prompt text from positional args + stdin.
 * If there are positional words, they become the base message.
 * Reads stdin when: --stdin flag is present, or no message and stdin is piped (not a TTY).
 */
async function readPrompt(words: string[], restArgs?: string[]): Promise<string> {
  let message = words.join(' ')

  const wantsStdin = restArgs?.includes('--stdin')
  const isTTY = typeof process.stdin.isTTY === 'boolean' ? process.stdin.isTTY : false
  if (wantsStdin || (!message && !isTTY)) {
    const chunks: string[] = []
    const reader = Bun.stdin.stream().getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
    const stdinText = chunks.join('')
    message = message ? `${message}\n${stdinText}` : stdinText
  }

  return message
}

/**
 * Subscribe to session events, send the message, stream output, wait for completion.
 * Returns the exit code (0 = success, 1 = error, 130 = interrupted).
 */
async function sendAndStream(
  client: CliRpcClient,
  sessionId: string,
  message: string,
  args: CliArgs,
): Promise<number> {
  let exitCode = 0
  let finished = false
  const streamJson = args.outputFormat === 'stream-json'

  const unsub = client.on('session:event', (event: unknown) => {
    const ev = event as { type: string; sessionId: string; [key: string]: unknown }
    if (ev.sessionId !== sessionId) return

    if (streamJson) {
      process.stdout.write(JSON.stringify(ev) + '\n')
    }

    switch (ev.type) {
      case 'text_delta':
        if (!streamJson) process.stdout.write(ev.delta as string)
        break
      case 'tool_start':
        if (!streamJson) process.stdout.write(`\n[tool: ${ev.toolName}${ev.toolIntent ? ` — ${ev.toolIntent}` : ''}]\n`)
        break
      case 'tool_result': {
        if (!streamJson) {
          const result = String(ev.result ?? '')
          if (result.length > 200) {
            process.stdout.write(`${result.slice(0, 200)}...\n`)
          } else if (result) {
            process.stdout.write(`${result}\n`)
          }
        }
        break
      }
      case 'error':
        if (!streamJson) err(String(ev.error))
        exitCode = 1
        finished = true
        break
      case 'complete':
        if (!streamJson) process.stdout.write('\n')
        finished = true
        break
      case 'interrupted':
        if (!streamJson) process.stdout.write('\n[interrupted]\n')
        exitCode = 130
        finished = true
        break
    }
  })

  await client.invoke('sessions:sendMessage', sessionId, message)

  const deadline = Date.now() + args.sendTimeout
  while (!finished && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }

  unsub()

  if (!finished) {
    err('Send timeout — no completion event received')
    exitCode = 1
  }

  return exitCode
}

async function cmdSend(client: CliRpcClient, args: CliArgs): Promise<void> {
  const sessionId = args.rest[0]
  if (!sessionId) {
    err('Usage: send <session-id> <message>')
    process.exit(1)
  }

  const message = await readPrompt(args.rest.slice(1), args.rest)
  if (!message.trim()) {
    err('No message provided')
    process.exit(1)
  }

  await client.connect()
  const exitCode = await sendAndStream(client, sessionId, message, args)
  client.destroy()
  process.exit(exitCode)
}

async function cmdRun(args: CliArgs): Promise<void> {
  const { spawnServer } = await import('./server-spawner.ts')

  // Prompt = all positional args (no session ID needed, unlike send)
  const message = await readPrompt(args.rest, args.rest)
  if (!message.trim()) {
    err('No prompt provided. Usage: run <message>')
    process.exit(1)
  }

  // Spawn headless server
  process.stderr.write('Starting server...\n')
  const server = await spawnServer({
    serverEntry: args.serverEntry,
    startupTimeout: args.timeout > 30_000 ? args.timeout : 30_000,
  })
  process.stderr.write(`Server ready: ${server.url}\n`)

  let client: CliRpcClient | undefined
  let sessionId: string | undefined

  const cleanup = async () => {
    if (sessionId && client?.isConnected && !args.noCleanup) {
      await client.invoke('sessions:delete', sessionId).catch(() => {})
    }
    client?.destroy()
    await server.stop()
  }

  // Signal handling — cancel + clean up on SIGINT/SIGTERM
  const onSignal = async () => {
    if (sessionId && client?.isConnected) {
      await client.invoke('sessions:cancel', sessionId).catch(() => {})
    }
    await cleanup()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    client = new CliRpcClient(server.url, {
      token: server.token,
      requestTimeout: args.timeout,
    })
    await client.connect()

    // Bootstrap workspace from directory if specified
    if (args.workspaceDir) {
      const absPath = resolve(args.workspaceDir)
      await client.invoke('workspaces:create', absPath, 'ci-workspace')
      process.stderr.write(`Workspace registered: ${absPath}\n`)
    }

    // Auto-setup LLM connection from ANTHROPIC_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey) {
      const connections = (await client.invoke('LLM_Connection:list')) as any[]
      if (!connections?.length) {
        const now = Date.now()
        await client.invoke('LLM_Connection:save', {
          slug: 'anthropic-api',
          name: 'Anthropic',
          providerType: 'anthropic',
          authType: 'api_key',
          createdAt: now,
        })
        await client.invoke('settings:setupLlmConnection', {
          slug: 'anthropic-api',
          credential: apiKey,
        })
        await client.invoke('LLM_Connection:setDefault', 'anthropic-api')
        process.stderr.write('LLM connection configured from ANTHROPIC_API_KEY\n')
      }
    }

    const workspaceId = await resolveWorkspace(client, args.workspace)
    if (!workspaceId) {
      err('No workspace found on server')
      process.exit(1)
    }

    const session = (await client.invoke('sessions:create', workspaceId, {
      permissionMode: args.mode || 'allow-all',
      enabledSourceSlugs: args.sources.length > 0 ? args.sources : undefined,
    })) as { id: string }
    sessionId = session.id

    const exitCode = await sendAndStream(client, sessionId, message, args)
    await cleanup()
    process.exit(exitCode)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err(msg)
    await cleanup()
    process.exit(1)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

async function cmdCancel(client: CliRpcClient, args: CliArgs): Promise<void> {
  const sessionId = args.rest[0]
  if (!sessionId) {
    err('Usage: cancel <session-id>')
    process.exit(1)
  }
  await client.connect()
  await client.invoke('sessions:cancel', sessionId)
  out(args.json ? { cancelled: sessionId } : `Cancelled: ${sessionId}`, args.json)
}

async function cmdInvoke(client: CliRpcClient, args: CliArgs): Promise<void> {
  const channel = args.rest[0]
  if (!channel) {
    err('Usage: invoke <channel> [json-args...]')
    process.exit(1)
  }
  await client.connect()

  // Parse remaining args as JSON
  const invokeArgs: unknown[] = []
  for (let i = 1; i < args.rest.length; i++) {
    try {
      invokeArgs.push(JSON.parse(args.rest[i]))
    } catch {
      invokeArgs.push(args.rest[i])
    }
  }

  const result = await client.invoke(channel, ...invokeArgs)
  out(result, args.json)
}

async function cmdListen(client: CliRpcClient, args: CliArgs): Promise<void> {
  const channel = args.rest[0]
  if (!channel) {
    err('Usage: listen <channel>')
    process.exit(1)
  }
  await client.connect()

  client.on(channel, (...eventArgs: unknown[]) => {
    out({ channel, args: eventArgs, timestamp: new Date().toISOString() }, true)
  })

  process.stdout.write(`Listening on ${channel} (Ctrl+C to stop)\n`)

  // Keep alive
  await new Promise(() => {
    // Never resolves — Ctrl+C exits
  })
}

// ---------------------------------------------------------------------------
// Validate server
// ---------------------------------------------------------------------------

export interface ValidateStep {
  name: string
  fn: (client: CliRpcClient, ctx: ValidateContext) => Promise<string>
}

export interface ValidateContext {
  workspaceId?: string
  workspaceRootPath?: string
  createdSessionId?: string
  createdSourceSlug?: string
  createdSkillSlug?: string
}

/**
 * Send a message and wait for streaming events.
 * Returns a summary of received event types.
 * If expectTool is true, validates that tool_start + tool_result events arrived.
 */
async function waitForSendEvents(
  client: CliRpcClient,
  sessionId: string,
  message: string,
  timeoutMs: number,
  expectTool: boolean,
  sendOptions?: Record<string, unknown>,
): Promise<string> {
  const seen = new Set<string>()
  let textChunks = 0
  let toolName = ''
  let finished = false

  const unsub = client.on('session:event', (event: unknown) => {
    const ev = event as { type: string; sessionId: string; [key: string]: unknown }
    if (ev.sessionId !== sessionId) return

    seen.add(ev.type)
    if (ev.type === 'text_delta') textChunks++
    if (ev.type === 'tool_start') toolName = String(ev.toolName ?? '')
    if (ev.type === 'complete' || ev.type === 'error' || ev.type === 'interrupted') {
      finished = true
    }
  })

  try {
    await client.invoke('sessions:sendMessage', sessionId, message,
      undefined, undefined, sendOptions)

    const deadline = Date.now() + timeoutMs
    while (!finished && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }

    if (!finished) throw new Error('Timed out waiting for completion')

    // Only treat as failure if error was the terminal event (no complete followed)
    if (seen.has('error') && !seen.has('complete')) throw new Error('Session returned an error event')

    if (expectTool) {
      if (!seen.has('tool_start')) throw new Error('No tool_start event received')
      if (!seen.has('tool_result')) throw new Error('No tool_result event received')
      return `tool=${toolName}, ${textChunks} text deltas, events: ${[...seen].join(', ')}`
    }

    if (!seen.has('text_delta')) throw new Error('No text_delta events received')
    return `${textChunks} text deltas, events: ${[...seen].join(', ')}`
  } finally {
    unsub()
  }
}

export function getValidateSteps(): ValidateStep[] {
  return [
    {
      name: 'Connect + handshake',
      fn: async (client) => {
        const start = performance.now()
        const clientId = await client.connect()
        const ms = Math.round(performance.now() - start)
        return `clientId: ${clientId}, ${ms}ms`
      },
    },
    {
      name: 'credentials:healthCheck',
      fn: async (client) => {
        const r = (await client.invoke('credentials:healthCheck')) as any
        return JSON.stringify(r)
      },
    },
    {
      name: 'system:versions',
      fn: async (client) => {
        const r = (await client.invoke('system:versions')) as any
        return r?.node ? `node=${r.node}` : JSON.stringify(r)
      },
    },
    {
      name: 'system:homeDir',
      fn: async (client) => {
        const r = await client.invoke('system:homeDir')
        return String(r)
      },
    },
    {
      name: 'workspaces:get',
      fn: async (client, ctx) => {
        const r = (await client.invoke('workspaces:get')) as any[]
        if (r?.length > 0) {
          ctx.workspaceId = r[0].id
          ctx.workspaceRootPath = r[0].rootPath ?? r[0].path
          // Bind this client to the workspace so push events (e.g. session:event)
          // routed { to: 'workspace' } reach us.
          await client.invoke('window:switchWorkspace', r[0].id)
        }
        return `${r?.length ?? 0} workspaces`
      },
    },
    {
      name: 'sessions:get',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId) return 'skipped (no workspace)'
        const r = (await client.invoke('sessions:get', ctx.workspaceId)) as any[]
        return `${r?.length ?? 0} sessions`
      },
    },
    {
      name: 'LLM_Connection:list',
      fn: async (client) => {
        const r = (await client.invoke('LLM_Connection:list')) as any[]
        return `${r?.length ?? 0} connections`
      },
    },
    {
      name: 'sources:get',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId) return 'skipped (no workspace)'
        const r = (await client.invoke('sources:get', ctx.workspaceId)) as any[]
        return `${r?.length ?? 0} sources`
      },
    },
    {
      name: 'sessions:create',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId) return 'skipped (no workspace)'
        const name = `__cli-validate-${Date.now()}`
        const r = (await client.invoke('sessions:create', ctx.workspaceId, {
          name,
          permissionMode: 'allow-all',
        })) as any
        ctx.createdSessionId = r?.id
        return ctx.createdSessionId ?? 'created'
      },
    },
    {
      name: 'sessions:getMessages',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId) return 'skipped (no session)'
        await client.invoke('sessions:getMessages', ctx.createdSessionId)
        return 'session readable'
      },
    },
    {
      name: 'send message + stream',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId) return 'skipped (no session)'
        return await waitForSendEvents(client, ctx.createdSessionId,
          'Reply with exactly: VALIDATION_OK', 60_000, false)
      },
    },
    {
      name: 'send message + tool use',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId) return 'skipped (no session)'
        return await waitForSendEvents(client, ctx.createdSessionId,
          'Use the Bash tool to run: echo TOOL_VALIDATION_OK', 90_000, true)
      },
    },
    // ----- Source lifecycle -----
    {
      name: 'sources:create',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId) return 'skipped (no workspace)'
        const r = (await client.invoke('sources:create', ctx.workspaceId, {
          name: 'Cat Facts',
          provider: 'catfact',
          type: 'api',
          api: { baseUrl: 'https://catfact.ninja', authType: 'none' },
          icon: '🐱',
        })) as any
        ctx.createdSourceSlug = r?.slug
        return ctx.createdSourceSlug ? `slug=${ctx.createdSourceSlug}` : JSON.stringify(r)
      },
    },
    {
      name: 'send + source mention',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId || !ctx.createdSourceSlug) return 'skipped (no session or source)'
        // Enable the source on the session
        await client.invoke('sessions:command', ctx.createdSessionId, {
          type: 'setSources',
          sourceSlugs: [ctx.createdSourceSlug],
        })
        return await waitForSendEvents(client, ctx.createdSessionId,
          `[source:${ctx.createdSourceSlug}] Get me a cat fact`, 90_000, false)
      },
    },
    // ----- Skill lifecycle -----
    {
      name: 'send + skill create',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId || !ctx.workspaceRootPath) return 'skipped (no session or workspace)'
        ctx.createdSkillSlug = '__cli-validate-skill'
        const sourceSlug = ctx.createdSourceSlug ?? 'cat-facts'
        const skillDir = `${ctx.workspaceRootPath}/skills/${ctx.createdSkillSlug}`
        // Use bash to create the skill file deterministically
        return await waitForSendEvents(client, ctx.createdSessionId,
          `Use the Bash tool to run this exact command:
mkdir -p "${skillDir}" && cat > "${skillDir}/SKILL.md" << 'SKILLEOF'
---
name: "CLI Validate Skill"
description: "Validation skill created by craft-cli"
requiredSources:
  - "${sourceSlug}"
---

This skill does two things:
1. Check the current water temperature of Lake Balaton (search the web or estimate based on the season)
2. Use the Cat Facts source to get a random cat fact

Always perform both steps when this skill is invoked.
SKILLEOF`, 90_000, true)
      },
    },
    {
      name: 'skills:get (verify)',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId || !ctx.createdSkillSlug) return 'skipped (no skill)'
        const r = (await client.invoke('skills:get', ctx.workspaceId)) as any[]
        const found = r?.find((s: any) => s.slug === ctx.createdSkillSlug)
        if (!found) throw new Error(`Skill '${ctx.createdSkillSlug}' not found in skills list`)
        return `found: ${found.name ?? found.slug}`
      },
    },
    {
      name: 'send + skill mention',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId || !ctx.createdSkillSlug) return 'skipped (no session or skill)'
        return await waitForSendEvents(client, ctx.createdSessionId,
          `[skill:${ctx.createdSkillSlug}] Run the skill`, 120_000, false,
          { skillSlugs: [ctx.createdSkillSlug] })
      },
    },
    {
      name: 'skills:delete',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId || !ctx.createdSkillSlug) return 'skipped (no skill)'
        await client.invoke('skills:delete', ctx.workspaceId, ctx.createdSkillSlug)
        return 'cleaned up'
      },
    },
    {
      name: 'sources:delete',
      fn: async (client, ctx) => {
        if (!ctx.workspaceId || !ctx.createdSourceSlug) return 'skipped (no source)'
        await client.invoke('sources:delete', ctx.workspaceId, ctx.createdSourceSlug)
        return 'cleaned up'
      },
    },
    {
      name: 'sessions:delete',
      fn: async (client, ctx) => {
        if (!ctx.createdSessionId) return 'skipped (no session)'
        await client.invoke('sessions:delete', ctx.createdSessionId)
        return 'cleaned up'
      },
    },
    {
      name: 'Disconnect',
      fn: async (client) => {
        client.destroy()
        return 'OK'
      },
    },
  ]
}

export async function runValidation(client: CliRpcClient, jsonMode: boolean): Promise<number> {
  const steps = getValidateSteps()
  const total = steps.length
  const ctx: ValidateContext = {}
  let passed = 0
  let failed = 0
  const results: Array<{ step: string; status: string; detail: string }> = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const prefix = `[${i + 1}/${total}] ${step.name}`
    const dots = '.'.repeat(Math.max(1, 45 - prefix.length))

    try {
      const detail = await step.fn(client, ctx)
      passed++
      results.push({ step: step.name, status: 'OK', detail })
      if (!jsonMode) {
        process.stdout.write(`${prefix} ${dots} OK  ${detail}\n`)
      }
    } catch (e) {
      failed++
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ step: step.name, status: 'FAIL', detail: msg })
      if (!jsonMode) {
        process.stderr.write(`${prefix} ${dots} FAIL  ${msg}\n`)
      }
    }
  }

  // Cleanup: if a session was created but delete step hasn't run or failed
  if (ctx.createdSessionId && client.isConnected) {
    try {
      await client.invoke('sessions:delete', ctx.createdSessionId)
    } catch {
      // best effort
    }
  }

  if (jsonMode) {
    out({ total, passed, failed, results }, true)
  } else {
    process.stdout.write(`\nResult: ${passed}/${total} passed`)
    if (failed > 0) process.stdout.write(` (${failed} failed)`)
    process.stdout.write('\n')
  }

  return failed > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stdout.write(`craft-cli — Terminal client for Craft Agent server

Usage: craft-cli [options] <command> [args...]

Connection:
  --url <ws[s]://...>    Server URL (default: $CRAFT_SERVER_URL)
  --token <secret>       Auth token (default: $CRAFT_SERVER_TOKEN)
  --workspace <id>       Workspace ID (auto-detected if omitted)
  --timeout <ms>         Request timeout (default: 10000)
  --tls-ca <path>        Custom CA cert for self-signed TLS
  --json                 Raw JSON output for scripting

Commands:
  run <message>          Spawn server, send message, stream response, exit
                         --workspace-dir <path>  Use directory as workspace (creates if needed)
                         --source <slug>     Enable source (repeatable)
                         --mode <mode>       Permission mode (default: allow-all)
                         --output-format     text or stream-json (default: text)
                         --no-cleanup        Keep session after completion
                         --server-entry      Path to server/index.ts
  ping                   Verify connectivity (clientId + latency)
  health                 Check credential store health
  versions               Show server runtime versions
  workspaces             List workspaces
  sessions               List sessions in workspace
  connections            List LLM connections
  sources                List configured sources
  session create         Create a session (--name, --mode)
  session messages <id>  Print session message history
  session delete <id>    Delete a session
  send <id> <message>    Send message and stream AI response
  cancel <id>            Cancel in-progress processing
  invoke <channel> [...] Raw RPC call with JSON args
  listen <channel>       Subscribe to push events (Ctrl+C to stop)
  --validate-server      Multi-step server integration test

Examples:
  craft-cli run "What files are in the current directory?"
  craft-cli run --source craft-kb "Summarize today's daily note"
  craft-cli run --workspace-dir .github/agents --source craft-public "Read the doc"
  echo "Analyze this code" | craft-cli run
  craft-cli ping
  craft-cli sessions
  craft-cli send abc-123 "What files are in the current directory?"
  echo "Summarize this" | craft-cli send abc-123
  craft-cli --validate-server
  craft-cli invoke system:homeDir
  craft-cli --json workspaces | jq '.[].name'
`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = parseArgs(argv)

  // Set custom CA before any WS connections
  if (args.tlsCa) {
    process.env.NODE_EXTRA_CA_CERTS = args.tlsCa
  }

  if (args.command === 'help' || args.command === '') {
    printHelp()
    return
  }

  if (args.command === 'version') {
    const pkg = await import('../package.json')
    out(pkg.version ?? pkg.default?.version ?? 'unknown', false)
    return
  }

  // run is self-contained — spawns its own server
  if (args.command === 'run') {
    await cmdRun(args)
    return
  }

  // All other commands need a server URL
  if (!args.url) {
    err('No server URL. Use --url <ws://...> or set $CRAFT_SERVER_URL')
    process.exit(1)
  }

  const client = new CliRpcClient(args.url, {
    token: args.token || undefined,
    workspaceId: args.workspace,
    requestTimeout: args.timeout,
    connectTimeout: args.timeout,
  })

  try {
    switch (args.command) {
      case 'validate':
        process.exit(await runValidation(client, args.json))
        break
      case 'ping':
        await cmdPing(client, args)
        break
      case 'health':
        await cmdHealth(client, args)
        break
      case 'versions':
        await cmdVersions(client, args)
        break
      case 'workspaces':
        await cmdWorkspaces(client, args)
        break
      case 'sessions':
        await cmdSessions(client, args)
        break
      case 'connections':
        await cmdConnections(client, args)
        break
      case 'sources':
        await cmdSources(client, args)
        break
      case 'session': {
        const subCmd = args.rest.shift()
        switch (subCmd) {
          case 'create':
            await cmdSessionCreate(client, args)
            break
          case 'messages':
            await cmdSessionMessages(client, args)
            break
          case 'delete':
            await cmdSessionDelete(client, args)
            break
          default:
            err(`Unknown session subcommand: ${subCmd}`)
            process.exit(1)
        }
        break
      }
      case 'send':
        await cmdSend(client, args)
        break // cmdSend calls process.exit
      case 'cancel':
        await cmdCancel(client, args)
        break
      case 'invoke':
        await cmdInvoke(client, args)
        break
      case 'listen':
        await cmdListen(client, args)
        break // never returns
      default:
        err(`Unknown command: ${args.command}`)
        printHelp()
        process.exit(1)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err(msg)
    process.exit(1)
  } finally {
    client.destroy()
  }
}

// Run if executed directly (not when imported by tests)
if (import.meta.main) {
  main()
}
