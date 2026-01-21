/**
 * useTranslation Hook
 *
 * Simple translation hook for Craft Agents
 * Provides type-safe translation function with language switching
 */

import { useCallback, useEffect, useState } from 'react';
import { translations, type TranslationKey, type Language } from './locales';

const LANGUAGE_STORAGE_KEY = 'craft-agents-language';

export interface UseTranslationReturn {
  /** Current language code */
  language: Language;
  /** Translation function - use like t('newChat') */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Change the current language */
  changeLanguage: (lang: Language) => void;
  /** Check if a translation key exists */
  exists: (key: TranslationKey) => boolean;
}

/**
 * Hook for accessing translations and managing language
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t, language, changeLanguage } = useTranslation();
 *
 *   return (
 *     <div>
 *       <p>{t('newChat')}</p>
 *       <button onClick={() => changeLanguage('zh')}>中文</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTranslation(): UseTranslationReturn {
  const [language, setLanguage] = useState<Language>(() => {
    // Initialize from localStorage or default to 'en'
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
      if (saved === 'en' || saved === 'zh') {
        return saved;
      }
    }
    return 'en';
  });

  // Load saved language on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
      if (saved && (saved === 'en' || saved === 'zh')) {
        setLanguage(saved);
      }
    }
  }, []);

  // Translation function with interpolation support
  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    let translation: string = translations[language]?.[key] || translations.en[key] || key;

    // Handle interpolation: {{variableName}}
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        translation = translation.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(value));
      });
    }

    return translation;
  }, [language]);

  // Check if translation key exists
  const exists = useCallback((key: TranslationKey): boolean => {
    return key in translations.en;
  }, []);

  // Change language and persist to localStorage
  const changeLanguage = useCallback((lang: Language) => {
    if (lang === 'en' || lang === 'zh') {
      setLanguage(lang);
      if (typeof window !== 'undefined') {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      }
    }
  }, []);

  return {
    language,
    t,
    changeLanguage,
    exists
  };
}
