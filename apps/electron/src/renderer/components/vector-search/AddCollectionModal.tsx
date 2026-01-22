/**
 * AddCollectionModal Component
 *
 * Modal dialog for adding new collections to the vector search index.
 * Handles folder selection, collection naming, and file pattern configuration.
 */

import { useState, useCallback } from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addCollectionModalAtom,
  collectionOperationAtom,
  collectionsAtom,
} from '../../atoms/vector-search'

interface AddCollectionModalProps {
  onCollectionAdded?: () => void
}

/**
 * Parse collection list output from QMD CLI
 */
function parseCollectionList(output: string): Array<{
  name: string
  url: string
  pattern: string
  files: number
  updated: string
  rootPath?: string
}> {
  const collections: Array<{
    name: string
    url: string
    pattern: string
    files: number
    updated: string
  }> = []
  const lines = output.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    const nameMatch = line.match(/^(\S+)\s+\(qmd:\/\/([^/]+)\/\)$/)
    if (nameMatch) {
      const collection = {
        name: nameMatch[1],
        url: `qmd://${nameMatch[2]}/`,
        pattern: '',
        files: 0,
        updated: ''
      }
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const subLine = lines[j].trim()
        if (subLine.startsWith('Pattern:')) {
          collection.pattern = subLine.replace('Pattern:', '').trim()
        } else if (subLine.startsWith('Files:')) {
          collection.files = parseInt(subLine.replace('Files:', '').trim()) || 0
        } else if (subLine.startsWith('Updated:')) {
          collection.updated = subLine.replace('Updated:', '').trim()
        }
      }
      collections.push(collection)
    }
    i++
  }
  return collections
}

export function AddCollectionModal({ onCollectionAdded }: AddCollectionModalProps) {
  const [isOpen, setIsOpen] = useAtom(addCollectionModalAtom)
  const [operation, setOperation] = useAtom(collectionOperationAtom)
  const [, setCollections] = useAtom(collectionsAtom)

  const [folderPath, setFolderPath] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [filePattern, setFilePattern] = useState('**/*.md')

  const isSubmitting = operation?.type === 'add' && operation?.status === 'in_progress'

  const resetForm = useCallback(() => {
    setFolderPath('')
    setCollectionName('')
    setFilePattern('**/*.md')
  }, [])

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setIsOpen(false)
      resetForm()
      setOperation(null)
    }
  }, [isSubmitting, setIsOpen, resetForm, setOperation])

  const handleSelectFolder = useCallback(async () => {
    try {
      const path = await window.electronAPI.openFolderDialog()
      if (path) {
        setFolderPath(path)
        // Auto-derive collection name from folder name
        const name = path.split('/').pop() || 'collection'
        setCollectionName(name)
      }
    } catch (err) {
      console.error('[AddCollectionModal] Failed to select folder:', err)
      toast.error('Failed to select folder')
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!folderPath || !collectionName) {
      toast.error('Please select a folder and provide a collection name')
      return
    }

    const toastId = toast.loading('Adding collection...')

    try {
      // Step 1: Add the collection
      setOperation({ type: 'add', status: 'in_progress', step: 'Adding collection...' })

      const addResult = await window.electronAPI.vectorSearchExecute([
        'collection', 'add', folderPath, '--name', collectionName, '--mask', filePattern
      ])

      console.debug('[AddCollectionModal] Add result:', addResult)

      if (addResult.stderr && !addResult.stderr.includes('already exists') && !addResult.stdout) {
        throw new Error(addResult.stderr)
      }

      // Step 2: Run embedding to index documents
      toast.loading('Indexing documents...', { id: toastId })
      setOperation({ type: 'add', status: 'in_progress', step: 'Indexing documents...' })

      const embedResult = await window.electronAPI.vectorSearchExecute(['embed'])
      console.debug('[AddCollectionModal] Embed result:', embedResult)

      // Step 3: Refresh collections list
      setOperation({ type: 'add', status: 'in_progress', step: 'Refreshing list...' })

      const [listResult, config] = await Promise.all([
        window.electronAPI.vectorSearchExecute(['collection', 'list']),
        window.electronAPI.vectorSearchGetConfig()
      ])

      if (listResult.stdout) {
        const rootPathMap = new Map<string, string>()
        if (config?.collections) {
          for (const c of config.collections) {
            rootPathMap.set(c.name, c.path)
          }
        }
        const parsed = parseCollectionList(listResult.stdout)
        const withRootPaths = parsed.map(c => ({
          ...c,
          rootPath: rootPathMap.get(c.name)
        }))
        setCollections(withRootPaths)
      }

      // Success
      setOperation({ type: 'add', status: 'success' })
      toast.success(`Collection '${collectionName}' added successfully`, { id: toastId })

      handleClose()
      onCollectionAdded?.()
    } catch (err) {
      console.error('[AddCollectionModal] Failed to add collection:', err)
      setOperation({ type: 'add', status: 'error', error: err instanceof Error ? err.message : 'Failed to add collection' })
      toast.error(err instanceof Error ? err.message : 'Failed to add collection', { id: toastId })
    }
  }, [folderPath, collectionName, filePattern, setOperation, setCollections, handleClose, onCollectionAdded])

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Collection</DialogTitle>
          <DialogDescription>
            Add a folder of documents to the search index.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Folder Selection */}
          <div className="grid gap-2">
            <Label htmlFor="folder">Folder</Label>
            <div className="flex gap-2">
              <Input
                id="folder"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/path/to/documents"
                disabled={isSubmitting}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSelectFolder}
                disabled={isSubmitting}
              >
                Browse
              </Button>
            </div>
          </div>

          {/* Collection Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">Collection Name</Label>
            <Input
              id="name"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder="my-docs"
              disabled={isSubmitting}
            />
          </div>

          {/* File Pattern */}
          <div className="grid gap-2">
            <Label htmlFor="pattern">File Pattern</Label>
            <Input
              id="pattern"
              value={filePattern}
              onChange={(e) => setFilePattern(e.target.value)}
              placeholder="**/*.md"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Glob pattern for files to index (e.g., **/*.md, **/*.txt)
            </p>
          </div>

          {/* Progress Indicator */}
          {isSubmitting && operation?.step && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              {operation.step}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !folderPath || !collectionName}
          >
            {isSubmitting ? 'Adding...' : 'Add Collection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
