import { useEffect, useRef, useState } from 'react'
import { CANVAS_REVIEW_CHECKS, type CanvasReview, type CanvasReviewRequest } from '@craft-agent/session-tools-core/canvas-review'
import type { CanvasWorkflowRequest } from '@craft-agent/session-tools-core/canvas-workflows'

export interface CanvasResult {
  revision: number
  projectId: string
  sessionId: string
  previewPath: string
  files: string[]
  nodeIds?: string[]
  imageKeys?: string[]
  summary?: string
  review?: CanvasReview
  upstream?: { revision: number; reviewVersion: number }
  workflow?: CanvasWorkflowRequest
}

export function CanvasResultReview({ results, selected, locked, onSelect, onOpen, onFolder, onTask, onReview, onContinue }: {
  results: CanvasResult[]; selected: CanvasResult; locked: boolean
  onSelect: (revision: number) => void; onOpen: (path: string) => void; onFolder: (path: string) => void; onTask: (sessionId: string) => void
  onReview: (result: CanvasResult, review: CanvasReviewRequest) => Promise<void>
  onContinue: (result: CanvasResult, revisionRequest: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [checks, setChecks] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef<CanvasReviewRequest | null>(null)
  const busy = useRef(false)
  useEffect(() => { setExpanded(false); setChecks([]); setComment(''); setError(''); pending.current = null }, [selected.projectId, selected.revision])
  const submit = async (decision: CanvasReviewRequest['decision']) => {
    if (locked || busy.current) return
    const candidate = { decision, comment, checks, expectedVersion: selected.review?.version ?? 0 }
    // Preserve the exact request across a lost reply / failed record export.
    const previous = pending.current
    const same = previous && previous.decision === decision && previous.comment === comment && JSON.stringify(previous.checks) === JSON.stringify(checks)
    const request = same ? previous : { ...candidate, requestId: crypto.randomUUID() }
    pending.current = request
    busy.current = true; setSaving(true); setError('')
    try { await onReview(selected, request); pending.current = null; setExpanded(false); setChecks([]); setComment('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审查记录保存失败，请重试。') }
    finally { busy.current = false; setSaving(false) }
  }
  const status = selected.review?.decision === 'approved' ? '用户已批准本版本' : selected.review?.decision === 'changes_requested' ? '待修改' : '待用户审查'
  return <section aria-label="成果版本与审查" className="max-h-[45vh] overflow-auto border-b p-3 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <label>成果版本 <select aria-label="成果版本" className="rounded border bg-background px-2 py-1" disabled={saving || locked} value={selected.revision} onChange={event => onSelect(Number(event.target.value))}>
        {[...results].reverse().map(item => <option key={item.revision} value={item.revision}>#{item.revision} · {item.summary || `${item.files.length}项成果`}</option>)}
      </select></label>
      <span role="status">{status}</span>
      <button className="underline" onClick={() => onOpen(selected.previewPath)}>查看成果</button>
      {selected.files.filter(path => path.endsWith('.glb')).map(path => <button key={path} className="underline" onClick={() => onOpen(path)}>旋转预览GLB</button>)}
      <button className="underline" onClick={() => onFolder(selected.previewPath)}>打开成果文件夹</button>
      <button disabled={locked || saving} className="underline disabled:opacity-40" onClick={() => onTask(selected.sessionId)}>回到原任务</button>
      <button disabled={locked || saving} className="underline disabled:opacity-40" onClick={() => setExpanded(value => !value)}>{expanded ? '收起审查' : '审查 / 修改意见'}</button>
      {selected.review && <button disabled={locked || saving} className="underline disabled:opacity-40" onClick={() => onContinue(selected, selected.review?.decision === 'changes_requested')}>
        {selected.review.decision === 'changes_requested' ? '按意见继续修改' : selected.imageKeys?.length ? '用于下一步业务' : '基于报告继续会话'}
      </button>}
    </div>
    {selected.upstream && <p className="mt-2 text-xs text-muted-foreground">上游：成果 #{selected.upstream.revision}，审查记录 v{selected.upstream.reviewVersion}。新版本需重新审查。</p>}
    {selected.review && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">审查 v{selected.review.version} · {new Date(selected.review.reviewedAt).toLocaleString()} {selected.review.comment}</p>}
    {expanded && <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">批准仅针对所选成果版本，由你确认业务要求已满足；不代表系统完成了工程、安全或量产认证。可再次要求修改，历史记录保留。</p>
      {CANVAS_REVIEW_CHECKS.map(check => <label key={check.id} className="flex items-center gap-2"><input type="checkbox" checked={checks.includes(check.id)} disabled={saving || locked} onChange={event => setChecks(value => event.target.checked ? [...value, check.id] : value.filter(id => id !== check.id))} />{check.label}</label>)}
      <textarea aria-label="审查意见" className="w-full rounded border bg-background p-2" rows={3} maxLength={4000} disabled={saving || locked} value={comment} onChange={event => setComment(event.target.value)} placeholder="要求修改时必填：问题位置、应保留内容、预期调整结果" />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-4">
        <button className="underline disabled:opacity-40" disabled={saving || locked || checks.length !== CANVAS_REVIEW_CHECKS.length} onClick={() => void submit('approved')}>确认批准本版本</button>
        <button className="underline disabled:opacity-40" disabled={saving || locked || !comment.trim()} onClick={() => void submit('changes_requested')}>保存修改意见</button>
      </div>
    </div>}
  </section>
}
