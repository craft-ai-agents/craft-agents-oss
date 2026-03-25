import { describe, it, expect } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'
import { CHANNEL_MAP } from '../channel-map'

type AnyFn = (...args: any[]) => any

type FunctionKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFn> extends never ? never : K
}[keyof T] & string

type BrowserPaneKeys = `browserPane.${FunctionKeys<ElectronAPI['browserPane']>}`

// Methods excluded from CHANNEL_MAP because they are implemented directly in the preload
// (no IPC round-trip to the main process). Each reads local state or orchestrates client-side.
type ApiToChannelMapKeys = Exclude<
  FunctionKeys<ElectronAPI>,
  | 'performOAuth'
  | 'getTransportConnectionState'
  | 'onTransportConnectionStateChanged'
  | 'reconnectTransport'
  | 'isChannelAvailable'
  | 'getSystemWarnings' // reads env var set at startup — no IPC needed
  | 'getRemoteServerRuntimeStates'
  | 'onWorkspacesChanged'
  | 'createWorkspaceAtTarget'
  | 'checkWorkspaceSlugAtTarget'
  | 'listServerDirectoryForTarget'
  | 'getHomeDirForTarget'
  | 'listLlmConnectionsForTarget'
  | 'listLlmConnectionsWithStatusForTarget'
  | 'getLlmConnectionForTarget'
  | 'getLlmConnectionApiKeyForTarget'
  | 'saveLlmConnectionForTarget'
  | 'deleteLlmConnectionForTarget'
  | 'testLlmConnectionForTarget'
  | 'setDefaultLlmConnectionForTarget'
  | 'getDefaultThinkingLevelForTarget'
  | 'setDefaultThinkingLevelForTarget'
  | 'startClaudeOAuthForTarget'
  | 'exchangeClaudeCodeForTarget'
  | 'clearClaudeOAuthStateForTarget'
  | 'setupLlmConnectionForTarget'
  | 'testLlmConnectionSetupForTarget'
  | 'startChatGptOAuthForTarget'
  | 'startCopilotOAuthForTarget'
  | 'shareLlmConnectionToTarget'
  | 'shareSourceToWorkspace'
  | 'shareSkillToWorkspace'
> | BrowserPaneKeys
type ChannelMapKeys = keyof typeof CHANNEL_MAP & string

type AssertNever<T extends never> = true

// Compile-time guardrails: if these fail, CHANNEL_MAP and ElectronAPI drifted.
const _missingFromMap: AssertNever<Exclude<ApiToChannelMapKeys, ChannelMapKeys>> = true
const _extraInMap: AssertNever<Exclude<ChannelMapKeys, ApiToChannelMapKeys>> = true

void _missingFromMap
void _extraInMap

describe('CHANNEL_MAP runtime contract', () => {
  it('has valid entry kinds and channels', () => {
    for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
      expect(typeof method).toBe('string')
      expect(entry.type === 'invoke' || entry.type === 'listener').toBe(true)
      expect(typeof entry.channel).toBe('string')
      expect(entry.channel.length).toBeGreaterThan(0)

      if (entry.type === 'listener') {
        expect((entry as any).transform).toBeUndefined()
      }
    }
  })

  it('contains at least one listener and one invoke entry', () => {
    const values = Object.values(CHANNEL_MAP)
    expect(values.some((entry) => entry.type === 'listener')).toBe(true)
    expect(values.some((entry) => entry.type === 'invoke')).toBe(true)
  })
})
