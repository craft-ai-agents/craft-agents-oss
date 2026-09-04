import * as React from 'react'
import { Check, Circle, FileCheck2, LoaderCircle, MessageCircleQuestion, Paperclip, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SessionFile } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { restoreSessionFileWatch } from './session-files-watch'
import {
  analyzeDeliverableWorkflow,
  findSessionFile,
  type DeliverableManifest,
} from './deliverable-workflow-state'

interface DeliverableBriefSectionProps {
  sessionId: string | null
  isProcessing?: boolean
}

export function DeliverableBriefSection({ sessionId, isProcessing }: DeliverableBriefSectionProps) {
  const { t } = useTranslation()
  const { onSendMessage } = useAppShellContext()
  const session = useSession(sessionId ?? '__no_active_session__')
  const [files, setFiles] = React.useState<SessionFile[]>([])
  const [manifest, setManifest] = React.useState<DeliverableManifest | null>(null)
  const [loading, setLoading] = React.useState(false)

  const loadState = React.useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      setManifest(null)
      return
    }
    setLoading(true)
    try {
      const entries = await window.electronAPI.getSessionFiles(sessionId)
      setFiles(entries)
      const manifestFile = findSessionFile(entries, 'deliverable-manifest.json')
      if (!manifestFile) {
        setManifest(null)
      } else {
        try {
          setManifest(JSON.parse(await window.electronAPI.readFile(manifestFile.path)) as DeliverableManifest)
        } catch {
          setManifest(null)
        }
      }
    } catch (error) {
      console.error('[DeliverableBrief] Failed to load workflow state:', error)
      setFiles([])
      setManifest(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    void loadState()
    if (!sessionId) return
    void window.electronAPI.watchSessionFiles(sessionId)
    const offFiles = window.electronAPI.onSessionFilesChanged(changedId => {
      if (changedId === sessionId) void loadState()
    })
    const offReconnect = window.electronAPI.onReconnected(() => {
      void restoreSessionFileWatch(sessionId, loadState)
    })
    return () => {
      offFiles()
      offReconnect()
      void window.electronAPI.unwatchSessionFiles()
    }
  }, [sessionId, loadState])

  if (!sessionId || !session) {
    return <EmptyState text={t('rightDock.selectSession')} />
  }

  const state = analyzeDeliverableWorkflow(session.messages, files, manifest)
  const steps = [
    { label: t('rightDock.workflowGoal'), complete: state.hasConversation },
    { label: t('rightDock.workflowSkills'), complete: state.hasSkillSelection },
    { label: t('rightDock.workflowMaterials', { count: state.materialCount }), complete: state.materialsReady },
    { label: t('rightDock.workflowBrief'), complete: state.briefConfirmed },
    { label: t('rightDock.workflowDeliverables', { count: state.deliverableCount }), complete: state.deliverableCount > 0 },
    { label: t('rightDock.workflowValidation'), complete: state.hasValidation && state.acceptanceCriteriaPassed },
    { label: t('rightDock.workflowApproval'), complete: state.hasApproval },
  ]

  const sendWorkflowPrompt = (key: 'intake' | 'confirmBrief' | 'finalize' | 'repair' | 'approve') => {
    if (isProcessing) return
    onSendMessage(sessionId, t(`rightDock.${key}Prompt`))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <div className="rounded-xl bg-foreground/[0.025] p-3.5">
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            state.isFinal ? 'bg-emerald-500/10 text-emerald-600' : 'bg-accent/10 text-accent',
          )}>
            {state.isFinal ? <FileCheck2 className="h-4 w-4" /> : <MessageCircleQuestion className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{state.isFinal ? t('rightDock.workflowFinal') : t('rightDock.workflowTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-foreground/45">{t('rightDock.workflowDescription')}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {steps.map(step => (
          <div key={step.label} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs">
            {step.complete
              ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-3 w-3" /></span>
              : <Circle className="h-5 w-5 text-foreground/20" />}
            <span className={step.complete ? 'text-foreground/75' : 'text-foreground/45'}>{step.label}</span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="mt-2 flex items-center gap-2 px-2 text-xs text-foreground/40">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />{t('chat.sessionFilesLoading')}
        </div>
      )}

      <div className="mt-auto grid gap-2 pt-5">
        <Button variant="outline" className="justify-start" disabled={isProcessing} onClick={() => sendWorkflowPrompt('intake')}>
          <MessageCircleQuestion className="mr-2 h-4 w-4" />
          {state.hasBrief ? t('rightDock.refineBrief') : t('rightDock.startIntake')}
        </Button>
        <Button
          variant="outline"
          className="justify-start"
          disabled={isProcessing}
          onClick={() => window.dispatchEvent(new CustomEvent('craft:open-attachment-picker', { detail: { sessionId } }))}
        >
          <Paperclip className="mr-2 h-4 w-4" />{t('rightDock.addMaterials')}
        </Button>
        {state.hasBrief && !state.briefConfirmed && (
          <Button className="justify-start" disabled={isProcessing} onClick={() => sendWorkflowPrompt('confirmBrief')}>
            <Check className="mr-2 h-4 w-4" />{t('rightDock.confirmBrief')}
          </Button>
        )}
        <Button
          className="justify-start"
          disabled={isProcessing || !state.briefConfirmed || !state.materialsReady || !state.hasSkillSelection}
          onClick={() => sendWorkflowPrompt('finalize')}
        >
          {isProcessing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {t('rightDock.generateFinal')}
        </Button>
        {state.deliverableCount > 0 && (!state.hasValidation || !state.acceptanceCriteriaPassed) && (
          <Button variant="outline" className="justify-start" disabled={isProcessing} onClick={() => sendWorkflowPrompt('repair')}>
            <RotateCcw className="mr-2 h-4 w-4" />{t('rightDock.repairDeliverables')}
          </Button>
        )}
        {state.hasValidation && state.acceptanceCriteriaPassed && !state.hasApproval && (
          <Button className="justify-start" disabled={isProcessing} onClick={() => sendWorkflowPrompt('approve')}>
            <ShieldCheck className="mr-2 h-4 w-4" />{t('rightDock.approveFinal')}
          </Button>
        )}
        {!state.briefConfirmed && <p className="px-1 text-[11px] leading-4 text-foreground/35">{t('rightDock.briefRequired')}</p>}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full min-h-56 items-center justify-center px-8 text-center text-xs text-foreground/40">{text}</div>
}
