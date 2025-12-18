/**
 * BrowserTabPanel
 *
 * Web content viewer.
 * Wraps the existing BrowserView component.
 */

import * as React from 'react'
import { BrowserView } from '@/components/browser/BrowserView'
import type { Tab, BrowserTab } from '../types'

interface BrowserTabPanelProps {
  tab: Tab
}

export default function BrowserTabPanel({ tab }: BrowserTabPanelProps) {
  const browserTab = tab as BrowserTab
  const { url } = browserTab

  return (
    <div className="h-full">
      <BrowserView url={url} />
    </div>
  )
}
