/**
 * Type declarations for qrcode-terminal
 *
 * The package doesn't include TypeScript types.
 */

declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean
  }

  function generate(
    text: string,
    options?: QRCodeOptions,
    callback?: (qrcode: string) => void
  ): void

  function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void
}
