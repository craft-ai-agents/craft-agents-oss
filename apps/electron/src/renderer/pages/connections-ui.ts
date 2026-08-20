export const IMPORT_PLACEHOLDERS = {
  env: '~/.env',
  gitConfig: '~/.gitconfig',
  dockerConfig: '~/.docker/config.json',
  awsCredentials: '~/.aws/credentials',
  awsConfig: '~/.aws/config',
  adc: '~/.config/gcloud/application_default_credentials.json',
} as const

export const CONNECT_SOURCES = [
  'github-env',
  'git-helper',
  'docker',
  'aws',
  'keychain',
  'adc',
  'ssh-agent',
] as const

export type ConnectSource = (typeof CONNECT_SOURCES)[number]
export type PreviewSource = Exclude<ConnectSource, 'github-env'> | 'env'

export type TestStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ok'; readonly login: string }
  | { readonly kind: 'error'; readonly message: string }

export function errorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return '—'
}

export function consumersForConnection(
  bindings: readonly { readonly connectionId: string; readonly consumerId: string }[],
  connectionId: string,
): string[] {
  const seen = new Set<string>()
  const named: string[] = []
  for (const row of bindings) {
    if (row.connectionId !== connectionId || seen.has(row.consumerId)) continue
    seen.add(row.consumerId)
    named.push(row.consumerId)
  }
  return named
}

export function formatConfirmTargets(
  row: { readonly id: string; readonly credentialRefId: string },
  consumers: readonly string[],
): string {
  if (consumers.length === 0) return `${row.id} ${row.credentialRefId}`
  return `${row.id} ${row.credentialRefId} ${consumers.join(', ')}`
}

export function previewSourceForChip(chip: ConnectSource): PreviewSource {
  return chip === 'github-env' ? 'env' : chip
}

export function matchesConnectSource<T extends { readonly source: PreviewSource }>(
  rows: readonly T[],
  chip: ConnectSource | null,
): T[] {
  if (!chip) return [...rows]
  const source = previewSourceForChip(chip)
  return rows.filter((row) => row.source === source)
}

export function testStatusFromResult(result: { readonly login: string }): TestStatus {
  return { kind: 'ok', login: result.login }
}

export function testStatusFromError(err: unknown): TestStatus {
  return { kind: 'error', message: errorMessage(err) }
}

export function isImportPanelVisible(panel: PreviewSource, chip: ConnectSource | null): boolean {
  if (chip == null) return true
  return previewSourceForChip(chip) === panel
}

export function firstPickedPath(paths: unknown): string {
  if (typeof paths === 'string' && paths.trim()) return paths.trim()
  if (Array.isArray(paths) && typeof paths[0] === 'string' && paths[0].trim()) return paths[0].trim()
  return ''
}

export function removeCommittedPreview<T extends { readonly source: PreviewSource; readonly candidateId: string }>(
  rows: readonly T[],
  committed: { readonly source: PreviewSource; readonly candidateId: string },
): T[] {
  return rows.filter((row) => row.source !== committed.source || row.candidateId !== committed.candidateId)
}

export function cycleTab<T>(tabs: readonly T[], current: T, delta: number): T {
  const i = tabs.indexOf(current)
  if (i < 0 || tabs.length === 0) return current
  const n = tabs.length
  return tabs[(((i + delta) % n) + n) % n]
}
