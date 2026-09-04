export const DESKTOP_WINDOWS_DOWNLOAD_URL = '/downloads/Jonwork-Setup-x64.exe'
export const DESKTOP_UPDATE_BASE_URL = 'https://v2.jonwork.com/desktop/updates/'

export function isWebDesktopDownload(protocol: string, url: string): boolean {
  return /^https?:$/.test(protocol) && url === DESKTOP_WINDOWS_DOWNLOAD_URL
}
