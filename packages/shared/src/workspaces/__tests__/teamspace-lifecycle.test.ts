import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONFIG_STORAGE_URL = pathToFileURL(
  join(import.meta.dir, '..', '..', 'config', 'storage.ts'),
).href
const WORKSPACE_STORAGE_URL = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const ORGS_STORAGE_URL = pathToFileURL(join(import.meta.dir, '..', '..', 'orgs', 'storage.ts')).href

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-teamspace-lifecycle-'))
  tempDirs.push(dir)
  return dir
}

async function runInConfigDir(configDir: string, body: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: [
      'bun',
      '-e',
      `
import { existsSync } from 'node:fs';
process.env.CRAFT_CONFIG_DIR = ${JSON.stringify(configDir)};
// Dynamic imports are required because these modules capture CRAFT_CONFIG_DIR at evaluation time.
const config = await import(${JSON.stringify(CONFIG_STORAGE_URL)});
const workspace = await import(${JSON.stringify(WORKSPACE_STORAGE_URL)});
const orgs = await import(${JSON.stringify(ORGS_STORAGE_URL)});
${body}
`,
    ],
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

describe('TeamSpace local lifecycle', () => {
  it('migrates a legacy no-kind workspace to explicit personal metadata', async () => {
    const configDir = makeConfigDir()
    const rootPath = join(configDir, 'workspaces', 'legacy')
    mkdirSync(rootPath, { recursive: true })
    writeFileSync(
      join(rootPath, 'config.json'),
      JSON.stringify({
        id: 'ws-legacy',
        name: 'Legacy',
        slug: 'legacy',
        createdAt: 1,
        updatedAt: 1,
      }),
      'utf-8',
    )
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        workspaces: [{ id: 'ws-legacy', name: 'Legacy', slug: 'legacy', rootPath, createdAt: 1 }],
        activeWorkspaceId: 'ws-legacy',
        activeSessionId: null,
      }),
      'utf-8',
    )

    const result = await runInConfigDir(
      configDir,
      `
const loaded = config.loadStoredConfig();
if (loaded?.workspaces[0]?.kind !== 'personal') throw new Error('global legacy kind was not personal');
const folder = workspace.loadWorkspaceConfig(${JSON.stringify(rootPath)});
if (folder?.kind !== 'personal') throw new Error('folder legacy kind was not personal');
console.log('ok');
`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  })

  it('rejects a team workspace with no orgId before it publishes a folder or registry record', async () => {
    const configDir = makeConfigDir()
    const rootPath = join(configDir, 'workspaces', 'missing-org')
    const result = await runInConfigDir(
      configDir,
      `
try {
  await config.createAndActivateLocalWorkspace({ name: 'Missing Org', rootPath: ${JSON.stringify(rootPath)}, kind: 'team' });
  throw new Error('expected rejection');
} catch (error) {
  if (String(error).includes('expected rejection')) throw error;
}
if (existsSync(${JSON.stringify(rootPath)})) throw new Error('folder was published');
if (config.loadStoredConfig()?.workspaces.length) throw new Error('registry was published');
console.log('ok');
`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  })

  it('rejects a team workspace for a non-member server identity', async () => {
    const configDir = makeConfigDir()
    const rootPath = join(configDir, 'workspaces', 'not-member')
    writeFileSync(
      join(configDir, 'orgs.json'),
      JSON.stringify({
        version: 1,
        organizations: [{ id: 'org_other', name: 'Other', slug: 'other', createdBy: 'other', createdAt: 1 }],
        members: [],
        invites: [],
      }),
      'utf-8',
    )
    const result = await runInConfigDir(
      configDir,
      `
try {
  await config.createAndActivateLocalWorkspace({ name: 'No Access', rootPath: ${JSON.stringify(rootPath)}, kind: 'team', orgId: 'org_other' });
  throw new Error('expected rejection');
} catch (error) {
  if (String(error).includes('expected rejection')) throw error;
}
if (existsSync(${JSON.stringify(rootPath)})) throw new Error('folder was published');
console.log('ok');
`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  })

  it('uses equal canonical identity in folder and registry and returns an activation snapshot', async () => {
    const configDir = makeConfigDir()
    const rootPath = join(configDir, 'workspaces', 'team')
    const result = await runInConfigDir(
      configDir,
      `
const org = orgs.createOrganization({ name: 'Team' });
const activation = await config.createAndActivateLocalWorkspace({ name: 'Team Workspace', rootPath: ${JSON.stringify(rootPath)}, kind: 'team', orgId: org.id });
const registry = config.loadStoredConfig();
const global = registry?.workspaces.find((item) => item.id === activation.workspace.id);
const folder = workspace.loadWorkspaceConfig(${JSON.stringify(rootPath)});
if (!global || !folder) throw new Error('missing canonical records');
for (const key of ['id', 'name', 'kind', 'orgId']) {
  if (global[key] !== folder[key]) throw new Error('identity drift: ' + key);
}
if (activation.activeWorkspaceId !== activation.workspace.id) throw new Error('inactive activation snapshot');
if (activation.session.workspaceRootPath !== ${JSON.stringify(rootPath)}) throw new Error('session root mismatch');
if (registry?.activeWorkspaceId !== activation.workspace.id) throw new Error('registry active mismatch');
console.log('ok');
`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  })

  it('rolls back an injected post-folder local failure without publishing a workspace', async () => {
    const configDir = makeConfigDir()
    const rootPath = join(configDir, 'workspaces', 'rollback')
    const result = await runInConfigDir(
      configDir,
      `
try {
  await config.createAndActivateLocalWorkspace(
    { name: 'Rollback', rootPath: ${JSON.stringify(rootPath)} },
    { afterFolderBound() { throw new Error('injected failure'); } },
  );
  throw new Error('expected injected failure');
} catch (error) {
  if (String(error).includes('expected injected failure')) throw error;
}
if (existsSync(${JSON.stringify(rootPath)})) throw new Error('staged folder survived');
if (config.loadStoredConfig()?.workspaces.length) throw new Error('registry survived failure');
console.log('ok');
`,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('ok')
  })
})
