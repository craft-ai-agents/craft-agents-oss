import * as React from 'react'
import type { ComponentEntry } from './types'
import { CraftPageBlock, PlatformProvider } from '@craft-agent/ui'

/**
 * Craft Pages block demo.
 *
 * Needs a live pages server to resolve a wrapper URL, so it discovers one at
 * `http://127.0.0.1:7777/demo-info`. Start it with
 * `bun run scripts/dev/craft-pages-demo.ts`. Without
 * it the block renders its "unavailable" state, which is itself the behaviour
 * worth seeing — a host that cannot serve pages must degrade quietly rather
 * than error.
 */
function WithPages({ children }: { children: React.ReactNode }) {
  const resolve = React.useCallback(async (_pageId: string) => {
    try {
      const r = await fetch('http://127.0.0.1:7777/demo-info')
      if (!r.ok) return null
      return (await r.json()).url as string
    } catch {
      return null
    }
  }, [])
  return <PlatformProvider actions={{ onResolvePageUrl: resolve }}>{children}</PlatformProvider>
}

function Demo({ code }: { code: string }) {
  return (
    <WithPages>
      <div className="max-w-[720px]">
        <CraftPageBlock code={code} />
      </div>
    </WithPages>
  )
}

export const craftPagesComponents: ComponentEntry[] = [
  {
    id: 'craft-page-block',
    name: 'CraftPageBlock',
    category: 'Markdown',
    description:
      'The ```craft-page fence: a compact card in the transcript, with the page opening in a framed wrapper. Requires the demo server on :7777.',
    component: Demo,
    props: [
      {
        name: 'code',
        description: 'Fence payload. rev drives remount — bump it and the frame reloads.',
        control: { type: 'textarea', rows: 5 },
        defaultValue: '{\n  "pageId": "591e06da-b433-43e1-a95b-2e4cb018a93d",\n  "rev": 1,\n  "title": "Wildflower Pottery"\n}',
      },
    ],
    variants: [
      {
        name: 'Ready',
        description: 'Valid spec with a live page behind it',
        props: { code: '{"pageId":"591e06da-b433-43e1-a95b-2e4cb018a93d","rev":1,"title":"Wildflower Pottery"}' },
      },
      {
        name: 'Revision 2',
        description: 'Same page, bumped rev — proves the frame key changes',
        props: { code: '{"pageId":"591e06da-b433-43e1-a95b-2e4cb018a93d","rev":2,"title":"Wildflower Pottery"}' },
      },
      {
        name: 'Untitled',
        description: 'No title supplied',
        props: { code: '{"pageId":"591e06da-b433-43e1-a95b-2e4cb018a93d","rev":1}' },
      },
      {
        name: 'Malformed — missing rev',
        description: 'rev is required; without it the stale-preview bug returns',
        props: { code: '{"pageId":"591e06da-b433-43e1-a95b-2e4cb018a93d"}' },
      },
      {
        name: 'Malformed — bad JSON',
        description: 'Falls back to showing the raw block',
        props: { code: '{not json at all' },
      },
    ],
  },
]
