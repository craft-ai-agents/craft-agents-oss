import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { assertManagedProjectToolInput, assertManagedProjectToolPath } from './project-tool-isolation'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'managed-project-tools-'))
  roots.push(root)
  const project = join(root, 'project')
  const other = join(root, 'project-other')
  mkdirSync(project)
  mkdirSync(other)
  writeFileSync(join(project, 'inside.txt'), 'inside')
  writeFileSync(join(other, 'secret.txt'), 'secret')
  return { root, project, other }
}

describe('managed project tool isolation', () => {
  it('allows existing and new files only below the project root', () => {
    const f = fixture()
    expect(() => assertManagedProjectToolPath(f.project, 'inside.txt')).not.toThrow()
    expect(() => assertManagedProjectToolPath(f.project, 'nested/new.md')).not.toThrow()
    expect(() => assertManagedProjectToolPath(f.project, join(f.other, 'secret.txt'))).toThrow('项目目录之外')
    expect(() => assertManagedProjectToolPath(f.project, '../project-other/secret.txt')).toThrow('项目目录之外')
  })

  it('rejects symlink escapes and non-file tools', () => {
    const f = fixture()
    symlinkSync(f.other, join(f.project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => assertManagedProjectToolPath(f.project, 'linked/secret.txt')).toThrow('符号链接')
    expect(() => assertManagedProjectToolInput(f.project, [], 'Bash', { command: 'pwd' })).toThrow('未开放工具')
    expect(() => assertManagedProjectToolInput(f.project, [], 'Write', { file_path: 'result.md' })).not.toThrow()
    expect(() => assertManagedProjectToolInput(f.project, [f.other], 'Read', { path: join(f.other, 'secret.txt') })).not.toThrow()
    expect(() => assertManagedProjectToolInput(f.project, [f.other], 'Write', { path: join(f.other, 'result.md') })).toThrow('项目目录之外')
  })
})
