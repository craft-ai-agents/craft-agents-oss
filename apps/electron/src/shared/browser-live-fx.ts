export type BrowserLiveFxPlatform = 'darwin' | 'win32' | 'linux' | 'other'

export interface BrowserLiveFxCornerRadii {
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomRight: string
}

export const BROWSER_LIVE_FX_BORDER = {
  width: '1.5px',
  style: 'solid',
  color: 'var(--accent)',
  boxShadow:
    'inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent), inset 0 0 20px color-mix(in oklab, var(--accent) 28%, transparent)',
} as const

export function getBrowserLiveFxCornerRadii(platform: BrowserLiveFxPlatform): BrowserLiveFxCornerRadii {
  const bottomRadius = platform === 'darwin' ? 12 : platform === 'win32' ? 8 : 6

  return {
    topLeft: '0px',
    topRight: '0px',
    bottomLeft: `${bottomRadius}px`,
    bottomRight: `${bottomRadius}px`,
  }
}
