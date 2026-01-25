import React, { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class AgentationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AgentationErrorBoundary] Error caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-destructive/50 bg-destructive/10 p-4 shadow-lg">
          <h3 className="font-semibold text-destructive">Debug Panel Error</h3>
          <p className="mt-1 text-sm text-destructive/80">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 rounded bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/30"
          >
            Dismiss
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
