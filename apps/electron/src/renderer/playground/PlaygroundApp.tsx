import * as React from 'react'
import { PanelRight } from 'lucide-react'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'
import { Sidebar } from './Sidebar'
import { ComponentPreview } from './ComponentPreview'
import { VariantsSidebar } from './VariantsSidebar'
import { getCategories, getComponentById, type ComponentVariant } from './registry'

const SELECTED_STORAGE_KEY = 'playground-selected-component'
const VARIANTS_SIDEBAR_KEY = 'playground-variants-sidebar-open'

export function PlaygroundApp() {
  const categories = React.useMemo(() => getCategories(), [])
  const [selectedId, setSelectedId] = React.useState<string | null>(() => {
    // Try to restore from localStorage
    try {
      const stored = localStorage.getItem(SELECTED_STORAGE_KEY)
      if (stored) {
        // Verify the component still exists
        const component = getComponentById(stored)
        if (component) {
          return stored
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null
  })
  const [props, setProps] = React.useState<Record<string, unknown>>({})
  const [selectedVariant, setSelectedVariant] = React.useState<string | null>(null)
  const [variantsSidebarOpen, setVariantsSidebarOpen] = React.useState(() => {
    try {
      const stored = localStorage.getItem(VARIANTS_SIDEBAR_KEY)
      return stored !== 'false' // Default to open
    } catch {
      return true
    }
  })

  // Persist selected component to localStorage
  React.useEffect(() => {
    try {
      if (selectedId) {
        localStorage.setItem(SELECTED_STORAGE_KEY, selectedId)
      } else {
        localStorage.removeItem(SELECTED_STORAGE_KEY)
      }
    } catch {
      // Ignore storage errors
    }
  }, [selectedId])

  // Persist variants sidebar state
  React.useEffect(() => {
    try {
      localStorage.setItem(VARIANTS_SIDEBAR_KEY, String(variantsSidebarOpen))
    } catch {
      // Ignore storage errors
    }
  }, [variantsSidebarOpen])

  const selectedComponent = selectedId ? (getComponentById(selectedId) ?? null) : null

  // Reset props when component changes
  React.useEffect(() => {
    if (selectedComponent) {
      const defaults: Record<string, unknown> = {}
      for (const prop of selectedComponent.props) {
        defaults[prop.name] = prop.defaultValue
      }
      setProps(defaults)
      setSelectedVariant(null)
    }
  }, [selectedComponent])

  const handleVariantSelect = (variant: ComponentVariant) => {
    if (selectedComponent) {
      // Start with defaults, then apply variant props
      const defaults: Record<string, unknown> = {}
      for (const prop of selectedComponent.props) {
        defaults[prop.name] = prop.defaultValue
      }
      setProps({ ...defaults, ...variant.props })
      setSelectedVariant(variant.name)
    }
  }

  const handlePropsChange = (newProps: Record<string, unknown>) => {
    setProps(newProps)
    // Clear variant selection when props are manually changed
    setSelectedVariant(null)
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <CraftAgentsSymbol className="h-5 w-5" />
          <h1 className="font-semibold text-foreground font-sans">
            Design System Playground
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setVariantsSidebarOpen(!variantsSidebarOpen)}
            className={cn(
              'p-2 rounded-md transition-colors',
              variantsSidebarOpen
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
            )}
            title={variantsSidebarOpen ? 'Hide variants' : 'Show variants'}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Component list */}
        <Sidebar
          categories={categories}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Content area - full height preview */}
        {selectedComponent ? (
          <ComponentPreview
            component={selectedComponent}
            props={props}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a component from the sidebar
          </div>
        )}

        {/* Right Sidebar - Variants & Props */}
        <VariantsSidebar
          component={selectedComponent}
          selectedVariant={selectedVariant}
          onVariantSelect={handleVariantSelect}
          props={props}
          onPropsChange={handlePropsChange}
          isOpen={variantsSidebarOpen}
        />
      </div>
    </div>
  )
}
