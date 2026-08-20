/**
 * KnowledgeNotebookTree (W2, spec S-01 §Режим Знания) — left-nav section tree
 * for the Knowledge mode: notebooks + the static sections S-01 lists
 * (Inbox / Daily / Recent / Databases / Tags / Favorites / Saved Views).
 *
 * Data-mode notes:
 * - Notebooks rows are dynamic-empty: the P1 renderer surface
 *   (`window.electronAPI.knowledge`) exposes listConnections / capabilities /
 *   search / get / getContext / getBacklinks / engineStatus — but NO notebook
 *   listing RPC. A live tree replaces the empty state once such an RPC lands.
 * - Inbox/Daily/Recent/Databases/Tags/Favorites/SavedViews are static sections
 *   (dynamic-empty by design in S-01): each renders an honest empty-state row
 *   describing what will populate it.
 *
 * i18n: agreed knowledge.* keys are used verbatim. Labels/copies absent from
 * the agreed key list (inbox/daily/tags/favorites/notebooksEmpty/sectionEmpty)
 * were added to all locales by W2-FLAG (2026-08-07) on this slice's request.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Book,
  CalendarDays,
  Clock,
  Database,
  FolderInput,
  LayoutGrid,
  Star,
  Tag as TagIcon,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface StaticSection {
  id: string
  icon: LucideIcon
  labelKey: string
}

/** Static nav sections per S-01 §Режим Знания (dynamic-empty by design). */
const STATIC_SECTIONS: StaticSection[] = [
  { id: 'inbox', icon: FolderInput, labelKey: 'knowledge.nav.inbox' },
  { id: 'daily', icon: CalendarDays, labelKey: 'knowledge.nav.daily' },
  { id: 'recent', icon: Clock, labelKey: 'knowledge.nav.recent' },
  { id: 'databases', icon: Database, labelKey: 'knowledge.nav.databases' },
  { id: 'tags', icon: TagIcon, labelKey: 'knowledge.nav.tags' },
  { id: 'favorites', icon: Star, labelKey: 'knowledge.nav.favorites' },
  { id: 'savedViews', icon: LayoutGrid, labelKey: 'knowledge.nav.savedViews' },
]

function SectionHeader({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground/80">
      <Icon className="size-3.5 shrink-0 text-foreground/50" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  )
}

function EmptyRow({ children }: { children: string }) {
  return (
    <div className={cn('mx-3 mb-2 rounded-md px-2.5 py-2', 'bg-muted/40 text-[12px] leading-snug text-muted-foreground')}>
      {children}
    </div>
  )
}

/** Body of the notebooks section — rendered wherever its data mode demands. */
function NotebooksBody({ t }: { t: TFunction }) {
  return <EmptyRow>{t('knowledge.nav.notebooksEmpty')}</EmptyRow>
}

export function KnowledgeNotebookTree() {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('knowledge.nav.title')} className="flex flex-col gap-0.5 py-1">
      <SectionHeader icon={Book} label={t('knowledge.nav.notebooks')} />
      <NotebooksBody t={t} />
      {STATIC_SECTIONS.map((section) => (
        <div key={section.id}>
          <SectionHeader icon={section.icon} label={t(section.labelKey)} />
          <EmptyRow>{t('knowledge.nav.sectionEmpty')}</EmptyRow>
        </div>
      ))}
    </nav>
  )
}
