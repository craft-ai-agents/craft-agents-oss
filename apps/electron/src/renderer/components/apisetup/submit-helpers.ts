export type PresetKey = string

export function resolvePiAuthProviderForSubmit(
  activePreset: PresetKey,
  lastNonCustomPreset: PresetKey | null
): string | undefined {
  if (activePreset === 'custom') {
    return lastNonCustomPreset && lastNonCustomPreset !== 'custom'
      ? lastNonCustomPreset
      : 'anthropic'
  }

  return activePreset
}

export function resolvePresetStateForBaseUrlChange(params: {
  matchedPreset: PresetKey
  activePreset: PresetKey
  activePresetHasEmptyUrl: boolean
  lastNonCustomPreset: PresetKey | null
}): { activePreset: PresetKey; lastNonCustomPreset: PresetKey | null } {
  const { matchedPreset, activePreset, activePresetHasEmptyUrl, lastNonCustomPreset } = params

  if (matchedPreset !== 'custom') {
    return {
      activePreset: matchedPreset,
      lastNonCustomPreset: matchedPreset,
    }
  }

  if (activePresetHasEmptyUrl) {
    return {
      activePreset,
      lastNonCustomPreset,
    }
  }

  return {
    activePreset: 'custom',
    lastNonCustomPreset,
  }
}
