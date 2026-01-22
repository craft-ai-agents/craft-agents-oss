/**
 * CollectionList Component
 *
 * Displays a list of indexed collections with management actions.
 * Supports removing collections and re-indexing.
 */

import { useCallback } from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { Trash2, RefreshCw, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  collectionsAtom,
  collectionOperationAtom,
  type CollectionInfo,
} from '../../atoms/vector-search'

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

export function CollectionList() {
  const [collections, setCollections] = useAtom(collectionsAtom)
  const [operation, setOperation] = useAtom(collectionOperationAtom)

  const isOperationInProgress = operation?.status === 'in_progress'

  const refreshCollections = useCallback(async () => {
    try {
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
    } catch (err) {
      console.error('[CollectionList] Failed to refresh collections:', err)
    }
  }, [setCollections])

  const handleRemove = useCallback(async (collection: CollectionInfo) => {
    const toastId = toast.loading(`Removing collection '${collection.name}'...`)

    try {
      setOperation({ type: 'remove', status: 'in_progress', collectionName: collection.name })

      const result = await window.electronAPI.vectorSearchExecute([
        'collection', 'remove', collection.name
      ])

      console.debug('[CollectionList] Remove result:', result)

      if (result.stderr && !result.stdout) {
        throw new Error(result.stderr)
      }

      // Refresh collections list
      await refreshCollections()

      setOperation({ type: 'remove', status: 'success' })
      toast.success(`Collection '${collection.name}' removed`, { id: toastId })
    } catch (err) {
      console.error('[CollectionList] Failed to remove collection:', err)
      setOperation({ type: 'remove', status: 'error', error: err instanceof Error ? err.message : 'Failed to remove' })
      toast.error(err instanceof Error ? err.message : 'Failed to remove collection', { id: toastId })
    }
  }, [setOperation, refreshCollections])

  const handleReindex = useCallback(async (collection: CollectionInfo) => {
    const toastId = toast.loading(`Re-indexing collection '${collection.name}'...`)

    try {
      setOperation({ type: 'reindex', status: 'in_progress', collectionName: collection.name })

      // Use 'update' for incremental re-indexing
      const result = await window.electronAPI.vectorSearchExecute(['update'])

      console.debug('[CollectionList] Re-index result:', result)

      // Refresh collections list to get updated stats
      await refreshCollections()

      setOperation({ type: 'reindex', status: 'success' })
      toast.success(`Collection '${collection.name}' re-indexed`, { id: toastId })
    } catch (err) {
      console.error('[CollectionList] Failed to re-index collection:', err)
      setOperation({ type: 'reindex', status: 'error', error: err instanceof Error ? err.message : 'Failed to re-index' })
      toast.error(err instanceof Error ? err.message : 'Failed to re-index collection', { id: toastId })
    }
  }, [setOperation, refreshCollections])

  if (collections.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">
        Collections ({collections.length})
      </div>
      <div className="space-y-1">
        {collections.map((collection) => {
          const isThisOperating =
            isOperationInProgress && operation?.collectionName === collection.name

          return (
            <div
              key={collection.name}
              className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted/70 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{collection.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {collection.files} files · {collection.pattern} · {collection.updated || 'never'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7"
                  onClick={() => handleReindex(collection)}
                  disabled={isOperationInProgress}
                  title="Re-index collection"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isThisOperating && operation?.type === 'reindex' ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleRemove(collection)}
                  disabled={isOperationInProgress}
                  title="Remove collection"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
