import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import { MultiFileDiffApp } from './components/multi-file-diff/MultiFileDiffApp'
import './index.css'

// Parse URL params to get sessionId and turnId
const params = new URLSearchParams(window.location.search)
const sessionId = params.get('sessionId') || ''
const turnId = params.get('turnId') || ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <MultiFileDiffApp sessionId={sessionId} turnId={turnId} />
    </ThemeProvider>
  </React.StrictMode>
)
