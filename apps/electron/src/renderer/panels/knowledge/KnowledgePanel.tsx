import React, { useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Brain, Loader2 } from 'lucide-react'
import { windowWorkspaceIdAtom } from '../../atoms/sessions'
import type { WorkspaceGraph } from '@archstudio/shared/knowledge'
import { KnowledgeGraphViewer } from './KnowledgeGraphViewer'
import { KnowledgeNodePanel } from './KnowledgeNodePanel'
import { KnowledgeQABar } from './KnowledgeQABar'
import { KnowledgeAnswerPanel } from './KnowledgeAnswerPanel'
import './KnowledgePanel.css'

export function KnowledgePanel() {
  const [graph, setGraph] = useState<WorkspaceGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerNodeIds, setAnswerNodeIds] = useState<number[]>([])
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<number[]>([])

  const workspaceId = useAtomValue(windowWorkspaceIdAtom)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setAnswer(null)
      setAnswerNodeIds([])
      setHighlightedNodeIds([])

      if (!workspaceId) {
        setGraph(null)
        setLoading(false)
        return
      }

      try {
        const cached = await window.electronAPI.getGraph(workspaceId)
        if (cancelled) return

        if (cached) {
          setGraph(cached)
          setLoading(false)

          // Refresh the cache after showing the last known graph. A workspace
          // can gain sessions while this panel is open, so the graph should
          // not remain stale until the next navigation.
          void window.electronAPI.buildGraph(workspaceId)
            .then((fresh) => {
              if (!cancelled) setGraph(fresh)
            })
            .catch((err) => {
              if (!cancelled) console.warn('Background graph build failed:', err)
            })
          return
        }

        const built = await window.electronAPI.buildGraph(workspaceId)
        if (cancelled) return
        setGraph(built)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  if (loading) {
    return (
      <div className="knowledge-panel knowledge-panel--loading">
        <div className="knowledge-loading">
          <Loader2 className="knowledge-loading__spinner" />
          <p>Building graph...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="knowledge-panel knowledge-panel--error">
        <div className="knowledge-error">
          <p className="knowledge-error__title">Failed to build graph</p>
          <p className="knowledge-error__message">{error}</p>
        </div>
      </div>
    )
  }

  if (!graph) {
    return (
      <div className="knowledge-panel knowledge-panel--empty">
        <div className="knowledge-empty">
          <Brain size={48} />
          <p>No workspace data yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="knowledge-panel">
      <div className="knowledge-panel__header">
        <div className="knowledge-panel__title">
          <Brain size={20} />
          <h2>Your Second Brain</h2>
        </div>
        <span className="knowledge-panel__count">{graph.nodes.length} nodes</span>
      </div>
      <KnowledgeGraphViewer
        graph={graph}
        selectedNodeId={selectedNodeId}
        highlightedNodeIds={highlightedNodeIds}
        onSelectNode={setSelectedNodeId}
      />
      {selectedNodeId !== null && graph.nodes.find((node) => node.id === selectedNodeId) && (
        <KnowledgeNodePanel
          node={graph.nodes.find((node) => node.id === selectedNodeId)!}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
      {answer && (
        <KnowledgeAnswerPanel
          answer={answer}
          nodeIds={answerNodeIds}
          onNodeHover={setHighlightedNodeIds}
        />
      )}
      <KnowledgeQABar
        workspaceId={workspaceId}
        onAnswer={(answerText, nodeIds) => {
          setAnswer(answerText)
          setAnswerNodeIds(nodeIds)
          setHighlightedNodeIds(nodeIds)
        }}
      />
    </div>
  )
}
