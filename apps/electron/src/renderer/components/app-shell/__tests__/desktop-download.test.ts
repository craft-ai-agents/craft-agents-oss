import { expect, test } from 'bun:test'
import { DESKTOP_UPDATE_BASE_URL, DESKTOP_WINDOWS_DOWNLOAD_URL, isWebDesktopDownload } from '../desktop-download'

test('web account menu uses the stable Windows installer path', () => {
  expect(DESKTOP_WINDOWS_DOWNLOAD_URL).toBe('/downloads/Jonwork-Setup-x64.exe')
  expect(DESKTOP_UPDATE_BASE_URL).toBe('https://v2.jonwork.com/desktop/updates/')
  expect(isWebDesktopDownload('https:', DESKTOP_WINDOWS_DOWNLOAD_URL)).toBe(true)
  expect(isWebDesktopDownload('file:', DESKTOP_WINDOWS_DOWNLOAD_URL)).toBe(false)
  expect(isWebDesktopDownload('https:', 'https://untrusted.example/installer.exe')).toBe(false)
})
