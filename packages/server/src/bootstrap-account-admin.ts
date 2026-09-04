import { AccountStore } from '@craft-agent/server-core/webui'
import { CONFIG_DIR, ensureConfigDir, loadStoredConfig } from '@craft-agent/shared/config'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Run on the service host before opening public access, using the SAME config directory as the service.
// Accept stdin from a secret manager; never accept passwords in argv or print input/errors that could contain credentials.
if (import.meta.main) {
  try {
    if (process.stdin.isTTY) throw new Error('Credentials must be supplied through protected stdin, not command-line arguments')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 4096) throw new Error('Input exceeds limit')
      chunks.push(bytes)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data.username !== 'string' || typeof data.password !== 'string'
      || Object.keys(data).some(key => !['username', 'password'].includes(key))) throw new Error('Invalid input')
    ensureConfigDir()
    // Exclusive creation: never replace an existing (including corrupt) workspace registry.
    try {
      writeFileSync(join(CONFIG_DIR, 'config.json'), JSON.stringify({
        workspaces: [], activeWorkspaceId: null, activeSessionId: null,
      }), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!loadStoredConfig()) throw new Error('Existing configuration requires operator recovery')
    const account = await new AccountStore().register(data.username, data.password, { bootstrap: true })
    console.log(`Administrator initialized: ${account.id}. Public registration remains disabled.`)
  } catch {
    console.error('Administrator bootstrap failed. Check protected input, password policy, config directory and whether an account already exists. No credentials were logged.')
    process.exitCode = 1
  }
}
