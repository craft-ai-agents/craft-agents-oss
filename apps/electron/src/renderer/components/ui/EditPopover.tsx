/**
 * EditPopover
 *
 * A popover with title, subtitle, and multiline textarea for editing settings.
 * On submit, opens a new focused window with a chat session containing explicit
 * context for fast execution.
 */

import * as React from 'react'
import { useState, useRef, useEffect } from 'react'
import { ArrowUp } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './popover'
import { Button } from './button'
import { cn } from '@/lib/utils'
import type { ContentBadge } from '../../../shared/types'

/**
 * Context passed to the new chat session so the agent knows exactly
 * what is being edited and can execute quickly.
 *
 * Simplified structure: label for display, filePath for the agent to know
 * where to edit, and optional context for additional instructions.
 */
export interface EditContext {
  /** Human-readable label for badge display and agent context (e.g., "Permissions") */
  label: string
  /** Absolute path to the file being edited */
  filePath: string
  /** Optional additional context/instructions for the agent */
  context?: string
}

/* ============================================================================
 * EDIT CONTEXT REGISTRY - SINGLE SOURCE OF TRUTH
 * ============================================================================
 * ALL edit contexts MUST be defined here. This is the canonical location.
 *
 * DO NOT create EditContext objects inline elsewhere in the codebase.
 * Instead, use getEditConfig() exported from this file.
 *
 * To add a new edit context:
 * 1. Add a new key to EditContextKey type
 * 2. Add the config to EDIT_CONFIGS
 * 3. Use via getEditConfig(key, location)
 *
 * This pattern ensures:
 * - All edit prompts and examples are reviewed in one place
 * - Consistent messaging to the agent
 * - Easy updates when context format changes
 * ============================================================================ */

/** Available edit context keys - add new ones here */
export type EditContextKey =
  | 'workspace-permissions'
  | 'default-permissions'
  | 'skill-instructions'
  | 'skill-metadata'
  | 'source-guide'
  | 'source-config'
  | 'source-permissions'
  | 'source-tool-permissions'
  | 'preferences-notes'
  | 'add-source'
  | 'add-source-api'   // Filter-specific: user is viewing APIs
  | 'add-source-mcp'   // Filter-specific: user is viewing MCPs
  | 'add-source-local' // Filter-specific: user is viewing Local Folders
  | 'add-skill'
  | 'edit-statuses'

/**
 * Full edit configuration including context for agent and example for UI.
 * Returned by getEditConfig() for use in EditPopover.
 */
export interface EditConfig {
  /** Context passed to the agent */
  context: EditContext
  /** Example text shown in the popover placeholder */
  example: string
  /** Optional custom placeholder text - overrides the default "Describe what you'd like to change" */
  overridePlaceholder?: string
}

/**
 * Registry of all edit configurations.
 * Each entry contains all strings needed for the edit popover and agent context.
 */
