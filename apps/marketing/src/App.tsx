import { Markdown } from '@craft-agent/ui/markdown'
import { CRAFT_LOGO } from '@craft-agent/shared/branding'

const article = `
# Craft Agent

Craft Agent is an AI-powered desktop application that helps you work seamlessly across your data sources. Built on Claude, it connects your documents, code repositories, APIs, and tools into a unified conversational interface where you can search, analyze, and create without switching contexts.

## Connect Everything

Whether it's your Craft documents, GitHub repositories, Linear issues, Obsidian notes, or custom REST APIs—Craft Agent brings them all together. Configure MCP servers or connect directly to services with OAuth, and let AI traverse your entire knowledge graph to find answers and complete tasks.

## Work Naturally

Instead of learning different interfaces for each tool, just describe what you need. Craft Agent understands context, maintains conversation history, and can execute multi-step workflows that span multiple data sources. It's like having a research assistant who knows where everything is.

## Built for macOS

A native desktop experience with multi-session inbox management, keyboard-first navigation, and seamless integration with your existing workflow. Install with a single command and start connecting your world.

\`\`\`bash
curl -fsSL https://agents.craft.do/install-app.sh | bash
\`\`\`
`

export default function App() {
  return (
    <main className="min-h-screen bg-foreground-2 flex flex-col items-center justify-center p-6">
      {/* ASCII logo from OAuth callback page */}
      <pre className="text-accent font-mono text-[6px] leading-none whitespace-pre mt-8 mb-16" style={{ letterSpacing: '-0.05em' }}>
        {CRAFT_LOGO.join('\n')}
      </pre>
      <div className="bg-background rounded-[20px] shadow-strong max-w-3xl w-full p-8 md:p-12 text-[13px]">
        <Markdown>
          {article}
        </Markdown>
      </div>
    </main>
  )
}
