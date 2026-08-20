/**
 * Canonical locale registry — single source of truth for all supported locales.
 *
 * To add a new locale:
 * 1. Create the locale JSON file in ./locales/
 * 2. Import the messages and date-fns locale below
 * 3. Add one entry to LOCALE_REGISTRY
 *
 * Everything else (SUPPORTED_LANGUAGE_CODES, LANGUAGES, i18n resources,
 * date locale lookup) is derived automatically. No other file needs to change.
 */

import type { Locale } from "date-fns";

// ─── Translation resources ───────────────────────────────────────────────────
import enMessages from "./locales/en.json";
import ruMessages from "./locales/ru.json";
import esMessages from "./locales/es.json";
import zhHansMessages from "./locales/zh-Hans.json";
import jaMessages from "./locales/ja.json";
import deMessages from "./locales/de.json";
import koMessages from "./locales/ko.json";
import arMessages from "./locales/ar.json";

// ─── date-fns locales ────────────────────────────────────────────────────────
import { enUS } from "date-fns/locale/en-US";
import { ru as ruDateLocale } from "date-fns/locale/ru";
import { es as esDateLocale } from "date-fns/locale/es";
import { zhCN } from "date-fns/locale/zh-CN";
import { ja as jaDateLocale } from "date-fns/locale/ja";
import { de as deDateLocale } from "date-fns/locale/de";
import { ko as koDateLocale } from "date-fns/locale/ko";
import { ar as arDateLocale } from "date-fns/locale/ar";

// ─── Registry ────────────────────────────────────────────────────────────────

interface LocaleEntry {
  nativeName: string;
  messages: Record<string, string>;
  dateLocale: Locale;
}

export const LOCALE_REGISTRY = {
  en: { nativeName: "English", messages: enMessages, dateLocale: enUS },
  ru: { nativeName: "Русский", messages: ruMessages, dateLocale: ruDateLocale },
  es: { nativeName: "Español", messages: esMessages, dateLocale: esDateLocale },
  "zh-Hans": {
    nativeName: "简体中文",
    messages: zhHansMessages,
    dateLocale: zhCN,
  },
  ja: { nativeName: "日本語", messages: jaMessages, dateLocale: jaDateLocale },
  de: {
    nativeName: "Deutsch",
    messages: deMessages,
    dateLocale: deDateLocale,
  },
  ko: { nativeName: "한국어", messages: koMessages, dateLocale: koDateLocale },
  ar: { nativeName: "العربية", messages: arMessages, dateLocale: arDateLocale },
} satisfies Record<string, LocaleEntry>;

export type LanguageCode = keyof typeof LOCALE_REGISTRY;
