import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readJsonFileSync } from '../utils/files.ts';
import { ensureConfigDir } from '../config/storage.ts';
import { CONFIG_DIR } from '../config/paths.ts';
import { i18n } from './setupI18n.ts';
import { LOCALE_REGISTRY, type LanguageCode } from './registry.ts';

const APP_LANGUAGE_FILE = join(CONFIG_DIR, 'app-language.json');

function isSupportedLanguageCode(value: string): value is LanguageCode {
  return value in LOCALE_REGISTRY;
}

export function loadPersistedAppLanguage(): LanguageCode | null {
  try {
    if (!existsSync(APP_LANGUAGE_FILE)) return null;
    const data = readJsonFileSync<{ language?: string }>(APP_LANGUAGE_FILE);
    const language = data?.language;
    return language && isSupportedLanguageCode(language) ? language : null;
  } catch {
    return null;
  }
}

export function persistAppLanguage(language: string): LanguageCode | null {
  if (!isSupportedLanguageCode(language)) return null;
  ensureConfigDir();
  writeFileSync(APP_LANGUAGE_FILE, JSON.stringify({ language }, null, 2), 'utf-8');
  return language;
}

export function resolveAppLanguage(defaultLanguage: LanguageCode = 'en'): LanguageCode {
  const resolved = i18n.resolvedLanguage;
  if (resolved && isSupportedLanguageCode(resolved)) {
    return resolved;
  }
  return loadPersistedAppLanguage() ?? defaultLanguage;
}

export function applyPersistedAppLanguage(defaultLanguage: LanguageCode = 'en'): LanguageCode {
  const language = resolveAppLanguage(defaultLanguage);
  void i18n.changeLanguage(language);
  return language;
}
