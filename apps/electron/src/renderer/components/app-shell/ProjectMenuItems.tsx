import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import type { MenuComponents } from "@/components/ui/menu-context"

export interface SessionMenuProjectOption {
  id: string
  slug: string
  name: string
}

/** Shared project choices for single-chat and multi-select menus. */
export function ProjectMenuItems({ projects, activeProjectId, onSelect, menu }: {
  projects: SessionMenuProjectOption[]
  /** `null` means all selected chats are unassigned; `undefined` means mixed. */
  activeProjectId: string | null | undefined
  onSelect: (id: string | null) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator'>
}) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = menu
  return (
    <>
      <MenuItem onClick={() => onSelect(null)}>
        {activeProjectId === null && <Check className="h-3.5 w-3.5" />}
        <span className={activeProjectId === null ? 'flex-1' : 'flex-1 ml-[18px]'}>
          {t('sessionMenu.noProject')}
        </span>
      </MenuItem>
      <Separator />
      {projects.map(project => (
        <MenuItem key={project.id} onClick={() => onSelect(project.id)}>
          {activeProjectId === project.id && <Check className="h-3.5 w-3.5" />}
          <span className={activeProjectId === project.id ? 'flex-1' : 'flex-1 ml-[18px]'}>{project.name}</span>
        </MenuItem>
      ))}
    </>
  )
}
