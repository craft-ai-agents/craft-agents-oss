import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import { DiffPreviewApp } from './components/diff-preview/DiffPreviewApp'
import './index.css'

// Parse URL params to get sessionId and diffId
const params = new URLSearchParams(window.location.search)
const sessionId = params.get('sessionId') || ''
const diffId = params.get('diffId') || ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <DiffPreviewApp sessionId={sessionId} diffId={diffId} />
    </ThemeProvider>
  </React.StrictMode>
)
