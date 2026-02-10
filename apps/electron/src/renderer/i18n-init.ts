import { initRendererI18n } from './i18n'
import { STARTUP_RENDERER_NAMESPACES } from './i18n-namespaces'

void initRendererI18n({ namespaces: [...STARTUP_RENDERER_NAMESPACES] }).catch((error) => {
  console.error('Failed to initialize renderer i18n:', error)
})
