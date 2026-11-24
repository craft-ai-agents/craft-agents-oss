/**
 * FileLinkActionMenu — the choices offered when a local file link is clicked: open the file outside
 * the app (the browser for .html/.htm, its default app otherwise), preview it here (types with an
 * in-app preview), show it in the file manager, or copy its path. It opens next to the link;
 * ⌥-click skips it and opens the file directly (`useLinkInterceptor`, which holds the state).
 * Playground: Markdown › File link · Open menu.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppWindow, ArrowUpRight, Copy, Eye, FolderOpen, Globe } from 'lucide-react'
import { classifyFile } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { Kbd } from '@/components/ui/kbd'
import { getFileManagerName, isMac } from '@/lib/platform'
import { fileLinkMenuHeader, opensInBrowser, type FileLinkMenuState } from './file-link-menu'

export interface FileLinkActionMenuProps {
  /** The open menu, or null when closed */
  menu: FileLinkMenuState | null
  onClose: () => void
  /** Open the file with its default handler (the browser for .html/.htm) */
  onOpenExternal: (path: string) => void
  /** Open the in-app preview */
  onPreview: (path: string) => void
  /** Show the file in the system file manager */
  onReveal: (path: string) => void
}

export function FileLinkActionMenu({ menu, onClose, onOpenExternal, onPreview, onReveal }: FileLinkActionMenuProps) {
  const { t } = useTranslation()

  // Keep rendering the last menu while it animates out.
  const [lastMenu, setLastMenu] = React.useState(menu)
  if (menu && menu !== lastMenu) setLastMenu(menu)
  const shown = menu ?? lastMenu

  // Return focus where it was (the link, or the composer) on close, unless the preview took it.
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const previewOpenedRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!menu) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previewOpenedRef.current = false
  }, [menu])

  if (!shown) return null

  const { path, anchor } = shown
  const header = fileLinkMenuHeader(path)
  const browser = opensInBrowser(path)
  const canPreview = classifyFile(path).canPreview

  const copyPath = () => {
    navigator.clipboard.writeText(path).then(
      () => toast.success(t('toast.pathCopied')),
      () => toast.error(t('toast.copyFailed')),
    )
  }

  return (
    <DropdownMenu open={!!menu} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild autoMirrorHoverToOpen={false}>
        {/* The anchor: an invisible box over the clicked link */}
        <span
          aria-hidden
          className="pointer-events-none fixed"
          style={{ left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }}
        />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        minWidth="min-w-0"
        className="w-64"
        // Above fullscreen overlays: file links inside a document or activity overlay open it too.
        style={{ zIndex: 'var(--z-floating-menu, 400)' }}
        aria-label={header.name}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!previewOpenedRef.current) returnFocusRef.current?.focus({ preventScroll: true })
        }}
      >
        <div className="px-2 pt-1 pb-1.5" title={path}>
          <div className="truncate text-label-sm text-secondary">{header.name}</div>
          {header.folder && <div className="truncate text-caption text-tertiary">{header.folder}</div>}
        </div>
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem onSelect={() => onOpenExternal(path)}>
          {browser ? <Globe /> : <AppWindow />}
          {browser ? t('fileLinkMenu.openInBrowser') : t('fileLinkMenu.openInDefaultApp')}
          <ArrowUpRight className="ml-auto size-3.5 text-tertiary" />
        </StyledDropdownMenuItem>
        {canPreview && (
          <StyledDropdownMenuItem
            className="text-accent"
            onSelect={() => {
              previewOpenedRef.current = true
              onPreview(path)
            }}
          >
            <Eye className="text-accent" />
            {t('fileLinkMenu.previewHere')}
          </StyledDropdownMenuItem>
        )}
        <StyledDropdownMenuItem onSelect={() => onReveal(path)}>
          <FolderOpen />
          {t('chat.showInFileManager', { fileManager: getFileManagerName() })}
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onSelect={copyPath}>
          <Copy />
          {t('common.copyPath')}
        </StyledDropdownMenuItem>
        <StyledDropdownMenuSeparator />
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-caption text-tertiary">
          <Kbd>{isMac ? '⌥' : 'Alt'}</Kbd>
          <span>{t('fileLinkMenu.clickToSkip')}</span>
        </div>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
