/**
 * Opens a URL in the default browser.
 *
 * Uses dynamic import to handle ESM/CJS interop in bundled code.
 * The 'open' package is ESM-only, which causes issues when bundled
 * with esbuild for Electron. Dynamic import with fallback resolves this.
 *
 * ALWAYS use this instead of importing 'open' directly.
 * Direct imports will fail with: "(0 , import_open.default) is not a function"
 *
 * @param url - The URL to open in the default browser
 */
export async function openUrl(url: string): Promise<void> {
  const open = await import('open');
  const openFn = open.default || open;
  await openFn(url);
}
