import { zhCN } from './locales/zh-CN';
import { enUS } from './locales/en-US';
import { useAtom } from 'jotai';
import { settingsAtom } from '@/atoms/settings';

// 支持的语言类型
export type Locale = 'zh-CN' | 'en-US';

// 语言包类型
export interface LocaleMessages {
  [key: string]: string | LocaleMessages;
}

// 语言包映射
const messages: Record<Locale, LocaleMessages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

// 获取当前语言设置
export function useLocale() {
  const [settings] = useAtom(settingsAtom);
  return settings.locale || 'en-US';
}

// 切换语言
export function setLocale(locale: Locale) {
  // 这个函数在组件外部使用，我们直接更新localStorage
  // 注意：atom的更新需要在组件内使用useAtom来进行
  const currentSettings = localStorage.getItem('craft-agent-settings');
  const newSettings = currentSettings ? JSON.parse(currentSettings) : {};
  newSettings.locale = locale;
  localStorage.setItem('craft-agent-settings', JSON.stringify(newSettings));
}

// 翻译钩子 - 在组件内部使用
export function useTranslations() {
  const [settings] = useAtom(settingsAtom);
  
  const t = (key: string, defaultValueOrParams?: string | Record<string, string | number>, maybeParams?: Record<string, string | number>): string => {
    const locale = settings.locale || 'en-US';
    
    const keys = key.split('.');
    let result: any = messages[locale];
    
    for (const k of keys) {
      if (result?.[k] !== undefined) {
        result = result[k];
      } else {
        // 使用默认值
        if (typeof defaultValueOrParams === 'string') {
          return defaultValueOrParams;
        }
        return key;
      }
    }
    
    let text = typeof result === 'string' ? result : key;
    
    // 确定使用哪个参数对象
    const params = typeof defaultValueOrParams === 'object' ? defaultValueOrParams : maybeParams;
    
    // 参数替换
    if (params) {
      Object.keys(params).forEach(paramKey => {
        text = text.replace(new RegExp(`{${paramKey}}`, 'g'), String(params[paramKey]));
      });
    }
    
    return text;
  };
  
  return { t };
}
