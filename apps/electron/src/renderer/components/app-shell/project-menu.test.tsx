import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ProjectMenuItems } from './ProjectMenuItems'
import type { MenuComponents } from '@/components/ui/menu-context'

const projects = [{ id: 'app', slug: 'app', name: 'App project' }]

describe('the shared project picker', () => {
  it('uses the same project identifiers and no-project choice as the single-chat menu', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: { 'sessionMenu.noProject': 'No project' } } } })
    const actions: (() => void)[] = []
    const chosen: (string | null)[] = []
    const MenuItem: MenuComponents['MenuItem'] = ({ onClick, children }) => {
      if (onClick) actions.push(() => onClick({} as Parameters<NonNullable<typeof onClick>>[0]))
      return <div>{children}</div>
    }
    const Separator: MenuComponents['Separator'] = () => <hr />
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ProjectMenuItems projects={projects} activeProjectId={undefined} onSelect={id => chosen.push(id)} menu={{ MenuItem, Separator }} />
      </I18nextProvider>,
    )

    expect(html).toContain('App project')
    expect(html).toContain('No project')
    expect(html).not.toContain('lucide-check')
    for (const action of actions) action()
    expect(chosen).toEqual([null, 'app'])
  })
})
