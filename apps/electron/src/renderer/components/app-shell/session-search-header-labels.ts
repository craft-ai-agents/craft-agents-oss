import type { TFunction } from 'i18next'

export function getSessionSearchHeaderLabels(t: TFunction) {
  const rawTemplate = t('common:sessionSearch.results')
  const template = typeof rawTemplate === 'string' ? rawTemplate : String(rawTemplate)

  return {
    placeholder: t('common:sessionSearch.placeholder'),
    close: t('common:sessionSearch.close'),
    loading: t('common:sessionSearch.loading'),
    results: (count: number, exceededLimit = false) => template.replace('{{count}}', exceededLimit ? '100+' : String(count)),
  }
}
