import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import type { MenuComponents } from "@/components/ui/menu-context"

// Kept apart from SessionMenuParts (whose label menus pull in the theme context) so the picker
// renders in a plain test.

export interface SessionMenuProjectOption {
  id: string
  slug: string
  name: string
}

export interface ProjectMenuItemsProps {
  projects: SessionMenuProjectOption[]
  /** The chats' project: an id, `null` = none of them has one, `undefined` = they differ (no check mark). */
  activeProjectId: string | null | undefined
  onSelect: (projectId: string | null) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator'>
}

/** Project choices ("No project", then each project), shared by the session menu and multi-select. */
export function ProjectMenuItems({ projects, activeProjectId, onSelect, menu }: ProjectMenuItemsProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = menu

  return (
    <>
      <MenuItem onClick={() => onSelect(null)}>
        {activeProjectId === null && <Check className="h-3.5 w-3.5" />}
        <span className={activeProjectId === null ? 'flex-1' : 'flex-1 ml-[18px]'}>
          {t("sessionMenu.noProject")}
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
