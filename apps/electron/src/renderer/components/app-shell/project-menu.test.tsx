import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { forwardRef, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ProjectMenuItems } from './ProjectMenuItems'
import type { MenuComponents } from '@/components/ui/menu-context'

const projects = [{ id: 'app', slug: 'app', name: 'App project' }]

async function render(element: ReactElement): Promise<string> {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    keySeparator: false,
    resources: { en: { translation: { 'sessionMenu.noProject': 'No project' } } },
  })
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>)
}

/** Menu primitives that record each item's click */
function recordingMenu() {
  const actions: (() => void)[] = []
  const MenuItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<MenuComponents['MenuItem']>>(({ onClick, children }, ref) => {
    if (onClick) actions.push(() => onClick({} as Parameters<typeof onClick>[0]))
    return <div ref={ref}>{children}</div>
  })
  const Separator = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<MenuComponents['Separator']>>((_, ref) => <div ref={ref} role='separator' />)
  return { actions, menu: { MenuItem, Separator } }
}

describe('the shared project picker', () => {
  it('uses the same project identifiers and no-project choice as the single-chat menu', async () => {
    const { actions, menu } = recordingMenu()
    const chosen: (string | null)[] = []
    const html = await render(<ProjectMenuItems projects={projects} activeProjectId={undefined} onSelect={id => chosen.push(id)} menu={menu} />)

    expect(html).toContain('App project')
    expect(html).toContain('No project')
    expect(html).not.toContain('lucide-check')
    for (const action of actions) action()
    expect(chosen).toEqual([null, 'app'])
  })

  it('checks the project the chats share, or No project when none has one', async () => {
    const checkedRow = async (activeProjectId: string | null) => {
      const html = await render(<ProjectMenuItems projects={projects} activeProjectId={activeProjectId} onSelect={() => {}} menu={recordingMenu().menu} />)
      const rows = html.split('</div>').filter(row => row.includes('lucide-check'))
      expect(rows).toHaveLength(1)
      return rows[0]
    }
    expect(await checkedRow(null)).toContain('No project')
    expect(await checkedRow('app')).toContain('App project')
  })
})
