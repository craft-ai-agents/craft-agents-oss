/**
 * HeaderMenu
 *
 * A "..." dropdown menu for panel headers with built-in Open in New Window action.
 * Pass page-specific menu items as children; they appear above the separator.
 * Optionally includes a "Learn More" link to documentation when helpFeature is provided.
 * For features with inline help (sources, skills), opens a dialog; others open external URL.
 */

import * as React from 'react'
import { MoreHorizontal, AppWindow, ExternalLink, BookOpen } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { HeaderIconButton } from './HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from './styled-dropdown'
import { type DocFeature, getDocUrl } from '@g4os/shared/docs/doc-links'
import { hasInlineHelp } from '@/help/types'
import { helpDialogAtom } from '@/atoms/help'

interface HeaderMenuProps {
  /** Route string for Open in New Window action */
  route: string
  /** Page-specific menu items (rendered before Open in New Window) */
  children?: React.ReactNode
  /** Documentation feature - when provided, adds a "Learn More" link to docs */
  helpFeature?: DocFeature
}

export function HeaderMenu({ route, children, helpFeature }: HeaderMenuProps) {
  const setHelp = useSetAtom(helpDialogAtom)

  const handleOpenInNewWindow = async () => {
    const separator = route.includes('?') ? '&' : '?'
    const url = `g4os://${route}${separator}window=focused`
    try {
      await window.electronAPI?.openUrl(url)
    } catch (error) {
      console.error('[HeaderMenu] openUrl failed:', error)
    }
  }

  const handleLearnMore = helpFeature ? () => {
    if (hasInlineHelp(helpFeature)) {
      setHelp({ open: true, feature: helpFeature })
    } else {
      window.electronAPI?.openUrl(getDocUrl(helpFeature))
    }
  } : undefined

  const learnMoreIcon = helpFeature && hasInlineHelp(helpFeature)
    ? <BookOpen className="h-3.5 w-3.5" />
    : <ExternalLink className="h-3.5 w-3.5" />

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {children}
        {children && <StyledDropdownMenuSeparator />}
        <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
          <AppWindow className="h-3.5 w-3.5" />
          <span className="flex-1">Open in New Window</span>
        </StyledDropdownMenuItem>
        {helpFeature && (
          <>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={handleLearnMore}>
              {learnMoreIcon}
              <span className="flex-1">Learn More</span>
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