const EDIT_CONFIGS: Record<EditContextKey, (location: string) => EditConfig> = {
  'workspace-permissions': (location) => ({
    context: {
      label: 'Permission Settings',
      filePath: `${location}/permissions.json`,
      context:
        'The user is on the Settings Screen and pressed the edit button on Workspace Permission settings. ' +
        'Their intent is likely to update the setting immediately unless otherwise specified. ' +
        'The permissions.json file configures Explore mode rules. It can contain: allowedBashPatterns, ' +
        'allowedMcpPatterns, allowedApiEndpoints, blockedTools, and allowedWritePaths. ' +
        'After editing, call config_validate with target "permissions" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: "Allow running 'make build' in Explore mode",
  }),

  'default-permissions': (location) => ({
    context: {
      label: 'Default Permissions',
      filePath: location, // location is the full path for default permissions
      context:
        'The user is editing app-level default permissions (~/.craft-agent/permissions/default.json). ' +
        'This file configures Explore mode rules that apply to ALL workspaces. ' +
        'It can contain: allowedBashPatterns, allowedMcpPatterns, allowedApiEndpoints, blockedTools, and allowedWritePaths. ' +
        'Each pattern can be a string or an object with pattern and comment fields. ' +
        'Be careful - these are app-wide defaults. ' +
        'After editing, call config_validate with target "permissions" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Allow git fetch command',
  }),

  // Skill editing contexts
  'skill-instructions': (location) => ({
    context: {
      label: 'Skill Instructions',
      filePath: `${location}/SKILL.md`,
      context:
        'The user is editing skill instructions in SKILL.md. ' +
        'IMPORTANT: Preserve the YAML frontmatter (between --- markers) at the top of the file. ' +
        'Focus on editing the markdown content after the frontmatter. ' +
        'The skill instructions guide the AI on how to use this skill. ' +
        'After editing, call skill_validate with the skill slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add error handling guidelines',
  }),

  'skill-metadata': (location) => ({
    context: {
      label: 'Skill Metadata',
      filePath: `${location}/SKILL.md`,
      context:
        'The user is editing skill metadata in the YAML frontmatter of SKILL.md. ' +
        'Frontmatter fields: name (required), description (required), globs (optional array), alwaysAllow (optional array). ' +
        'Keep the content after the frontmatter unchanged unless specifically requested. ' +
        'After editing, call skill_validate with the skill slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Update the skill description',
  }),

  // Source editing contexts
  'source-guide': (location) => ({
    context: {
      label: 'Source Documentation',
      filePath: `${location}/guide.md`,
      context:
        'The user is editing source documentation (guide.md). ' +
        'This file provides context to the AI about how to use this source - rate limits, API patterns, best practices. ' +
        'Keep content clear and actionable. ' +
        'Confirm clearly when done.',
    },
    example: 'Add rate limit documentation',
  }),

  'source-config': (location) => ({
    context: {
      label: 'Source Configuration',
      filePath: `${location}/config.json`,
      context:
        'The user is editing source configuration (config.json). ' +
        'Be careful with JSON syntax. Fields include: type, slug, name, tagline, iconUrl, and transport-specific settings (mcp, api, local). ' +
        'Do NOT modify the slug unless explicitly requested. ' +
        'After editing, call source_test with the source slug to verify the configuration. ' +
        'Confirm clearly when done.',
    },
    example: 'Update the display name',
  }),

  'source-permissions': (location) => ({
    context: {
      label: 'Source Permissions',
      filePath: `${location}/permissions.json`,
      context:
        'The user is editing source-level permissions (permissions.json). ' +
        'These rules are auto-scoped to this source - write simple patterns without prefixes. ' +
        'For MCP: use allowedMcpPatterns (e.g., "list", "get"). For API: use allowedApiEndpoints. ' +
        'After editing, call config_validate with target "permissions" and the source slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Allow list operations in Explore mode',
  }),

  'source-tool-permissions': (location) => ({
    context: {
      label: 'Tool Permissions',
      filePath: `${location}/permissions.json`,
      context:
        'The user is viewing the Tools list for an MCP source and wants to modify tool permissions. ' +
        'Edit the permissions.json file to control which tools are allowed in Explore mode. ' +
        'Use allowedMcpPatterns to allow specific tools (e.g., ["list_*", "get_*"] for read-only). ' +
        'Use blockedTools to explicitly block specific tools. ' +
        'Patterns are auto-scoped to this source. ' +
        'After editing, call config_validate with target "permissions" and the source slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Only allow read operations (list, get, search)',
  }),

  // Preferences editing context
  'preferences-notes': (location) => ({
    context: {
      label: 'Preferences Notes',
      filePath: location, // location is the full path for preferences
      context:
        'The user is editing the notes field in their preferences (~/.craft-agent/preferences.json). ' +
        'This is a JSON file. Only modify the "notes" field unless explicitly asked otherwise. ' +
        'The notes field is free-form text that provides context about the user to the AI. ' +
        'After editing, call config_validate with target "preferences" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add coding style preferences',
  }),

  // Add new source/skill contexts - use overridePlaceholder for inspiring, contextual prompts
  'add-source': (location) => ({
    context: {
      label: 'Add Source',
      filePath: `${location}/sources/`, // location is the workspace root path
      context:
        'The user wants to add a new source to their workspace. ' +
        'Sources can be MCP servers (HTTP/SSE or stdio), REST APIs, or local filesystems. ' +
        'Ask clarifying questions if needed: What service? MCP or API? Auth type? ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to my Craft space',
    overridePlaceholder: 'What would you like to connect?',
  }),

  // Filter-specific add-source contexts: user is viewing a filtered list and wants to add that type
  'add-source-api': (location) => ({
    context: {
      label: 'Add API',
      filePath: `${location}/sources/`,
      context:
        'The user is viewing API sources and wants to add a new REST API. ' +
        'Default to creating an API source (type: "api") unless they specify otherwise. ' +
        'APIs connect to REST endpoints with authentication (bearer, header, basic, or query). ' +
        'Ask about the API endpoint URL and auth type. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to the OpenAI API',
    overridePlaceholder: 'What API would you like to connect?',
  }),

  'add-source-mcp': (location) => ({
    context: {
      label: 'Add MCP Server',
      filePath: `${location}/sources/`,
      context:
        'The user is viewing MCP sources and wants to add a new MCP server. ' +
        'Default to creating an MCP source (type: "mcp") unless they specify otherwise. ' +
        'MCP servers can use HTTP/SSE transport (remote) or stdio transport (local subprocess). ' +
        'Ask about the service they want to connect to and whether it\'s a remote URL or local command. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to Linear',
    overridePlaceholder: 'What MCP server would you like to connect?',
  }),

  'add-source-local': (location) => ({
    context: {
      label: 'Add Local Folder',
      filePath: `${location}/sources/`,
      context:
        'The user wants to add a local folder source. ' +
        'First, look up the guide: mcp__craft-agents-docs__SearchCraftAgents({ query: "filesystem" }). ' +
        'Local folders are bookmarks - use type: "local" with a local.path field. ' +
        'They use existing Read, Write, Glob, Grep tools - no MCP server needed. ' +
        'If unclear, ask about the folder path they want to connect. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to my Obsidian vault',
    overridePlaceholder: 'What folder would you like to connect?',
  }),

  'add-skill': (location) => ({
    context: {
      label: 'Add Skill',
      filePath: `${location}/skills/`, // location is the workspace root path
      context:
        'The user wants to add a new skill to their workspace. ' +
        'Skills are specialized instructions with a SKILL.md file containing YAML frontmatter (name, description) and markdown instructions. ' +
        'Ask clarifying questions if needed: What should the skill do? When should it trigger? ' +
        'Create the skill folder and SKILL.md in the workspace skills directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/skills.md. ' +
        'After creating the skill, call skill_validate with the skill slug to verify the SKILL.md file.',
    },
    example: 'Review PRs following our code standards',
    overridePlaceholder: 'What should I learn to do?',
  }),

  // Status configuration context
  'edit-statuses': (location) => ({
    context: {
      label: 'Status Configuration',
      filePath: `${location}/statuses/config.json`,
      context:
        'The user wants to customize session statuses (workflow states). ' +
        'Statuses are stored in statuses/config.json with fields: id, label, icon, category (open/closed), order, isFixed, isDefault. ' +
        'Fixed statuses (todo, done, cancelled) cannot be deleted but can be reordered or have their label changed. ' +
        'Icon can be { type: "file", value: "name.svg" } for custom icons in statuses/icons/ or { type: "lucide", value: "icon-name" } for Lucide icons. ' +
        'Category "open" shows in inbox, "closed" shows in archive. ' +
        'After editing, call config_validate with target "statuses" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add a "Blocked" status',
  }),
}

/**
 * Get full edit config by key. Returns both context (for agent) and example (for UI).
 *
 * @param key - The edit context key
 * @param location - Base path (e.g., workspace root path)
 *
 * @example
 * const { context, example } = getEditConfig('workspace-permissions', workspace.rootPath)
 */
export function getEditConfig(key: EditContextKey, location: string): EditConfig {
  const factory = EDIT_CONFIGS[key]
  if (!factory) {
    throw new Error(`Unknown edit context key: ${key}. Add it to EDIT_CONFIGS in EditPopover.tsx`)
  }
  return factory(location)
}

/**
 * Optional secondary action button displayed on the left side of the popover footer.
 * Styled as plain text with underline on hover - typically used for "Edit File" actions.
 */
export interface SecondaryAction {
  /** Button label (e.g., "Edit File") */
  label: string
  /** Click handler - typically opens a file for manual editing */
  onClick: () => void
}

export interface EditPopoverProps {
  /** Trigger element that opens the popover */
  trigger: React.ReactNode
  /** Example text shown in placeholder (e.g., "Allow 'make build' command") */
  example?: string
  /** Context passed to the new chat session */
  context: EditContext
  /** Permission mode for the new session (default: 'allow-all' for fast execution) */
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  /**
   * Working directory for the new session:
   * - 'none' (default): No working directory (session folder only) - best for config edits
   * - 'user_default': Use workspace's configured default
   * - Absolute path string: Use this specific path
   */
  workingDirectory?: string | 'user_default' | 'none'
  /** Width of the popover (default: 320) */
  width?: number
  /** Additional className for the trigger */
  triggerClassName?: string
  /** Side of the popover relative to trigger */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of the popover */
  align?: 'start' | 'center' | 'end'
  /** Optional secondary action button on the left (e.g., "Edit File") */
  secondaryAction?: SecondaryAction
  /** Optional custom placeholder - overrides the default "Describe what you'd like to change" */
  overridePlaceholder?: string
  /**
   * Controlled open state - when provided, the popover becomes controlled.
   * Use this when opening the popover programmatically (e.g., from context menus).
   */
  open?: boolean
  /** Callback when open state changes (for controlled mode) */
  onOpenChange?: (open: boolean) => void
  /**
   * When true, prevents the popover from closing when clicking outside.
   * Useful for context menu triggered popovers where focus management is tricky.
   */
  modal?: boolean
}

/**
 * Result from buildEditPrompt containing both the full prompt and badge metadata
 * for hiding the XML context in the UI while keeping it in the actual message.
 */
interface EditPromptResult {
  /** Full prompt including XML metadata and user instructions */
  prompt: string
  /** Badge marking the hidden metadata section */
  badges: ContentBadge[]
}

/**
 * Build the prompt that will be sent to the agent.
 * Uses XML-like tags for clear structure.
 *
 * Returns both the prompt and a context badge that marks the metadata section
 * so it can be hidden in the UI while still being sent to the agent.
 *
 * @param context - The edit context with label, filePath, and optional context
 * @param userInstructions - User's instructions (can be empty string for pre-filled context only)
 *
 * @example
 * // With user instructions (for EditPopover submit)
 * const { prompt, badges } = buildEditPrompt(context, "Add a Blocked status")
 *
 * // Without user instructions (for context menu - opens window with context pre-filled)
 * const { prompt, badges } = buildEditPrompt(context, "")
 */
export function buildEditPrompt(context: EditContext, userInstructions: string): EditPromptResult {
  // Build the metadata section (will be hidden by badge)
  // Simple structure: label (for display/context), file (where to edit), optional context
  const metadataSection = `<edit_request>
<label>${context.label}</label>
<file>${context.filePath}</file>
${context.context ? `<context>${context.context}</context>\n` : ''}</edit_request>

`

  // Badge display: just the label (no "Edit:" prefix for cleaner appearance)
  const collapsedLabel = context.label

  // Full prompt = metadata + user instructions
  const prompt = metadataSection + userInstructions

  // Create badge marking the metadata section (start=0, end=metadata length)
  const badge: ContentBadge = {
    type: 'context',
    label: collapsedLabel,
    rawText: metadataSection,
    start: 0,
    end: metadataSection.length,
    collapsedLabel,
  }

  return { prompt, badges: [badge] }
}

export function EditPopover({
  trigger,
  example,
  context,
  permissionMode = 'allow-all',
  workingDirectory = 'none', // Default to session folder for config edits
  width = 320,
  triggerClassName,
  side = 'bottom',
  align = 'end',
  secondaryAction,
  overridePlaceholder,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  modal = false,
}: EditPopoverProps) {
  // Build placeholder: use override if provided, otherwise default to "change" wording
  // overridePlaceholder allows contexts like add-source/add-skill to say "add" instead of "change"
  const basePlaceholder = overridePlaceholder ?? "Describe what you'd like to change..."
  const placeholder = example
    ? `${basePlaceholder.replace(/\.{3}$/, '')}, e.g., "${example}"`
    : basePlaceholder
  // Support both controlled and uncontrolled modes:
  // - Uncontrolled (default): internal state manages open/close
  // - Controlled: parent manages state via open/onOpenChange props
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (value: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(value)
    } else {
      setInternalOpen(value)
    }
  }
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus textarea when popover opens
  useEffect(() => {
    if (open) {
      // Small delay to let the popover render and avoid focus race conditions
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Reset input when popover closes
  useEffect(() => {
    if (!open) {
      setInput('')
    }
  }, [open])

  const handleSubmit = async () => {
    if (!input.trim()) return

    const { prompt, badges } = buildEditPrompt(context, input.trim())
    const encodedInput = encodeURIComponent(prompt)
    // Encode badges as JSON for passing through deep link
    const encodedBadges = encodeURIComponent(JSON.stringify(badges))

    // Open new focused window with auto-send
    // The ?window=focused creates a smaller window (900x700) focused on single session
    // The &send=true auto-sends the message immediately
    // The &mode= sets the permission mode for the new session
    // The &badges= passes badge metadata for hiding the XML context in UI
    // The &workdir= sets the working directory (user_default, none, or absolute path)
    const workdirParam = workingDirectory ? `&workdir=${encodeURIComponent(workingDirectory)}` : ''
    const url = `craftagents://action/new-chat?window=focused&input=${encodedInput}&send=true&mode=${permissionMode}&badges=${encodedBadges}${workdirParam}`

    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('[EditPopover] Failed to open new chat window:', error)
    }

    // Close the popover
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    // Escape closes the popover
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild className={triggerClassName}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="p-4"
        style={{ width, borderRadius: 16 }}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
          className={cn(
            'w-full min-h-[100px] resize-none px-0 py-0 text-sm leading-relaxed',
            'bg-transparent border-none',
            'placeholder:text-muted-foreground placeholder:leading-relaxed',
            'focus:outline-none focus-visible:outline-none focus-visible:ring-0',
            'field-sizing-content'
          )}
        />

        {/* Footer row: secondary action on left, send button on right */}
        <div className="flex items-center justify-between mt-2">
          {/* Secondary action - plain text link */}
          {secondaryAction ? (
            <button
              type="button"
              onClick={() => {
                secondaryAction.onClick()
                setOpen(false)
              }}
              className="text-sm text-muted-foreground hover:underline"
            >
              {secondaryAction.label}
            </button>
          ) : (
            <div />
          )}

          {/* Send button */}
          <Button
            type="button"
            size="icon"
            className="h-7 w-7 rounded-full shrink-0"
            onClick={handleSubmit}
            disabled={!input.trim()}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Standard Edit button styled for use with EditPopover.
 * Use this as the trigger prop for consistent styling across the app.
 *
 * Uses forwardRef to properly work with Radix's asChild pattern,
 * which requires the child to accept ref and spread props.
 *
 * @example
 * <EditPopover
 *   trigger={<EditButton />}
 *   context={getEditContext('workspace-permissions', { workspacePath })}
 * />
 */
export const EditButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(function EditButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      // Merge our base styles with any className from asChild props
      className={cn("h-8 px-3 rounded-[6px] bg-background shadow-minimal text-foreground/70 hover:text-foreground", className)}
      {...props}
    >
      Edit
    </Button>
  )
})
