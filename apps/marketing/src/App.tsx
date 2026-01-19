import { useCallback, useState, useRef, useEffect } from 'react'
import { Markdown } from '@craft-agent/ui/markdown'
import { Dithering } from '@paper-design/shaders-react'
import desktopScreenshot from './assets/desktop/screenshot.jpg'
import agentsLogo from './assets/agents_logo.svg'

const article = `
Craft Agents is a tool we built so we can work effectively with agents. It enables intuitive multitasking, no-fluff connection to any API or Service, and a more document (vs code) centric workflow - in a beautiful and fluid UI.

It leans on Claude Code through the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) - follow what we found great, and improves areas where we've desired improvements.

It's built with [Agent Native](https://every.to/guides/agent-native) software principles in mind, and is highly customisable out of the box. One of the first of its kind.

Craft Agents is open source under the Apache 2.0 license - so you are free to remix, change **anything.** And that's actually possible. We ourselves are building Craft Agents with Craft Agents only - no code editors - so really, any customisation is just a prompt away.

We built Craft Agents because we wanted a better, more opinionated (and preferably non-CLI way) of working with the most powerful agents in the world. We'll continue to improve it, based on our experiences and intuition.
`

// Platform download links with icons
const downloads = [
  {
    label: 'macOS (Apple Silicon)',
    url: 'https://agents.craft.do/electron/0.2.21/Craft-Agent-arm64.dmg',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    label: 'macOS (Intel)',
    url: 'https://agents.craft.do/electron/0.2.21/Craft-Agent-x64.dmg',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    label: 'Windows',
    url: 'https://agents.craft.do/electron/0.2.21/Craft-Agent-x64.exe',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
      </svg>
    ),
  },
  {
    label: 'Linux',
    url: 'https://agents.craft.do/electron/0.2.21/Craft-Agent-x64.AppImage',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.468v.018c0 .135.035.264.092.399.063.06.118.133.183.198-.025.066-.063.066-.09.133a.726.726 0 01-.131.066.873.873 0 01-.085.042.947.947 0 01-.218-.332 1.788 1.788 0 01-.146-.706l-.004.024a.06.06 0 01-.003.021v-.105c0 .02.005.04.005.06a1.724 1.724 0 01.168-.724c.104-.2.244-.398.438-.533.19-.136.37-.198.585-.198zm-2.646.748c.078 0 .14.016.192.08.078.082.104.205.152.331.048.127.086.293.171.47.082.176.198.385.413.584.214.198.489.394.748.592.259.2.478.4.633.605.158.204.258.434.258.671l-.003.03c-.002.182-.081.352-.194.491a1.99 1.99 0 01-.455.377 3.21 3.21 0 01-.56.273c-.189.073-.351.133-.463.184l-.003.003c-.078.033-.127.067-.147.07a.035.035 0 01-.02.002c-.09-.003-.182-.066-.297-.199-.114-.132-.229-.265-.422-.465l-.003-.003c-.2-.166-.4-.399-.6-.601-.202-.199-.4-.426-.644-.625-.165-.135-.367-.265-.565-.2-.199.066-.385.198-.454.537l-.003.03c-.056.365.132.674.297.936.033.066.063.135.093.2a2.22 2.22 0 01-.657-.805 2.1 2.1 0 01-.218-.935c0-.4.126-.734.4-1.002.273-.266.688-.534 1.168-.79.48-.253 1.002-.468 1.41-.604.406-.135.668-.197.803-.197l.014-.002z"/>
      </svg>
    ),
  },
]

export default function App() {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Open markdown links in new tab
  const handleUrlClick = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <div className="relative min-h-screen bg-foreground-2">
      {/* Dithering shader background */}
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

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 pt-[60px] pb-[128px]">
        {/* Craft Agents logo */}
        <img src={agentsLogo} alt="Craft Agents" className="w-[224px] mb-[48px]" />

        {/* Action buttons */}
        <div className="flex gap-3 max-w-xl w-full mb-[52px]">
          {/* Download dropdown */}
          <div ref={dropdownRef} className="relative flex-1">
            <button
              onClick={() => setDownloadOpen(!downloadOpen)}
              className="w-full bg-foreground text-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download Craft Agents
            </button>
            {downloadOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-foreground text-background rounded-[12px] shadow-modal-small overflow-hidden z-20">
                {downloads.map((download) => (
                  <a
                    key={download.label}
                    href={download.url}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-background/10 transition-colors text-[13px]"
                  >
                    {download.icon}
                    {download.label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <a
            href="https://github.com/lukilabs/craft-agents-oss"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 bg-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View Source Code
          </a>
        </div>

        {/* Hero screenshot */}
        <img
          src={desktopScreenshot}
          alt="Craft Agents interface"
          className="max-w-4xl w-full mb-12 rounded-[12px] shadow-hero"
        />

        <div className="bg-background rounded-[20px] shadow-strong max-w-2xl w-full p-8 pt-8 md:p-12 md:pt-10 text-[13px] [&_p]:leading-snug [&_p]:my-4">
          <Markdown onUrlClick={handleUrlClick}>
            {article}
          </Markdown>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 pb-8 flex items-center justify-between max-w-4xl mx-auto text-[12px] text-foreground/50">
        <span>© 2026 Craft Docs Limited, Inc. All rights reserved.</span>
        <div className="flex items-center gap-4">
          <a href="https://github.com/lukilabs/craft-agents-oss" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
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
