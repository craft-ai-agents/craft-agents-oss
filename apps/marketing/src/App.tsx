import { Markdown } from '@craft-agent/ui/markdown'

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
      {/* Craft colorful C logo */}
      <svg className="w-12 h-12 mt-8 mb-16" viewBox="0 0 299 300" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M137.879,300.001 L137.875,300.001 C62.3239,300.001 0.966154,239.232 0.0117188,163.908 L0,162.126 L137.879,162.126 L137.879,300.001 Z" fill="#06367A"/>
        <path d="M137.879,0 L137.875,0 C61.729,0 0,61.729 0,137.875 L0,137.878 L137.879,137.878 L137.879,0 Z" fill="#FF51FF"/>
        <path d="M160.558,137.883 L160.561,137.883 C236.707,137.883 298.436,76.1537 298.436,0.00758561 L298.436,0.00562043 L160.558,0.00562043 L160.558,137.883 Z" fill="#007CFF"/>
        <path d="M160.558,162.123 L160.561,162.123 C236.112,162.123 297.471,222.891 298.426,298.216 L298.436,299.998 L160.558,299.998 L160.558,162.123 Z" fill="#0A377B"/>
      </svg>
      <div className="bg-background rounded-[20px] shadow-strong max-w-3xl w-full p-8 md:p-12 text-[13px]">
        <Markdown>
          {article}
        </Markdown>
      </div>
    </main>
  )
}
