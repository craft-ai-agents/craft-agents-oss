import { zhCN } from './locales/zh-CN';
import { enUS } from './locales/en-US';
import { useSettingsStore } from '@/atoms/settings';

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
  const settingsStore = useSettingsStore();
  return settingsStore.locale || 'en-US';
}

// 翻译函数
export function t(key: string, defaultValue: string = key): string {
  const settingsStore = useSettingsStore();
  const locale = settingsStore.locale || 'en-US';
  
  const keys = key.split('.');
  let result: any = messages[locale];
  
  for (const k of keys) {
    if (result?.[k] !== undefined) {
      result = result[k];
    } else {
      return defaultValue;
    }
  }
  
  return typeof result === 'string' ? result : defaultValue;
}

// 切换语言
export function setLocale(locale: Locale) {
  const settingsStore = useSettingsStore();
  settingsStore.setLocale(locale);
}
