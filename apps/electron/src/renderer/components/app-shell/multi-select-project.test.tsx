import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'

// MultiSelectPanel pulls in modules bun can't load as they are: pdfjs's worker through
// @craft-agent/ui (Vite's `?url` import) and the theme context through the label menus (Vite's
// `import.meta.glob`). Mock them, then import the panel.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('@/context/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }))

let MultiSelectPanel: typeof import('./MultiSelectPanel').MultiSelectPanel
beforeAll(async () => {
  MultiSelectPanel = (await import('./MultiSelectPanel')).MultiSelectPanel
})

const projects = [{ id: 'app', slug: 'app', name: 'App project' }]

async function render(element: ReactElement): Promise<string> {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: { 'multiSelect.moveToProject': 'Move to Project' } } } })
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>)
}

describe('Move to Project in the multi-select panel', () => {
  it('is offered for a selection when there are projects to move to', async () => {
    expect(await render(<MultiSelectPanel count={2} projects={projects} onSetProject={() => {}} />)).toContain('Move to Project')
  })

  it('is left out without projects or without a handler', async () => {
    expect(await render(<MultiSelectPanel count={2} projects={[]} onSetProject={() => {}} />)).not.toContain('Move to Project')
    expect(await render(<MultiSelectPanel count={2} projects={projects} />)).not.toContain('Move to Project')
  })
})
