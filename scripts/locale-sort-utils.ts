export function localeFormattingMatches(original: string, canonical: string): boolean {
  return canonical === original.replaceAll('\r\n', '\n')
}
