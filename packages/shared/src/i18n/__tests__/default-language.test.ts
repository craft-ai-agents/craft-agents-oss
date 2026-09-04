import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

// Each case gets a fresh i18next singleton and a simulated browser, without
// touching the user's real language preference or browser storage.
function bootstrapLanguage(savedLanguage: string | null) {
  const script = `
    const values = new Map();
    const saved = ${JSON.stringify(savedLanguage)};
    if (saved) values.set('i18nextLng', saved);
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    };
    const navigator = { language: 'en-US', languages: ['en-US', 'en'] };
    Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
    globalThis.window = { localStorage: storage, navigator };
    const { default: LanguageDetector } = await import('i18next-browser-languagedetector');
    const { setupI18n } = await import('./setupI18n.ts');
    const i18n = setupI18n([LanguageDetector]);
    const initial = i18n.resolvedLanguage;
    const cached = storage.getItem('i18nextLng');
    await i18n.changeLanguage('ja');
    console.log(JSON.stringify({ initial, cached, changed: i18n.resolvedLanguage }));
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}

describe("default UI language", () => {
  it("defaults to Simplified Chinese even in an English browser", () => {
    expect(bootstrapLanguage(null)).toEqual({
      initial: "zh-Hans", cached: "zh-Hans", changed: "ja",
    });
  });

  it("preserves an explicitly saved language", () => {
    expect(bootstrapLanguage("en")).toEqual({
      initial: "en", cached: "en", changed: "ja",
    });
  });

  it("falls back to Simplified Chinese for unsupported saved languages", () => {
    expect(bootstrapLanguage("unsupported").initial).toBe("zh-Hans");
  });
});
