import React from 'react'
import './KnowledgeAnswerPanel.css'

interface KnowledgeAnswerPanelProps {
  answer: string
  nodeIds: number[]
  onNodeHover?: (nodeIds: number[]) => void
}

export function KnowledgeAnswerPanel({
  answer,
  nodeIds,
  onNodeHover,
}: KnowledgeAnswerPanelProps) {
  return (
    <div className="knowledge-answer-panel">
      <div className="knowledge-answer-panel__header">
        <h3>Answer</h3>
        <span className="knowledge-answer-panel__sources-badge">{nodeIds.length} sources</span>
      </div>

      <div className="knowledge-answer-panel__content">
        <p className="knowledge-answer-panel__text">{answer}</p>
      </div>

      {nodeIds.length > 0 && (
        <div className="knowledge-answer-panel__sources">
          <h4>Sources</h4>
          <div className="knowledge-answer-panel__source-list">
            {nodeIds.map((nodeId) => (
              <div
                key={nodeId}
                className="knowledge-answer-panel__source-item"
                onMouseEnter={() => onNodeHover?.([nodeId])}
                onMouseLeave={() => onNodeHover?.([])}
              >
                <span className="knowledge-answer-panel__source-badge">{nodeId}</span>
                <span className="knowledge-answer-panel__source-text">Node {nodeId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
