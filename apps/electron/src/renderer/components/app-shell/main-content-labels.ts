import type { TFunction } from 'i18next'

export function getMainContentLabels(t: TFunction) {
  return {
    noSourcesConfigured: t('common:mainContent.empty.noSourcesConfigured'),
    noSkillsConfigured: t('common:mainContent.empty.noSkillsConfigured'),
    noFlaggedConversations: t('common:mainContent.empty.noFlaggedConversations'),
    noConversationsYet: t('common:mainContent.empty.noConversationsYet'),
    selectConversation: t('common:mainContent.empty.selectConversation'),
  }
}
