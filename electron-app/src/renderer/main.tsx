import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import './index.css'

// Inject mock API when running in browser (no Electron)
if (!window.electronAPI) {
  console.log('[Dev] Running in browser mode with mock data')
  // Dynamic import to avoid bundling mocks in production Electron build
  import('./mocks/electronAPI').then(({ mockElectronAPI }) => {
    window.electronAPI = mockElectronAPI
    renderApp()
  })
} else {
  renderApp()
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <JotaiProvider>
        <App />
      </JotaiProvider>
    </React.StrictMode>
  )
}
