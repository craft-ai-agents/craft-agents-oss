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

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 pt-[48px] pb-[128px]">
        {/* Craft Agents logo */}
        <img src={agentsLogo} alt="Craft Agents" className="w-[224px] mb-8" />

        {/* Action buttons - matching card width and style */}
        <div className="flex gap-3 max-w-2xl w-full mb-12">
          <a
            href="https://github.com/lukilabs/craft-agents/releases"
            className="flex-1 bg-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            Download
          </a>
          <a
            href="https://github.com/lukilabs/craft-agents"
            className="flex-1 bg-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
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
