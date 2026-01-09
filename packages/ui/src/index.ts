/**
 * @craft-agent/ui - Shared React UI components for Craft Agent
 *
 * This package provides platform-agnostic UI components that work in both:
 * - Electron desktop app (full interactive mode)
 * - Web session viewer (read-only mode)
 *
 * Key components:
 * - ChatView: Main session viewer with readonly/interactive modes
 * - TurnCard: Email-like display for assistant turns
 * - Markdown: Customizable markdown renderer with syntax highlighting
 *
 * Platform abstraction:
 * - PlatformProvider/usePlatform: Inject platform-specific actions
 */

// Context
export {
  PlatformProvider,
  usePlatform,
  type PlatformActions,
  type PlatformProviderProps,
} from './context'

// Chat components
export {
  ChatView,
  TurnCard,
  TurnCardActionsMenu,
  ResponseCard,
  UserMessageBubble,
  FileTypeIcon,
  getFileTypeLabel,
  FullscreenOverlay,
  type ChatViewProps,
  type ChatViewMode,
  type TurnCardProps,
  type TurnCardActionsMenuProps,
  type ResponseCardProps,
  type UserMessageBubbleProps,
  type FileTypeIconProps,
  type FullscreenOverlayProps,
  type ActivityItem,
  type ResponseContent,
  type TodoItem,
} from './components/chat'

// Markdown
export {
  Markdown,
  MemoizedMarkdown,
  CodeBlock,
  InlineCode,
  CollapsibleMarkdownProvider,
  useCollapsibleMarkdown,
  type MarkdownProps,
  type RenderMode,
} from './components/markdown'

// UI primitives
export {
  Spinner,
  SimpleDropdown,
  SimpleDropdownItem,
  PreviewHeader,
  PreviewHeaderBadge,
  PREVIEW_BADGE_VARIANTS,
  type SpinnerProps,
  type SimpleDropdownProps,
  type SimpleDropdownItemProps,
  type PreviewHeaderProps,
  type PreviewHeaderBadgeProps,
  type PreviewBadgeVariant,
} from './components/ui'

// Code viewer components
export {
  ShikiCodeViewer,
  ShikiDiffViewer,
  LANGUAGE_MAP,
  getLanguageFromPath,
  formatFilePath,
  truncateFilePath,
  type ShikiCodeViewerProps,
  type ShikiDiffViewerProps,
} from './components/code-viewer'

// Terminal components
export {
  TerminalOutput,
  parseAnsi,
  stripAnsi,
  isGrepContentOutput,
  parseGrepOutput,
  ANSI_COLORS,
  type TerminalOutputProps,
  type ToolType,
  type AnsiSpan,
  type GrepLine,
} from './components/terminal'

// Overlay components
export {
  // Base overlay
  PreviewOverlay,
  CopyButton,
  type PreviewOverlayProps,
  type BadgeVariant,
  type CopyButtonProps,
  // Specialized overlays
  CodePreviewOverlay,
  DiffPreviewOverlay,
  TerminalPreviewOverlay,
  GenericOverlay,
  detectLanguageFromPath,
  type CodePreviewOverlayProps,
  type DiffPreviewOverlayProps,
  type TerminalPreviewOverlayProps,
  type GenericOverlayProps,
} from './components/overlay'

// Utilities
export { cn } from './lib/utils'

// Layout constants and hooks
export {
  CHAT_LAYOUT,
  CHAT_CLASSES,
  OVERLAY_LAYOUT,
  useOverlayMode,
  type OverlayMode,
} from './lib/layout'

// Tool result parsers
export {
  parseReadResult,
  parseBashResult,
  parseGrepResult,
  parseGlobResult,
  extractOverlayData,
  type ReadResult,
  type BashResult,
  type GrepResult,
  type GlobResult,
  type CodeOverlayData,
  type DiffOverlayData,
  type TerminalOverlayData,
  type GenericOverlayData,
  type OverlayData,
} from './lib/tool-parsers'

// Turn utilities (pure functions)
export * from './components/chat/turn-utils'
