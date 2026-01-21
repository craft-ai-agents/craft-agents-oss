/**
 * Translation file entry point
 * Re-exports all translation files and types
 */

import en from './en';
import zh from './zh';

// Export all translations
export const translations = {
  en,
  zh
} as const;

// Export translation types
export type TranslationKey = keyof typeof en;
export type Language = 'en' | 'zh';

// Export individual translation files
export { en, zh };
