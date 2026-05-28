import { describe, expect, mock, test } from 'bun:test'
import '../../../__tests__/mock-i18n'
import { setupI18n } from '@craft-agent/shared/i18n'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}))

setupI18n([initReactI18next])

mock.module('@/context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}))

mock.module('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/hooks/useDynamicStack', () => ({
  useDynamicStack: () => React.createRef(),
}))

const { ActiveOptionBadges } = await import('../ActiveOptionBadges')

const sessionStatuses = [
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--success)',
    icon: <span>status-dot</span>,
    iconColorable: true,
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--muted)',
    icon: <span>done-dot</span>,
    iconColorable: true,
  },
]

describe('ActiveOptionBadges — session state badge hidden (RPI-103)', () => {
  test('does not render a session state badge in the chat area', () => {
    const html = renderToStaticMarkup(
      <ActiveOptionBadges
        permissionMode="ask"
        sessionStatuses={sessionStatuses}
        currentSessionStatus="in-progress"
        onSessionStatusChange={() => {}}
      />,
    )

    expect(html).not.toContain('In Progress')
    expect(html).not.toContain('status-dot')
    expect(html).not.toContain('done-dot')
  })

  test('still renders permission mode badge when state is hidden', () => {
    const html = renderToStaticMarkup(
      <ActiveOptionBadges
        permissionMode="ask"
        sessionStatuses={sessionStatuses}
        currentSessionStatus="in-progress"
        onSessionStatusChange={() => {}}
      />,
    )

    expect(html).toContain('data-tutorial="permission-mode-dropdown"')
  })
})
