/**
 * KnowledgeAgentPanel — compact agent companion for the knowledge surface (W2).
 *
 * Shows the current document as the context a future agent session would attach to.
 * Both CTAs are intentionally disabled: no renderer helper can create a session WITH
 * initial text today — useSessionActions has no createSession, and onCreateSession's
 * CreateSessionOptions carries no initial-message field (chat-input pre-fill is a
 * separate post-mount channel, not a trivial wiring). Disabled-with-tooltip is the
 * honest state instead of faking the flow; wiring lands with the agent-integration slice.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useKnowledgeNode } from './KnowledgeInspector'
import type { KnowledgeRef } from '../../shared/types'

export interface KnowledgeAgentPanelProps {
  knowledgeRef: KnowledgeRef | null
}

/**
 * '@siyuan/document/<id>' — mirrors formatKnowledgeDisplay from @craft-agent/core/knowledge,
 * inlined here because apps/electron does not take a runtime dependency on @craft-agent/core
 * (shared/types.ts documents this boundary).
 */
function formatKnowledgeDisplay(ref: KnowledgeRef): string {
  return `@${ref.provider ?? ref.scheme}/${ref.kind}/${ref.id}`
}

export function KnowledgeAgentPanel({ knowledgeRef }: KnowledgeAgentPanelProps) {
  const { t } = useTranslation()
  const { node, loading } = useKnowledgeNode(knowledgeRef)

  if (!knowledgeRef) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-medium">{t('knowledge.inspector.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('knowledge.openFullInterface')}</p>
      </div>
    )
  }

  const displayRef = formatKnowledgeDisplay(knowledgeRef)

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={node?.title ?? displayRef}>
          {loading && !node ? t('knowledge.surface.loading') : (node?.title ?? displayRef)}
        </p>
        <p className="truncate text-xs text-muted-foreground">{displayRef}</p>
      </div>
      {/* Wrapper owns the tooltip: the Button sets disabled:pointer-events-none,
          which would swallow title on the button itself. */}
      <div className="flex flex-col gap-2" title={t('knowledge.agent.ctasDisabled')}>
        <Button size="sm" disabled aria-disabled="true">
          {t('knowledge.agent.askAbout')}
        </Button>
        <Button size="sm" variant="outline" disabled aria-disabled="true">
          {t('knowledge.agent.openFullSession')}
        </Button>
      </div>
    </div>
  )
}
