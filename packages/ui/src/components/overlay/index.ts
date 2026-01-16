// Base overlay component
export { PreviewOverlay, type PreviewOverlayProps, type BadgeVariant } from './PreviewOverlay'

// Helper components
export { CopyButton, type CopyButtonProps } from './CopyButton'

// Specialized overlays
export { CodePreviewOverlay, type CodePreviewOverlayProps } from './CodePreviewOverlay'
export { DiffPreviewOverlay, type DiffPreviewOverlayProps } from './DiffPreviewOverlay'
export { MultiDiffPreviewOverlay, type MultiDiffPreviewOverlayProps, type FileChange } from './MultiDiffPreviewOverlay'
export { TerminalPreviewOverlay, type TerminalPreviewOverlayProps } from './TerminalPreviewOverlay'
export { GenericOverlay, detectLanguageFromPath, type GenericOverlayProps } from './GenericOverlay'
export { DataTableOverlay, type DataTableOverlayProps } from './DataTableOverlay'
