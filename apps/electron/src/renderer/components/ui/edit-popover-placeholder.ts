interface ResolvePlaceholderOptions {
  overridePlaceholder?: string
  overridePlaceholderKey?: string
}

export function resolveEditPopoverBasePlaceholder(
  t: (key: string) => string,
  options: ResolvePlaceholderOptions,
): string {
  if (options.overridePlaceholderKey) {
    return t(options.overridePlaceholderKey)
  }

  if (options.overridePlaceholder) {
    return options.overridePlaceholder
  }

  return t('common:editPopover.basePlaceholder')
}

interface BuildPlaceholderOptions extends ResolvePlaceholderOptions {
  example?: string
}

export function buildEditPopoverPlaceholder(
  t: (key: string, options?: Record<string, unknown>) => string,
  options: BuildPlaceholderOptions,
): string {
  const base = resolveEditPopoverBasePlaceholder((key) => t(key), options)
  if (!options.example) return base

  const normalizedBase = base.replace(/(\.\.\.|…)+$/, '')
  return t('common:editPopover.placeholderWithExample', {
    placeholder: normalizedBase,
    example: options.example,
  })
}
