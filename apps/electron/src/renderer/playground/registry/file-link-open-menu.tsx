/**
 * Playground: the file-link menu (`FileLinkActionMenu`), opened from a real Markdown file link,
 * so it goes through the same click path as the transcript (`describeFileLinkClick` →
 * `routeFileOpen`). Click the link to open the menu; ⌥-click skips it. Actions are logged here.
 */

import * as React from 'react'
import { Markdown, type FileLinkClick } from '@craft-agent/ui'
import type { ComponentEntry } from './types'
import { FileLinkActionMenu } from '@/components/app-shell/FileLinkActionMenu'
import { routeFileOpen, type FileLinkMenuState } from '@/components/app-shell/file-link-menu'

const PROJECT = '/Users/alex/projects/weather-dashboard'
const HTML_PATH = `${PROJECT}/sessions/260101-quiet-river/data/forecast-grid.html`

interface FileLinkMenuDemoProps {
  /** The linked file */
  path?: string
  /** Open the menu under the link on load (otherwise click the link) */
  open?: boolean
}

const log = (action: string) => (path: string) => console.log(`[Playground] ${action}:`, path)

function FileLinkMenuDemo({ path = HTML_PATH, open = true }: FileLinkMenuDemoProps) {
  const [menu, setMenu] = React.useState<FileLinkMenuState | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Open under the link on load, as a click would.
  React.useLayoutEffect(() => {
    const link = open ? containerRef.current?.querySelector('a') : null
    const box = link ? (link.getClientRects()[0] ?? link.getBoundingClientRect()) : null
    setMenu(box ? { path, anchor: { x: box.left, y: box.top, width: box.width, height: box.height } } : null)
  }, [path, open])

  const handleFileClick = (filePath: string, click?: FileLinkClick) => {
    const route = routeFileOpen(click, true)
    if (route.kind === 'menu') setMenu({ path: filePath, anchor: route.anchor })
    else log(route.kind === 'external' ? '⌥-click, open in default app' : 'open')(filePath)
  }

  return (
    <div ref={containerRef} className="w-[520px] max-w-full rounded-xl bg-paper p-4 text-copy text-foreground shadow-elev-1">
      <Markdown mode="minimal" onFileClick={handleFileClick}>
        {`**The forecast grid**\n\nI built a clickable mock of the dashboard so the states are settled before wiring up the API:\n\n[${path}](<${path}>)`}
      </Markdown>
      <FileLinkActionMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onOpenExternal={log('open in default app')}
        onPreview={log('preview here')}
        onReveal={log('show in file manager')}
      />
    </div>
  )
}

export const fileLinkOpenMenuComponents: ComponentEntry[] = [
  {
    id: 'file-link-open-menu',
    name: 'File link · Open menu',
    category: 'Markdown',
    description:
      'Clicking a local file link offers: open outside the app (the browser for .html/.htm, the default app otherwise), Preview here (types with an in-app preview), Show in Finder, Copy path. ⌥-click skips the menu.',
    component: FileLinkMenuDemo,
    layout: 'centered',
    previewOverflow: 'visible',
    props: [
      { name: 'path', description: 'Linked file (try .html, .tsx, .zip)', control: { type: 'string' }, defaultValue: HTML_PATH },
      { name: 'open', description: 'Open the menu on load', control: { type: 'boolean' }, defaultValue: true },
    ],
    variants: [
      { name: 'HTML page · browser', props: { path: HTML_PATH, open: true } },
      { name: 'Code file · default app', props: { path: `${PROJECT}/src/components/ForecastCard.tsx`, open: true } },
      { name: 'No in-app preview', props: { path: `${PROJECT}/exports/forecast-assets.zip`, open: true } },
    ],
  },
]
