import { useEffect, useState } from 'react'
import { useTranslation } from "react-i18next"
import type { SessionProvenance } from '@craft-agent/shared/memory/types'

/**
 * Memory provenance strip (specs Y2/Y3): renders under the latest assistant
 * turn which memory artifacts were injected into the session's prompts
 * ("Учтено: N уроков · M скиллов"), plus a chip per lesson whose rule the
 * assistant's final text echoes verbatim (Y3, "Из урока: «start…»").
 *
 * Data comes from the sessions:getProvenance channel (F4). Provenance is
 * written once per prompt assembly, so an idempotent module-level cache keeps
 * this to a single IPC call per session id regardless of list re-renders and
 * remounts. Sessions without a record resolve to null and render nothing.
 */

interface MemoryProvenanceStripProps {
  sessionId: string
  /** Render only under the newest assistant turn; older turns stay clean. */
  isLatestAssistant: boolean
  /** Final assistant message text, matched against lesson rules (Y3). */
  messageText: string
}

const provenanceCache = new Map<string, SessionProvenance | null>()
const provenanceInflight = new Map<string, Promise<SessionProvenance | null>>()

function fetchProvenance(sessionId: string): Promise<SessionProvenance | null> {
  const cached = provenanceCache.get(sessionId)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = provenanceInflight.get(sessionId)
  if (!pending) {
    // null on failure: no record is indistinguishable from a fetch error for
    // this UI, and the strip simply stays invisible (no error surfacing).
    pending = window.electronAPI.getSessionProvenance(sessionId).catch(() => null)
    provenanceInflight.set(sessionId, pending)
  }
  return pending.then(result => {
    provenanceCache.set(sessionId, result)
    provenanceInflight.delete(sessionId)
    return result
  })
}

export function MemoryProvenanceStrip({ sessionId, isLatestAssistant, messageText }: MemoryProvenanceStripProps) {
  const { t } = useTranslation()
  const [provenance, setProvenance] = useState<SessionProvenance | null>(
    () => provenanceCache.get(sessionId) ?? null
  )

  useEffect(() => {
    if (!isLatestAssistant) return
    let cancelled = false
    void fetchProvenance(sessionId).then(result => {
      if (!cancelled) setProvenance(result)
    })
    return () => { cancelled = true }
  }, [sessionId, isLatestAssistant])

  if (!isLatestAssistant || !provenance) return null
  const lessonCount = provenance.lessons.length
  const skillCount = provenance.skills.length
  if (lessonCount === 0 && skillCount === 0) return null

  // Matching convention: lowercase + collapsed whitespace. Y3 shows a chip
  // per lesson whose first ~6 words appear in the final assistant text; a
  // fragment needs >4 words for the match to be meaningful; dupes collapse.
  const fragments = provenance.lessons.map(lesson =>
    lesson.rule.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  )
  const normalizedMessage = messageText.toLowerCase().replace(/\s+/g, ' ').trim()
  const seen = new Set<string>()
  const appliedFragments = fragments.filter(fragment => {
    if (fragment.split(' ').length <= 4 || seen.has(fragment)) return false
    seen.add(fragment)
    return normalizedMessage.includes(fragment)
  })

  const rulesTitle = fragments.join('\n')

  return (
    <div className="mt-1.5 flex flex-col items-start gap-1 pl-1 select-none">
      {appliedFragments.map(fragment => (
        <span
          key={fragment}
          className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent/70"
        >
          {t('memory.fromLesson', { fragment: `${fragment}…` })}
        </span>
      ))}
      <span className="text-[11px] text-muted-foreground/60" title={rulesTitle || undefined}>
        {t('memory.usedInTurn', { lessons: lessonCount, skills: skillCount })}
      </span>
    </div>
  )
}
