import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Workspace } from '../../config/storage.ts'
import type { SessionConfig as Session } from '../../sessions/storage.ts'
import { BridgePluginAgent } from '../plugin-bridge-agent.ts'

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    slug: 'workspace',
    rootPath: '/tmp/workspace',
    createdAt: Date.now(),
  }
}

function createSession(): Session {
  return {
    id: 'session-1',
    workspaceRootPath: '/tmp/workspace',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  }
}

async function writeHelperScript(root: string, body: string): Promise<string> {
  const helperPath = join(root, 'bridge-helper.mjs')
  await writeFile(helperPath, body)
  return helperPath
}

let tempRoot = ''

beforeEach(async () => {
  tempRoot = join(tmpdir(), `plugin-bridge-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempRoot, { recursive: true })
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('BridgePluginAgent', () => {
  it('forwards helper-emitted events and updates the bridged session id', async () => {
    const helperPath = await writeHelperScript(tempRoot, `
      process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n')

      let buffer = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => {
        buffer += chunk
        let newlineIndex = buffer.indexOf('\\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          if (line.trim()) {
            const msg = JSON.parse(line)
            if (msg.type === 'chat') {
              process.stdout.write(JSON.stringify({ type: 'session_id', sessionId: 'bridge-thread-1' }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'event', event: { type: 'tool_start', toolName: 'Bash', toolUseId: 'tool-1', input: { command: 'pwd' } } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'event', event: { type: 'tool_result', toolUseId: 'tool-1', toolName: 'Bash', result: '/tmp/workspace\\n', isError: false } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'event', event: { type: 'text_complete', text: 'done' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'event', event: { type: 'complete' } }) + '\\n')
              process.stdout.write(JSON.stringify({ type: 'request_complete', requestId: msg.requestId }) + '\\n')
            } else if (msg.type === 'mini_completion') {
              process.stdout.write(JSON.stringify({ type: 'mini_completion_result', requestId: msg.requestId, text: 'mini result' }) + '\\n')
            } else if (msg.type === 'abort') {
              process.stdout.write(JSON.stringify({ type: 'request_complete', requestId: msg.requestId }) + '\\n')
            }
          }
          newlineIndex = buffer.indexOf('\\n')
        }
      })
    `)

    const agent = new BridgePluginAgent({
      provider: 'pi',
      workspace: createWorkspace(),
      session: createSession(),
      model: 'gpt-5.4',
      isHeadless: true,
      runtime: {
        pluginBridge: {
          pluginId: 'external.codex-cli',
          backendId: 'codex-cli',
          helperPath,
          helperRuntimePath: '/opt/homebrew/bin/node',
        },
      },
    })

    const events = []
    for await (const event of agent.chat('say hi')) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'tool_start', toolName: 'Bash', toolUseId: 'tool-1', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'tool-1', toolName: 'Bash', result: '/tmp/workspace\n', isError: false },
      { type: 'text_complete', text: 'done' },
      { type: 'complete' },
    ])
    expect(agent.getSessionId()).toBe('bridge-thread-1')
    await expect(agent.runMiniCompletion('summarize')).resolves.toBe('mini result')

    agent.destroy()
  })
})
