import { useAtom } from 'jotai'

import { kanbanKeywordFilterAtom, kanbanRecencyDaysAtom } from '@/atoms/kanban'
import { CompactEntityFilter } from '../CompactEntityFilter'

export function KanbanTaskFilter() {
  const [keyword, setKeyword] = useAtom(kanbanKeywordFilterAtom)
  const [recencyDays, setRecencyDays] = useAtom(kanbanRecencyDaysAtom)

  return (
    <CompactEntityFilter
      keyword={keyword}
      onKeywordChange={setKeyword}
      recencyDays={recencyDays}
      onRecencyDaysChange={setRecencyDays}
    />
  )
}
