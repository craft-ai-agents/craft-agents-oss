/**
 * TranslationContext Provider
 *
 * React Context provider for translations
 * Wraps the useTranslation hook for easy access across components
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useTranslation, type UseTranslationReturn } from './useTranslation';

// Export the type
export type { UseTranslationReturn } from './useTranslation';

const TranslationContext = createContext<UseTranslationReturn | null>(null);

export interface TranslationProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that makes translations available to all child components
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <TranslationProvider>
 *       <MyComponent />
 *     </TranslationProvider>
 *   );
 * }
 * ```
 */
export function TranslationProvider({ children }: TranslationProviderProps) {
  const translation = useTranslation();

  // Memoize the value object to prevent unnecessary re-renders
  const value = useMemo(() => ({
    language: translation.language,
    t: translation.t,
    changeLanguage: translation.changeLanguage,
    exists: translation.exists
  }), [translation.language, translation.t, translation.changeLanguage, translation.exists]);

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}

/**
 * Hook to access translations from context
 * Must be used within a TranslationProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t, language, changeLanguage } = useTranslationContext();
 *   return <p>{t('newChat')}</p>;
 * }
 * ```
 */
export function useTranslationContext(): UseTranslationReturn {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslationContext must be used within a TranslationProvider');
  }
  return context;
}

// Re-export the useTranslation hook for convenience
export { useTranslation };
