import React from 'react'
import { X } from 'lucide-react'
import type { GraphNode } from '@archstudio/shared/knowledge'
import './KnowledgeNodePanel.css'

interface KnowledgeNodePanelProps {
  node: GraphNode
  onClose: () => void
}

export function KnowledgeNodePanel({ node, onClose }: KnowledgeNodePanelProps) {
  const typeColor =
    node.type === 'session' ? 'cyan' : node.type === 'source' ? 'purple' : 'lime'

  return (
    <div className="knowledge-node-panel">
      <div className="knowledge-node-panel__header">
        <h3>{node.label}</h3>
        <button className="knowledge-node-panel__close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="knowledge-node-panel__meta">
        <span className={`knowledge-node-panel__type knowledge-node-panel__type--${typeColor}`}>
          {node.type}
        </span>
        <span className="knowledge-node-panel__group">{node.group}</span>
      </div>

      {node.timestamp && (
        <div className="knowledge-node-panel__timestamp">
          {new Date(node.timestamp).toLocaleDateString()}
        </div>
      )}

      <div className="knowledge-node-panel__excerpt">{node.excerpt}</div>

      {node.type === 'session' && node.metadata.sessionId && (
        <button className="knowledge-node-panel__action">Open Session</button>
      )}
    </div>
  )
}
