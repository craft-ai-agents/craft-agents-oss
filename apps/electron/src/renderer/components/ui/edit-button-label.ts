type TranslationFn = (key: string) => string

export function resolveEditButtonLabel(t: TranslationFn): string {
  return t('common:edit')
}
