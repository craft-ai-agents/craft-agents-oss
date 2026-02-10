import { join } from 'path'

export interface LocalePathInput {
  isPackaged: boolean
  cwd: string
  appPath: string
  resourcesPath: string
  locale: string
  namespace: string
}

export function buildLocaleCandidatePaths(input: LocalePathInput): string[] {
  const file = `${input.namespace}.json`

  const candidates = input.isPackaged
    ? [
        join(input.resourcesPath, 'locales', input.locale, file),
        join(input.appPath, 'packages', 'shared', 'locales', input.locale, file),
      ]
    : [
        join(input.cwd, 'packages', 'shared', 'locales', input.locale, file),
        join(input.appPath, '..', '..', 'packages', 'shared', 'locales', input.locale, file),
        join(input.appPath, 'packages', 'shared', 'locales', input.locale, file),
        join(input.resourcesPath, 'locales', input.locale, file),
      ]

  return Array.from(new Set(candidates))
}
