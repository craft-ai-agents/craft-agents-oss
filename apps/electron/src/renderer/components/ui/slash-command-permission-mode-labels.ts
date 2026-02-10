import { PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, type PermissionMode } from '@craft-agent/shared/agent/modes'

type TranslationFn = (key: string) => string

const MODE_TRANSLATION_KEYS: Record<PermissionMode, { label: string; description: string }> = {
  safe: {
    label: 'settings:workspace.permissions.modeOptions.safe.label',
    description: 'settings:workspace.permissions.modeOptions.safe.description',
  },
  ask: {
    label: 'settings:workspace.permissions.modeOptions.ask.label',
    description: 'settings:workspace.permissions.modeOptions.ask.description',
  },
  'allow-all': {
    label: 'settings:workspace.permissions.modeOptions.allowAll.label',
    description: 'settings:workspace.permissions.modeOptions.allowAll.description',
  },
}

export function resolvePermissionModeCopy(mode: PermissionMode, t: TranslationFn) {
  const fallback = PERMISSION_MODE_CONFIG[mode]
  const keys = MODE_TRANSLATION_KEYS[mode]
  const label = t(keys.label)
  const description = t(keys.description)
  return {
    label: label === keys.label ? fallback.displayName : label,
    description: description === keys.description ? fallback.description : description,
  }
}

export function buildPermissionModeCommands(t: TranslationFn) {
  return PERMISSION_MODE_ORDER.map((mode) => {
    const config = PERMISSION_MODE_CONFIG[mode]
    const localized = resolvePermissionModeCopy(mode, t)
    return {
      id: mode,
      label: localized.label,
      description: localized.description,
      svgPath: config.svgPath,
    }
  })
}
