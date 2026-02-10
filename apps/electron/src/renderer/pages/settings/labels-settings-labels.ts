export function getLabelsSettingsLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:labels.pageTitle'),
    aboutTitle: t('settings:labels.about.title'),
    aboutParagraph1: t('settings:labels.about.paragraph1'),
    aboutParagraph2Prefix: t('settings:labels.about.paragraph2.prefix'),
    aboutParagraph2ValueLabel: t('settings:labels.about.paragraph2.valueLabel'),
    aboutParagraph2Suffix: t('settings:labels.about.paragraph2.suffix'),
    aboutParagraph3RuleLabel: t('settings:labels.about.paragraph3.ruleLabel'),
    aboutParagraph3Suffix: t('settings:labels.about.paragraph3.suffix'),
    learnMore: t('common:menu.learnMore'),
    hierarchyTitle: t('settings:labels.hierarchy.title'),
    hierarchyDescription: t('settings:labels.hierarchy.description'),
    hierarchyFullscreenTitle: t('settings:labels.hierarchy.fullscreenTitle'),
    hierarchyEmptyTitle: t('settings:labels.hierarchy.emptyTitle'),
    hierarchyEmptyDescriptionPrefix: t('settings:labels.hierarchy.emptyDescription.prefix'),
    hierarchyEmptyDescriptionSuffix: t('settings:labels.hierarchy.emptyDescription.suffix'),
    autoRulesTitle: t('settings:labels.autoRules.title'),
    autoRulesDescription: t('settings:labels.autoRules.description'),
    autoRulesFullscreenTitle: t('settings:labels.autoRules.fullscreenTitle'),
    editFile: t('common:actions.editFile'),
  }
}
