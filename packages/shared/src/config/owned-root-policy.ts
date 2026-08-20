import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface OwnedRootAdapter {
  resolveConfigDir(): string
}

function defaultConfigDir(): string {
  return process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent')
}

let adapter: OwnedRootAdapter = { resolveConfigDir: defaultConfigDir }

export function setOwnedRootAdapter(next: OwnedRootAdapter | null): void {
  adapter = next ?? { resolveConfigDir: defaultConfigDir }
}

export function getConfigDir(): string {
  return adapter.resolveConfigDir()
}

export function assertNotesImportPaths(paths: {
  sourceRoot: string
  destinationRoot?: string
}): void {
  if (!paths.sourceRoot || !isAbsolute(paths.sourceRoot)) {
    throw new Error('Selected notes import root must be an absolute path')
  }
  if (
    paths.destinationRoot !== undefined
    && (!paths.destinationRoot || !isAbsolute(paths.destinationRoot))
  ) {
    throw new Error('Notes destination root must be an absolute path')
  }
}
