/**
 * ProviderCatalogPicker — searchable, keyboard-driven list of every API-key provider.
 *
 * OpenCode-style: one field, type a few letters, Enter. No forms, no wizard.
 * The catalog is the full `getPiApiKeyProviders()` list; the last row is always
 * "Other — OpenAI-compatible endpoint" so nothing is unreachable.
 *
 * Presentational only — the caller owns fetching the catalog and routing the
 * selection into the existing credential step.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Loader2, Plug, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  OTHER_PROVIDER_ENTRY,
  OTHER_PROVIDER_KEY,
  clampIndex,
  filterProviders,
  moveIndex,
  providerMonogram,
  resolveProviderIconSlug,
  type PiProviderEntry,
  type ProviderIconSlug,
} from "./provider-catalog"

import awsIcon from "@/assets/provider-icons/aws.svg"
import azureIcon from "@/assets/provider-icons/azure.svg"
import claudeIcon from "@/assets/provider-icons/claude.svg"
import googleIcon from "@/assets/provider-icons/google.svg"
import huggingfaceIcon from "@/assets/provider-icons/huggingface.svg"
import kimiIcon from "@/assets/provider-icons/kimi.svg"
import minimaxIcon from "@/assets/provider-icons/minimax.svg"
import mistralIcon from "@/assets/provider-icons/mistral.svg"
import ollamaIcon from "@/assets/provider-icons/ollama.svg"
import openaiIcon from "@/assets/provider-icons/openai.svg"
import openrouterIcon from "@/assets/provider-icons/openrouter.svg"
import piIcon from "@/assets/provider-icons/pi.svg"
import vercelIcon from "@/assets/provider-icons/vercel.svg"

const ICON_SOURCES: Record<ProviderIconSlug, string> = {
  aws: awsIcon,
  azure: azureIcon,
  claude: claudeIcon,
  google: googleIcon,
  huggingface: huggingfaceIcon,
  kimi: kimiIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  ollama: ollamaIcon,
  openai: openaiIcon,
  openrouter: openrouterIcon,
  pi: piIcon,
  vercel: vercelIcon,
}

interface ProviderCatalogPickerProps {
  /** Full API-key provider catalog (already sorted by the shared config). */
  providers: readonly PiProviderEntry[]
  /** Show a loading row while the catalog is still in flight. */
  isLoading?: boolean
  /** Called with the chosen entry — `key` is the `piAuthProvider` value. */
  onSelect: (entry: PiProviderEntry) => void
  className?: string
}

function ProviderAvatar({ entry }: { entry: PiProviderEntry }) {
  if (entry.key === OTHER_PROVIDER_KEY) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground">
        <Plug className="size-3" />
      </span>
    )
  }

  const slug = resolveProviderIconSlug(entry.key)
  if (slug) {
    return <img src={ICON_SOURCES[slug]} alt="" className="size-6 shrink-0 rounded-[5px]" />
  }

  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold text-foreground/60"
      style={{ background: 'color-mix(in oklch, var(--foreground) 7%, transparent)' }}
      aria-hidden="true"
    >
      {providerMonogram(entry.label)}
    </span>
  )
}

export function ProviderCatalogPicker({
  providers,
  isLoading = false,
  onSelect,
  className,
}: ProviderCatalogPickerProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  // Drop any catalog entry that collides with the reserved "Other" key so the
  // pinned row below can never produce a duplicate React key.
  const matches = useMemo(
    () => filterProviders(providers, query).filter((entry) => entry.key !== OTHER_PROVIDER_KEY),
    [providers, query],
  )

  // "Other" is pinned to the end so Enter always resolves to something,
  // even when the query matches no catalog provider.
  const rows = useMemo(() => [...matches, OTHER_PROVIDER_ENTRY], [matches])

  // Keep the cursor in range as the result set shrinks or the catalog arrives.
  const safeActiveIndex = clampIndex(activeIndex, rows.length)

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Keep the cursor visible by scrolling the list itself. `scrollIntoView` would
  // also scroll the surrounding onboarding scene, yanking the page on mount.
  useEffect(() => {
    const list = listRef.current
    const row = rowRefs.current[safeActiveIndex]
    if (!list || !row) return

    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop
    } else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight
    }
  }, [safeActiveIndex])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex(moveIndex(safeActiveIndex, 1, rows.length))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex(moveIndex(safeActiveIndex, -1, rows.length))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(rows.length - 1)
        break
      case 'Enter': {
        event.preventDefault()
        const entry = rows[safeActiveIndex]
        if (entry) onSelect(entry)
        break
      }
      case 'Escape':
        // Only swallow Escape when there is something to clear, so an empty
        // field still lets the surrounding surface handle the key.
        if (query) {
          event.preventDefault()
          event.stopPropagation()
          setQuery('')
        }
        break
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search API providers"
          aria-activedescendant={rows[safeActiveIndex] ? `${listId}-option-${safeActiveIndex}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search providers — Mistral, Groq, DeepSeek…"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "h-9 w-full rounded-lg bg-foreground-2 pl-9 pr-3 text-sm text-foreground shadow-minimal",
            "outline-none transition-colors placeholder:text-muted-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="API providers"
        ref={listRef}
        className="relative max-h-[13.5rem] overflow-y-auto rounded-lg border p-1"
        style={{ borderColor: 'color-mix(in oklch, var(--foreground) 7%, transparent)' }}
      >
        {isLoading && (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading providers…
          </div>
        )}

        {!isLoading && matches.length === 0 && query.trim().length > 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No provider matches “{query.trim()}”. Pick <span className="text-foreground/70">Other</span> below
            to connect any OpenAI-compatible endpoint.
          </p>
        )}

        {rows.map((entry, index) => {
          const isActive = index === safeActiveIndex
          return (
            <div
              key={entry.key}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={isActive}
              ref={(node) => { rowRefs.current[index] = node }}
              onMouseMove={() => { if (!isActive) setActiveIndex(index) }}
              onClick={() => onSelect(entry)}
              className={cn(
                "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5",
                "text-[13px] transition-colors",
                entry.key === OTHER_PROVIDER_KEY && matches.length > 0 && "mt-1",
                isActive ? "bg-foreground/5 text-foreground" : "text-foreground/70",
              )}
            >
              <ProviderAvatar entry={entry} />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {/* The provider id doubles as a search term, so surface it. */}
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {entry.key === OTHER_PROVIDER_KEY ? 'base URL + key' : entry.key}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
