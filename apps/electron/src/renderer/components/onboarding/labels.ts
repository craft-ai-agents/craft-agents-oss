import type { TFunction } from 'i18next'

export function getWelcomeLabels(t: TFunction) {
  return {
    title: t('onboarding:welcome.title'),
    titleExisting: t('onboarding:welcome.titleExisting'),
    description: t('onboarding:welcome.description'),
    descriptionExisting: t('onboarding:welcome.descriptionExisting'),
    cta: t('onboarding:welcome.cta'),
    ctaExisting: t('onboarding:welcome.ctaExisting'),
    loading: t('onboarding:welcome.loading'),
  }
}

export function getReauthLabels(t: TFunction) {
  return {
    title: t('onboarding:reauth.title'),
    description: t('onboarding:reauth.description'),
    descriptionSecondary: t('onboarding:reauth.descriptionSecondary'),
    note: t('onboarding:reauth.note'),
    login: t('onboarding:reauth.login'),
    loggingIn: t('onboarding:reauth.loggingIn'),
    reset: t('onboarding:reauth.reset'),
    error: t('onboarding:reauth.error'),
  }
}

export function getApiSetupLabels(t: TFunction) {
  return {
    title: t('onboarding:apiSetup.title'),
    description: t('onboarding:apiSetup.description'),
    recommended: t('onboarding:apiSetup.recommended'),
    back: t('onboarding:apiSetup.back'),
    continue: t('onboarding:apiSetup.continue'),
  }
}

export function getCredentialsLabels(t: TFunction) {
  return {
    apiKeyInvalid: t('onboarding:credentials.apiKey.errors.invalid'),
    customModelDefaultHint: t('onboarding:credentials.apiKey.modelHelp.custom'),
    customModelLabel: t('onboarding:credentials.apiKey.modelLabel'),
    optional: t('onboarding:credentials.apiKey.optional'),
    customPreset: t('onboarding:credentials.apiKey.presets.custom'),
    nonClaudeHint: t('onboarding:credentials.apiKey.modelHelp.nonClaude'),
    formatPrefix: t('onboarding:credentials.apiKey.modelHelp.formatPrefix'),
    browseModels: t('onboarding:credentials.apiKey.modelHelp.browseModels'),
    viewSupportedModels: t('onboarding:credentials.apiKey.modelHelp.viewSupportedModels'),
    ollamaHint: t('onboarding:credentials.apiKey.modelHelp.ollama'),
    back: t('onboarding:credentials.actions.back'),
    continue: t('onboarding:credentials.actions.continue'),
  }
}
