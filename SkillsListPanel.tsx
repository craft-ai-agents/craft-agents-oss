import * as React from "react"
import { Zap, Trash2, MoreHorizontal } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    StyledDropdownMenuContent,
    StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { DropdownMenuProvider } from "@/components/ui/menu-context"
import type { LoadedSkill } from "../../../shared/types"

interface SkillsListPanelProps {
    skills: LoadedSkill[]
    workspaceId: string
    workspaceRootPath?: string
    onSkillClick: (skill: LoadedSkill) => void
    onDeleteSkill: (slug: string) => void
    selectedSkillSlug: string | null
}

export function SkillsListPanel({
    skills,
    onSkillClick,
    onDeleteSkill,
    selectedSkillSlug,
}: SkillsListPanelProps) {
    if (skills.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 text-muted-foreground select-none">
                <div className="bg-muted/50 p-4 rounded-full mb-4">
                    <Zap className="h-8 w-8 opacity-50" />
                </div>
                <h3 className="font-medium text-foreground mb-1">No skills yet</h3>
                <p className="text-sm max-w-[200px]">
                    Add skills to teach your agent new capabilities.
                </p>
            </div>
        )
    }

    return (
        <ScrollArea className="h-full">
            <div className="p-2 space-y-0.5">
                {skills.map((skill) => (
                    <SkillItem
                        key={skill.slug}
                        skill={skill}
                        isSelected={selectedSkillSlug === skill.slug}
                        onClick={() => onSkillClick(skill)}
                        onDelete={() => onDeleteSkill(skill.slug)}
                    />
                ))}
            </div>
        </ScrollArea>
    )
}

function SkillItem({
    skill,
    isSelected,
    onClick,
    onDelete,
}: {
    skill: LoadedSkill
    isSelected: boolean
    onClick: () => void
    onDelete: () => void
}) {
    const [menuOpen, setMenuOpen] = React.useState(false)

    // Safe access to description if it exists in config
    // @ts-ignore - Config property might be dynamic based on loaded skill type
    const description = skill.config?.description || "No description provided"

    return (
        <div className="group relative">
            <button
                onClick={onClick}
                className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none",
                    isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
            >
                <Zap className={cn("mt-0.5 h-4 w-4 shrink-0", isSelected ? "text-accent-foreground" : "text-foreground/60")} />
                <div className="flex-1 min-w-0">
                    <div className={cn("font-medium", isSelected ? "text-accent-foreground" : "text-foreground")}>
                        {skill.slug}
                    </div>
                    <div className={cn("text-xs line-clamp-2 mt-0.5", isSelected ? "text-accent-foreground/80" : "text-muted-foreground")}>
                        {description}
                    </div>
                </div>
            </button>

            {/* Context Menu Trigger */}
            <div
                className={cn(
                    "absolute right-2 top-2 z-10",
                    menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    "transition-opacity"
                )}
            >
                <div className="flex items-center rounded-md overflow-hidden shadow-sm">
                    <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger asChild>
                            <button
                                className={cn(
                                    "flex h-6 w-6 items-center justify-center transition-colors outline-none",
                                    isSelected
                                        ? "bg-accent border border-accent-foreground/20 text-accent-foreground hover:bg-accent-foreground/10"
                                        : "bg-background border border-border hover:bg-muted text-muted-foreground"
                                )}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <StyledDropdownMenuContent align="end">
                            <DropdownMenuProvider>
                                <StyledDropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDelete()
                                    }}
                                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                                    <span className="flex-1">Delete Skill</span>
                                </StyledDropdownMenuItem>
                            </DropdownMenuProvider>
                        </StyledDropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    )
}
