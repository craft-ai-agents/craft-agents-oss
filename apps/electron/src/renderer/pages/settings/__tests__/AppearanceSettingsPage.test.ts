import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appearanceSettingsPath = join(__dirname, '../AppearanceSettingsPage.tsx')
const source = readFileSync(appearanceSettingsPath, 'utf8')

describe('AppearanceSettingsPage zoom default', () => {
  it('renders the fresh-install 90% value before asynchronous config loading resolves', () => {
    expect(source).toContain('const [defaultZoomLevel, setDefaultZoomLevel] = useState(90)')
    expect(source).toContain('window.electronAPI?.getDefaultZoomLevel?.().then(setDefaultZoomLevel)')
  })
})
