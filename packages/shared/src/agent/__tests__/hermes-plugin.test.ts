import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Workspace } from '../../config/storage.ts'
import type { SessionConfig as Session } from '../../sessions/storage.ts'
import type { RecoveryMessage } from '../backend/types.ts'
import { BridgePluginAgent } from '../plugin-bridge-agent.ts'

const hermesPluginHelperPath = fileURLToPath(
  new URL('../../../../../plugins/hermes/main.mjs', import.meta.url),
)

function createWorkspace(rootPath: string): Workspace {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    slug: 'workspace',
    rootPath,
    createdAt: Date.now(),
  }
}

function createSession(rootPath: string): Session {
  return {
    id: 'session-1',
    workspaceRootPath: rootPath,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  }
}

let tempRoot = ''

beforeEach(async () => {
  tempRoot = join(tmpdir(), `hermes-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempRoot, { recursive: true })
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('Hermes plugin helper', () => {
  it('uses /v1/responses as the primary transport and falls back to Craft recovery messages', async () => {
    const requests: Array<{ path: string; body: any; auth?: string }> = []
    let callCount = 0

    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/health' || url.pathname === '/v1/health') {
          return Response.json({ status: 'ok' })
        }
        if (url.pathname === '/v1/models') {
          return Response.json({ data: [{ id: 'hermes-default' }] })
        }
        if (url.pathname === '/v1/responses') {
          const body = await request.json() as Record<string, any>
          requests.push({
            path: url.pathname,
            body,
            auth: request.headers.get('authorization') ?? undefined,
          })
          callCount += 1

          if (callCount === 1) {
            return Response.json({
              id: 'resp-1',
              output: [{
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'hello from hermes' }],
              }],
            })
          }

          if (callCount === 2) {
            expect(body.previous_response_id).toBe('resp-1')
            return Response.json({ error: { message: 'missing response' } }, { status: 404 })
          }

          expect(Array.isArray(body.input)).toBe(true)
          expect(body.input).toEqual([
            { role: 'user', content: 'Earlier question' },
            { role: 'assistant', content: 'Earlier answer' },
            { role: 'user', content: 'Continue please' },
          ])

          return Response.json({
            id: 'resp-2',
            output_text: 'recovered from transcript',
          })
        }

        return new Response('not found', { status: 404 })
      },
    })

    const canonicalTempRoot = await realpath(tempRoot)
    const recoveryMessages: RecoveryMessage[] = [
      { type: 'user', content: 'Earlier question' },
      { type: 'assistant', content: 'Earlier answer' },
    ]

    const agent = new BridgePluginAgent({
      provider: 'pi',
      workspace: createWorkspace(tempRoot),
      session: createSession(tempRoot),
      model: 'gpt-5.4',
      isHeadless: true,
      envOverrides: {
        CRAFT_HERMES_MODE: 'external',
        CRAFT_HERMES_BASE_URL: `http://127.0.0.1:${server.port}`,
        CRAFT_HERMES_API_KEY: 'test-key',
        CRAFT_HERMES_TRANSPORT: 'api',
        PATH: `${canonicalTempRoot}:${process.env.PATH || ''}`,
      },
      getRecoveryMessages: () => recoveryMessages,
      runtime: {
        pluginBridge: {
          pluginId: 'external.hermes',
          backendId: 'hermes',
          helperPath: hermesPluginHelperPath,
          helperRuntimePath: '/opt/homebrew/bin/node',
        },
      },
    })

    const firstEvents = []
    for await (const event of agent.chat('Hello Hermes')) {
      firstEvents.push(event)
    }

    expect(firstEvents).toEqual([
      { type: 'text_complete', text: 'hello from hermes' },
      { type: 'complete' },
    ])
    expect(agent.getSessionId()).toBe('resp-1')
    expect(requests[0]?.auth).toBe('Bearer test-key')
    expect(requests[0]?.body.previous_response_id).toBeUndefined()

    const secondEvents = []
    for await (const event of agent.chat('Continue please')) {
      secondEvents.push(event)
    }

    expect(secondEvents).toEqual([
      { type: 'text_complete', text: 'recovered from transcript' },
      { type: 'complete' },
    ])
    expect(agent.getSessionId()).toBe('resp-2')

    agent.destroy()
    server.stop(true)
  })

  it('supports explicit CLI fallback mode for debug execution', async () => {
    const hermesPath = join(tempRoot, 'hermes')
    await writeFile(hermesPath, `#!/bin/bash
set -euo pipefail
if [ "$1" = "--profile" ]; then
  shift 2
fi
if [ "$1" = "chat" ]; then
  echo "cli fallback result"
  echo "session_id: cli-session-1"
  exit 0
fi
echo "unexpected invocation" >&2
exit 1
`)
    await chmod(hermesPath, 0o755)

    const agent = new BridgePluginAgent({
      provider: 'pi',
      workspace: createWorkspace(tempRoot),
      session: createSession(tempRoot),
      model: 'gpt-5.4',
      isHeadless: true,
      envOverrides: {
        CRAFT_HERMES_MODE: 'managed',
        CRAFT_HERMES_TRANSPORT: 'cli',
        CRAFT_HERMES_BIN: hermesPath,
      },
      runtime: {
        pluginBridge: {
          pluginId: 'external.hermes',
          backendId: 'hermes',
          helperPath: hermesPluginHelperPath,
          helperRuntimePath: '/opt/homebrew/bin/node',
        },
      },
    })

    const events = []
    for await (const event of agent.chat('Debug Hermes')) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text_complete', text: 'cli fallback result' },
      { type: 'complete' },
    ])
    expect(agent.getSessionId()).toBe('cli-session-1')

    agent.destroy()
  })
})
