import type { TFunction } from 'i18next'

export function getSkillsListLabels(t: TFunction) {
  return {
    emptyTitle: t('common:skillsList.empty.title'),
    emptyDescription: t('common:skillsList.empty.description'),
    learnMore: t('common:skillsList.empty.learnMore'),
    addSkill: t('common:skillsList.empty.addSkill'),
  }
}
