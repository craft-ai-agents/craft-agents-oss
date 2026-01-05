import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import { PreviewApp } from './components/preview/PreviewApp'
import { Toaster } from '@/components/ui/sonner'
import './index.css'

// Parse URL params to get previewId
const params = new URLSearchParams(window.location.search)
const previewId = params.get('previewId') || ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PreviewApp previewId={previewId} />
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>
)
