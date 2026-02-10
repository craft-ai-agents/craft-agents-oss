import type { TFunction } from 'i18next'

export function getAppShellLabels(t: TFunction) {
  return {
    newChat: t('common:navigation.newChat'),
    allChats: t('common:navigation.allChats'),
    allSkills: t('common:navigation.allSkills'),
    helpDocs: t('common:navigation.helpDocs'),
    labels: t('common:navigation.labels'),
    settings: t('common:navigation.settings'),
    sources: t('common:navigation.sources'),
    skills: t('common:navigation.skills'),
    statuses: t('common:navigation.status'),
    apis: t('common:navigation.apis'),
    mcps: t('common:navigation.mcps'),
    localFolders: t('common:navigation.localFolders'),
    permissions: t('common:navigation.permissions'),
    views: t('common:navigation.views'),
    allDocumentation: t('common:navigation.allDocumentation'),
    filterChats: t('common:filters.filterChats'),
    clear: t('common:filters.clear'),
    searchPlaceholder: t('common:filters.searchPlaceholder'),
    flagged: t('common:navigation.flagged'),
    filterStatuses: t('common:filters.statuses'),
    filterLabels: t('common:filters.labels'),
    noLabelsConfigured: t('common:filters.noLabelsConfigured'),
    noMatchingFilters: t('common:filters.noMatchingFilters'),
    search: t('common:filters.search'),
    addSource: t('common:menu.addSource'),
    addSkill: t('common:menu.addSkill'),
  }
}
