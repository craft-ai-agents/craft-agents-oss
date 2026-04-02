import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Workspace } from '../../config/storage.ts'
import type { SessionConfig as Session } from '../../sessions/storage.ts'
import { BridgePluginAgent } from '../plugin-bridge-agent.ts'

const codexPluginHelperPath = fileURLToPath(
  new URL('../../../../../plugins/codex-cli/main.mjs', import.meta.url),
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
  tempRoot = join(tmpdir(), `codex-cli-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(tempRoot, { recursive: true })
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('Codex CLI plugin helper', () => {
  it('maps Codex JSONL output into bridge events', async () => {
    const canonicalTempRoot = await realpath(tempRoot)
    const codexPath = join(tempRoot, 'codex')
    await writeFile(codexPath, `#!/bin/bash
set -euo pipefail
thread_id="thread-new"
prompt=""

args=("$@")
idx=0
while [ $idx -lt \${#args[@]} ]; do
  arg="\${args[$idx]}"
  case "$arg" in
    exec|--skip-git-repo-check|--json)
      idx=$((idx + 1))
      ;;
    --cd|--model)
      idx=$((idx + 2))
      ;;
    resume)
      thread_id="\${args[$((idx + 1))]}"
      prompt="\${args[$((idx + 2))]}"
      break
      ;;
    *)
      prompt="$arg"
      idx=$((idx + 1))
      ;;
  esac
done

printf '%s\n' '{"type":"thread.started","thread_id":"'"$thread_id"'"}'
printf '%s\n' '{"type":"turn.started"}'

if [ "$prompt" = "mini prompt" ]; then
  printf '%s\n' '{"type":"item.completed","item":{"id":"msg-mini","type":"agent_message","text":"mini result"}}'
else
  printf '%s\n' '{"type":"item.started","item":{"id":"tool-1","type":"command_execution","command":"/bin/pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}'
  printf '%s\n' '{"type":"item.completed","item":{"id":"tool-1","type":"command_execution","command":"/bin/pwd","aggregated_output":"'"$PWD"'\\n","exit_code":0,"status":"completed"}}'
  printf '%s\n' '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"done"}}'
fi

printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
`)
    await chmod(codexPath, 0o755)

    const agent = new BridgePluginAgent({
      provider: 'pi',
      workspace: createWorkspace(tempRoot),
      session: createSession(tempRoot),
      model: 'gpt-5.4',
      isHeadless: true,
      envOverrides: {
        PATH: `${tempRoot}:${process.env.PATH || ''}`,
      },
      runtime: {
        pluginBridge: {
          pluginId: 'external.codex-cli',
          backendId: 'codex-cli',
          helperPath: codexPluginHelperPath,
          helperRuntimePath: '/opt/homebrew/bin/node',
        },
      },
    })

    const events = []
    for await (const event of agent.chat('say hi')) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'tool_start', toolName: 'Bash', toolUseId: 'tool-1', input: { command: '/bin/pwd' } },
      { type: 'tool_result', toolUseId: 'tool-1', toolName: 'Bash', result: `${canonicalTempRoot}\n`, isError: false },
      { type: 'text_complete', text: 'done' },
      { type: 'complete' },
    ])
    expect(agent.getSessionId()).toBe('session-1')
    await expect(agent.runMiniCompletion('mini prompt')).resolves.toBe('mini result')

    agent.destroy()
  })
})
