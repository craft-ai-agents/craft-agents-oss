/**
 * i18n Module Entry Point
 *
 * Exports all internationalization functionality
 */

// Main exports
export { TranslationProvider, useTranslationContext, useTranslation } from './TranslationContext';
export type { TranslationProviderProps } from './TranslationContext';
export type { UseTranslationReturn } from './useTranslation';

// Translation types and data
export { translations, en, zh } from './locales';
export type { TranslationKey, Language } from './locales';
