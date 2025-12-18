import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, User, Users, Globe } from "lucide-react"
import { Spinner } from "@/components/ui/loading-indicator"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

export interface CraftSpace {
  id: string
  name: string
  type: 'personal' | 'team' | 'shared'
  iconUrl?: string
}

export interface SpaceCategory {
  name: string
  spaces: CraftSpace[]
}

interface SpaceSelectionStepProps {
  categories: SpaceCategory[]
  selectedSpaceId: string | null
  isLoading?: boolean
  onSelect: (spaceId: string, spaceName: string) => void
  onContinue: () => void
  onBack: () => void
  /** Optional cancel callback (shows Cancel button when provided) */
  onCancel?: () => void
}

function SpaceIcon({ type, iconUrl }: { type: CraftSpace['type']; iconUrl?: string }) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="size-8 rounded-lg object-cover"
      />
    )
  }

  const iconClass = "size-4 text-muted-foreground"

  switch (type) {
    case 'personal':
      return (
        <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10">
          <User className={cn(iconClass, "text-blue-500")} />
        </div>
      )
    case 'team':
      return (
        <div className="flex size-8 items-center justify-center rounded-lg bg-purple-500/10">
          <Users className={cn(iconClass, "text-purple-500")} />
        </div>
      )
    case 'shared':
      return (
        <div className="flex size-8 items-center justify-center rounded-lg bg-green-500/10">
          <Globe className={cn(iconClass, "text-green-500")} />
        </div>
      )
  }
}

/**
 * SpaceSelectionStep - Select which Craft space to connect
 *
 * Displays spaces in categories:
 * - Recommended (personal space)
 * - Your Spaces (team spaces)
 * - Other Spaces (shared/public)
 */
export function SpaceSelectionStep({
  categories,
  selectedSpaceId,
  isLoading = false,
  onSelect,
  onContinue,
  onBack,
  onCancel
}: SpaceSelectionStepProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map(c => c.name))
  )

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const totalSpaces = categories.reduce((sum, cat) => sum + cat.spaces.length, 0)

  return (
    <StepFormLayout
      title="Select a Space"
      description="Choose which Craft space to connect to the agent."
      actions={
        <>
          {onCancel ? (
            <BackButton onClick={onCancel}>Cancel</BackButton>
          ) : (
            <BackButton onClick={onBack} />
          )}
          <ContinueButton onClick={onContinue} disabled={!selectedSpaceId} />
        </>
      }
    >
      {/* Space List */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      ) : totalSpaces === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <p className="text-muted-foreground">No spaces found.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a space in Craft first.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-80 rounded-lg border border-border">
          <div className="p-2">
            {categories.map((category) => (
              <div key={category.name} className="mb-2 last:mb-0">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-foreground/5"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      !expandedCategories.has(category.name) && "-rotate-90"
                    )}
                  />
                  {category.name}
                  <span className="ml-auto text-muted-foreground/60">
                    {category.spaces.length}
                  </span>
                </button>

                {/* Spaces */}
                {expandedCategories.has(category.name) && (
                  <div className="mt-1 space-y-1">
                    {category.spaces.map((space) => {
                      const isSelected = space.id === selectedSpaceId

                      return (
                        <button
                          key={space.id}
                          onClick={() => onSelect(space.id, space.name)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                            "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected && "bg-primary/10 hover:bg-primary/15"
                          )}
                        >
                          <SpaceIcon type={space.type} iconUrl={space.iconUrl} />
                          <span className="flex-1 truncate text-sm font-medium">
                            {space.name}
                          </span>
                          {isSelected && (
                            <Check className="size-4 text-primary" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </StepFormLayout>
  )
}
