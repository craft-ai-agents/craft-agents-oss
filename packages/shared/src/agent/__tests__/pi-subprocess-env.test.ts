/**
 * The Pi subprocess never inherits another connection's credentials from process.env: the Pi
 * SDK would authenticate with them, and its agent runs shell commands with that environment.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { buildPiSubprocessEnv } from '../pi-agent.ts'

const KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'AWS_ACCESS_KEY_ID', 'OPENAI_API_KEY']
// What the app started with (the test runner's environment, read when the modules loaded).
const startup = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const [key, value] of Object.entries(startup)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('buildPiSubprocessEnv', () => {
  it("leaves out connection credentials something put into process.env after startup", () => {
    process.env.ANTHROPIC_API_KEY = 'sk-claude-connection'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'claude-account-token'
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'

    const env = buildPiSubprocessEnv({ awsEnv: {} })

    expect(env.ANTHROPIC_API_KEY).toBe(startup.ANTHROPIC_API_KEY)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(startup.CLAUDE_CODE_OAUTH_TOKEN)
    expect(env.ANTHROPIC_BASE_URL).toBe(startup.ANTHROPIC_BASE_URL)
  })

  it("keeps the user's own environment and adds the session's own values", () => {
    process.env.OPENAI_API_KEY = 'sk-users-own-shell-key'

    const env = buildPiSubprocessEnv({
      envOverrides: { CRAFT_WORKSPACE_PATH: '/ws' },
      awsEnv: { AWS_ACCESS_KEY_ID: 'AKIA_BEDROCK_CONNECTION' },
      sessionDir: '/ws/sessions/s1',
    })

    expect(env.OPENAI_API_KEY).toBe('sk-users-own-shell-key')
    expect(env.PATH).toBe(process.env.PATH)
    expect(env.CRAFT_WORKSPACE_PATH).toBe('/ws')
    // A Bedrock connection's own IAM keys go in after the reset.
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA_BEDROCK_CONNECTION')
    expect(env.CRAFT_SESSION_DIR).toBe('/ws/sessions/s1')
  })
})
