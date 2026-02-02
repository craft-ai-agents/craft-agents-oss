import { useTranslation } from 'react-i18next'
import type { Namespace } from './index'
import type { UseI18nReturn } from './types'

/**
 * Hook personnalisé pour utiliser i18next dans les composants
 *
 * @param namespace - Le namespace à utiliser (défaut: 'common')
 * @returns Fonction t() pour traduire, et autres utilitaires i18n
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t } = useI18n('chat')
 *   return <button>{t('share.openInBrowser')}</button>
 * }
 * ```
 */
export function useI18n(namespace: Namespace = 'common'): UseI18nReturn {
  const { t, i18n } = useTranslation(namespace)

  return {
    t,
    language: i18n.language,
    changeLanguage: (lng: string) => i18n.changeLanguage(lng),
    languages: i18n.languages,
  }
}
