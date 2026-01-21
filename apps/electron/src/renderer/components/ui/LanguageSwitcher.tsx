/**
 * LanguageSwitcher Component
 *
 * Language selection component for the Settings page
 * Allows users to switch between English and Chinese
 */

import React from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';

export interface LanguageSwitcherProps {
  className?: string;
}

/**
 * Language switcher component
 *
 * @example
 * ```tsx
 * <LanguageSwitcher />
 * ```
 */
export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { language, changeLanguage, t } = useTranslation();

  const handleLanguageChange = (newLang: 'en' | 'zh') => {
    if (newLang !== language) {
      changeLanguage(newLang);
    }
  };

  return (
    <div className={className}>
      <label className="text-sm font-medium">{t('selectLanguage' as any)}</label>
      <div className="mt-2 flex gap-2">
        <Button
          variant={language === 'en' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleLanguageChange('en')}
        >
          {t('english' as any)}
        </Button>
        <Button
          variant={language === 'zh' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleLanguageChange('zh')}
        >
          {t('chinese' as any)}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('languageChanged' as any)}
      </p>
    </div>
  );
}

export default LanguageSwitcher;
