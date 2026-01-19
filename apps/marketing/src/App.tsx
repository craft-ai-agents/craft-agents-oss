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

export default function App() {
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
          <a
            href="https://github.com/lukilabs/craft-agents/releases"
            className="flex-1 bg-foreground text-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download Craft Agents
          </a>
          <a
            href="https://github.com/lukilabs/craft-agents"
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
          <Markdown>
            {article}
          </Markdown>
        </div>
      </main>
    </div>
  )
}
