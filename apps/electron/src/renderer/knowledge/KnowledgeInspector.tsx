/**
 * KnowledgeInspector — inspector sections for the active knowledge (SiYuan) ref (W2).
 *
 * Sections, each hidden when empty:
 * - PROPERTIES: node attributes (the provider already surfaces custom-* IAL keys only).
 * - BACKLINKS: provider backlinks; clicking navigates via routes.view.siyuan.
 * - OUTLINE: headings parsed locally from node markdown (./outline-parser — no new dep).
 *
 * Data flows through the P1 read-only RPC surface only
 * (window.electronAPI.knowledge.listConnections/get/getBacklinks) — no main-process
 * probing beyond the contracted channels. P1 ships a single SiYuan connection, so the
 * first connection from listConnections() wins; per-connection selection lands with the
 * navigator slice.
 *
 * Prop note: the prop is named `knowledgeRef`, not `ref` as the cross-slice contract
 * phrases it — this app runs React 18, which strips a prop literally named `ref`
 * before it reaches the component.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@/contexts/NavigationContext'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'
import { parseOutline } from './outline-parser'
import type { ContextPayload, KnowledgeNode, KnowledgeRef } from '../../shared/types'

export interface KnowledgeInspectorProps {
  knowledgeRef: KnowledgeRef | null
}

export interface KnowledgeNodeState {
  node: KnowledgeNode | null
  backlinks: ContextPayload['backlinks']
  loading: boolean
  error: string | null
}

const EMPTY_STATE: KnowledgeNodeState = { node: null, backlinks: [], loading: false, error: null }

/**
 * Loads node + backlinks for a knowledge ref through the P1 read-only RPC.
 * Shared with KnowledgeAgentPanel so both surfaces read one consistent snapshot.
 * Deps are the ref's primitives (not the object) so route-derived ref objects
 * re-created per render cannot retrigger the fetch loop.
 */
export function useKnowledgeNode(knowledgeRef: KnowledgeRef | null): KnowledgeNodeState {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const scheme = knowledgeRef?.scheme
  const kind = knowledgeRef?.kind
  const id = knowledgeRef?.id
  const provider = knowledgeRef?.provider
  const [state, setState] = React.useState<KnowledgeNodeState>(EMPTY_STATE)

  React.useEffect(() => {
    if (!scheme || !kind || !id || !workspaceId) {
      setState(EMPTY_STATE)
      return
    }
    const ref: KnowledgeRef = { scheme, kind, id, ...(provider ? { provider } : {}) }
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    void (async () => {
      try {
        const connections = await window.electronAPI.knowledge.listConnections()
        const connectionId = connections[0]?.id
        if (!connectionId) throw new Error(t('knowledge.inspector.noConnection'))
        const args = { workspaceId, connectionId, ref }
        const [node, backlinks] = await Promise.all([
          window.electronAPI.knowledge.get(args),
          window.electronAPI.knowledge.getBacklinks(args),
        ])
        if (!cancelled) setState({ node, backlinks, loading: false, error: null })
      } catch (error) {
        if (!cancelled) {
          setState({ node: null, backlinks: [], loading: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scheme, kind, id, provider, workspaceId, t])

  return state
}

function InspectorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  )
}

export function KnowledgeInspector({ knowledgeRef }: KnowledgeInspectorProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { node, backlinks, loading, error } = useKnowledgeNode(knowledgeRef)

  if (!knowledgeRef) {
    return (
      <InspectorShell title={t('knowledge.inspector.title')}>
        <p className="text-xs text-muted-foreground">{t('knowledge.openFullInterface')}</p>
      </InspectorShell>
    )
  }

  if (loading && !node) {
    return (
      <InspectorShell title={t('knowledge.inspector.title')}>
        <p className="text-xs text-muted-foreground">{t('knowledge.surface.loading')}</p>
      </InspectorShell>
    )
  }

  if (error) {
    return (
      <InspectorShell title={t('knowledge.inspector.title')}>
        <p className="text-xs text-destructive">{t('knowledge.surface.error')}</p>
        <p className="break-words text-xs text-muted-foreground">{error}</p>
      </InspectorShell>
    )
  }

  const outline = node?.markdown ? parseOutline(node.markdown) : []

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-sm font-medium">{t('knowledge.inspector.title')}</h2>

      {node && node.attributes.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.properties')}
          </h3>
          <dl className="space-y-1">
            {node.attributes.map((attr) => (
              <div key={attr.key} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="shrink-0 text-muted-foreground">{attr.key}</dt>
                <dd className="truncate">{attr.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {backlinks.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.backlinks')}
          </h3>
          <ul className="space-y-0.5">
            {backlinks.map((backlink) => (
              <li key={`${backlink.ref.kind}/${backlink.ref.id}`}>
                <button
                  type="button"
                  className="w-full truncate text-left text-xs text-foreground hover:underline"
                  onClick={() =>
                    navigate(routes.view.siyuan({ kind: backlink.ref.kind, id: backlink.ref.id }))
                  }
                >
                  {backlink.title || backlink.ref.id}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outline.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t('knowledge.inspector.outline')}
          </h3>
          <ul className="space-y-0.5">
            {outline.map((heading) => (
              <li
                key={heading.line}
                className="truncate text-xs text-muted-foreground"
                style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
              >
                {heading.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
