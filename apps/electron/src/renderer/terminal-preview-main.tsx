import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import { TerminalPreviewApp } from './components/terminal-preview/TerminalPreviewApp'
import './index.css'

// Parse URL params to get sessionId and previewId
const params = new URLSearchParams(window.location.search)
const sessionId = params.get('sessionId') || ''
const previewId = params.get('previewId') || ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <TerminalPreviewApp sessionId={sessionId} previewId={previewId} />
    </ThemeProvider>
  </React.StrictMode>
)
