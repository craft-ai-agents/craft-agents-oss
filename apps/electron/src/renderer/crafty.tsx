/**
 * Crafty window — React entry point (crafty.html).
 *
 * A transparent, click-through window over the pointer's display that shows the companion and the
 * panel. It talks to the main-process controller over `window.electronAPI.crafty` and to sessions
 * over the regular session API. See `shared/crafty.ts`.
 */

import ReactDOM from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { TooltipProvider } from '@craft-agent/ui'
import { CraftyApp } from './crafty/CraftyApp'
import './index.css'
import './crafty/crafty.css'

// Standalone entry: the shared Markdown renderer uses translated labels (code block actions)
setupI18n([LanguageDetector, initReactI18next])

// The model menu (shared with the composer) has tooltips
ReactDOM.createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <CraftyApp />
  </TooltipProvider>,
)
