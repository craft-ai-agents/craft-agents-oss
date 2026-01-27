/**
 * SkillGallery_Page
 *
 * Compound page layout component for the Skills Gallery.
 * Handles loading, error, and empty states with consistent styling.
 * Duplicated from Info_Page to allow the gallery to evolve independently.
 */

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { PanelHeader, type PanelHeaderProps } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { CHAT_LAYOUT } from '@/config/layout'

export interface SkillGallery_PageProps {
  children: React.ReactNode
  /** Show loading spinner */
  loading?: boolean
  /** Show error state with message */
  error?: string
  /** Show empty state with message */
  empty?: string
  className?: string
}

export interface SkillGallery_PageHeaderProps extends Omit<PanelHeaderProps, 'className'> {
  className?: string
}

export interface SkillGallery_PageHeroProps {
  /** Title displayed prominently */
  title?: string
  /** Tagline/description text below title */
  tagline?: string | null
  className?: string
}

export interface SkillGallery_PageContentProps {
  children: React.ReactNode
  className?: string
}

function SkillGallery_PageRoot({
  children,
  loading,
  error,
  empty,
  className,
}: SkillGallery_PageProps) {
  // Extract header from children for consistent structure
  let header: React.ReactNode = null
  const otherChildren: React.ReactNode[] = []

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === SkillGallery_PageHeader) {
      header = child
    } else {
      otherChildren.push(child)
    }
  })

  // Loading state
  if (loading) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">Error loading content</p>
          <p className="text-xs text-center max-w-md">{error}</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (empty) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">{empty}</p>
        </div>
      </div>
    )
  }

  // Normal content
  return (
    <div className={cn('h-full flex flex-col', className)}>
      {header}
      {otherChildren}
    </div>
  )
}

function SkillGallery_PageHeader({ className, ...props }: SkillGallery_PageHeaderProps) {
  return <PanelHeader className={className} {...props} />
}

function SkillGallery_PageHero({ title, tagline, className }: SkillGallery_PageHeroProps) {
  return (
    <div className={cn('', className)}>
      {title && (
        <h2 className="text-base font-semibold text-foreground leading-tight">
          {title}
        </h2>
      )}
      {tagline && (
        <p className={cn('text-sm text-foreground/60 leading-snug', title ? 'mt-1' : 'mt-0')}>
          {tagline}
        </p>
      )}
    </div>
  )
}

function SkillGallery_PageContent({ children, className }: SkillGallery_PageContentProps) {
  return (
    <div className="relative flex-1 min-h-0">
      {/* Mask wrapper - fades content at top and bottom */}
      <div
        className="h-full"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
        }}
      >
        <ScrollArea className="h-full">
          <div className={cn(CHAT_LAYOUT.maxWidth, 'mx-auto px-5 pt-6 pb-10')}>
            <div className={cn('space-y-6', className)}>{children}</div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export const SkillGallery_Page = Object.assign(SkillGallery_PageRoot, {
  Header: SkillGallery_PageHeader,
  Hero: SkillGallery_PageHero,
  Content: SkillGallery_PageContent,
})
