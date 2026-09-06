import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Reject lexical traversal and symlink/junction escapes for managed file tools. */
export function assertManagedProjectToolPath(projectRoot: string, value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error('企业文件工具缺少有效路径')
  const lexicalRoot = resolve(projectRoot)
  const candidate = resolve(lexicalRoot, value)
  if (!isWithin(lexicalRoot, candidate)) throw new Error('企业文件工具禁止访问项目目录之外')

  const realRoot = realpathSync(lexicalRoot)
  let existing = candidate
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing || !isWithin(lexicalRoot, parent)) throw new Error('企业文件工具路径无效')
    existing = parent
  }
  if (!isWithin(realRoot, realpathSync(existing))) throw new Error('企业文件工具禁止通过符号链接离开项目目录')
}

export function assertManagedProjectToolInput(
  projectRoot: string | undefined,
  readRoots: string[] | undefined,
  toolName: string,
  input: Record<string, unknown>,
): void {
  if (!projectRoot) return
  if (!['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Find', 'Ls'].includes(toolName)) {
    throw new Error(`企业项目隔离模式未开放工具 ${toolName}`)
  }
  const pathValue = input.file_path ?? input.path ?? projectRoot
  try {
    assertManagedProjectToolPath(projectRoot, pathValue)
    return
  } catch (projectError) {
    if (!['Read', 'Grep', 'Find', 'Ls'].includes(toolName)) throw projectError
  }
  for (const readRoot of readRoots ?? []) {
    try {
      assertManagedProjectToolPath(readRoot, pathValue)
      return
    } catch { /* try the next server-owned read root */ }
  }
  throw new Error('企业文件工具禁止读取项目及授权技能目录之外')
}
