import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { TranslationProvider } from './i18n'
import { Toaster } from '@/components/ui/sonner'
import './index.css'

/**
 * Root component - always renders App
 * App.tsx handles window mode detection internally (main vs tab-content)
 */
function Root() {
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider>
      <ThemeProvider>
        <TranslationProvider>
          <Root />
          <Toaster />
        </TranslationProvider>
      </ThemeProvider>
    </JotaiProvider>
  </React.StrictMode>
)
