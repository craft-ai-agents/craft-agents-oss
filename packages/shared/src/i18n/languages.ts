import { LOCALE_REGISTRY, type LanguageCode } from "./registry";

export type { LanguageCode } from "./registry";

/** Default UI language when no valid persisted choice is available. */
export const DEFAULT_LANGUAGE_CODE: LanguageCode = "ru";

export interface LanguageConfig {
  nativeName: string;
}

/** All supported language codes, derived from the locale registry. */
export const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[] = Object.keys(
  LOCALE_REGISTRY,
) as LanguageCode[];

/** Runtime guard for persisted or externally supplied language codes. */
export function isSupportedLanguageCode(
  value: unknown,
): value is LanguageCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LOCALE_REGISTRY, value)
  );
}

/** Language display metadata, derived from the locale registry. */
export const LANGUAGES: Record<LanguageCode, LanguageConfig> =
  Object.fromEntries(
    Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
      code,
      { nativeName: entry.nativeName },
    ]),
  ) as Record<LanguageCode, LanguageConfig>;
