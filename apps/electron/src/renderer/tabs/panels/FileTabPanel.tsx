/**
 * FileTabPanel
 *
 * File viewer with syntax highlighting.
 * Wraps the existing FileViewer component.
 */

import * as React from 'react'
import { FileViewer } from '@/components/files/FileViewer'
import type { Tab, FileTab } from '../types'

interface FileTabPanelProps {
  tab: Tab
}

export default function FileTabPanel({ tab }: FileTabPanelProps) {
  const fileTab = tab as FileTab
  const { path } = fileTab

  return (
    <div className="h-full overflow-hidden">
      <FileViewer path={path} />
    </div>
  )
}
