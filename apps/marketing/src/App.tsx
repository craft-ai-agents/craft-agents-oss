import { Outlet } from 'react-router-dom'
import { Header } from './components/Header'
import { Dithering } from '@paper-design/shaders-react'
import { useHasHardwareGPU } from './hooks/useHasHardwareGPU'

/**
 * Root layout shell for all marketing pages.
 * Renders the shared Header, dithering background, and a route outlet.
 */
export default function App() {
  const hasHardwareGPU = useHasHardwareGPU()

  return (
    <div className="relative min-h-screen bg-foreground-2">
      <Header />

      {/* Dithering shader background - disabled on software-rendered GPUs for performance */}
      {hasHardwareGPU && (
        <div className="fixed inset-0 pointer-events-none">
          <Dithering
            colorBack="#00000000"
            colorFront="#d1c6e13d"
            shape="swirl"
            type="8x8"
            size={2.0}
            speed={0.4}
            scale={1.0}
            rotation={0}
            offsetX={0}
            offsetY={0}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}

      <Outlet />

      {/* Footer */}
      <footer className="relative z-10 px-6 pb-8 flex items-center justify-between max-w-4xl w-full mx-auto text-[12px] text-foreground/50">
        <span>&copy; 2026 Craft Docs Limited, Inc. All rights reserved.</span>
        <div className="flex items-center gap-4">
          <a href="mailto:agents@craft.do" className="hover:text-foreground transition-colors">Contact</a>
          <a href="https://github.com/craft-ai-agents/craft-agents-oss" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
          <a href="https://x.com/craftdocs" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        </div>
      </footer>
    </div>
  )
}
