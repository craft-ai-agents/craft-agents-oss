import { useState, useRef, useEffect } from 'react'
import desktopScreenshot from '../assets/desktop/agent-screenshot.webp'
import desktopScreenshot2x from '../assets/desktop/agent-screenshot@2x.webp'
import multitaskingScreenshot from '../assets/desktop/Multitasking.webp'
import multitaskingScreenshot2x from '../assets/desktop/Multitasking@2x.webp'
import planScreenshot from '../assets/desktop/plan.webp'
import planScreenshot2x from '../assets/desktop/plan@2x.webp'
import sharedSessionsScreenshot from '../assets/desktop/shared_sessions.webp'
import sharedSessionsScreenshot2x from '../assets/desktop/shared_sessions@2x.webp'
import themingScreenshot from '../assets/desktop/theming.webp'
import themingScreenshot2x from '../assets/desktop/theming@2x.webp'
import agentNativeScreenshot from '../assets/desktop/agent_native.webp'
import agentNativeScreenshot2x from '../assets/desktop/agent_native@2x.webp'
import browserScreenshot from '../assets/desktop/browser.webp'
import browserScreenshot2x from '../assets/desktop/browser@2x.webp'
import agentsLogo from '../assets/agents_logo.svg'

// Integration icons - locally served
import iconCraft from '../assets/icons/craft.svg'
import iconNotion from '../assets/icons/notion.svg'
import iconObsidian from '../assets/icons/obsidian.svg'
import iconGmail from '../assets/icons/gmail.svg'
import iconGithub from '../assets/icons/github.svg'
import iconGitlab from '../assets/icons/gitlab.svg'
import iconFigma from '../assets/icons/figma.svg'
import iconDropbox from '../assets/icons/dropbox.svg'
import iconGoogledrive from '../assets/icons/googledrive.svg'
import iconAirtable from '../assets/icons/airtable.svg'
import iconTrello from '../assets/icons/trello.svg'
import iconAsana from '../assets/icons/asana.svg'
import iconDiscord from '../assets/icons/discord.svg'
import iconStripe from '../assets/icons/stripe.svg'
import iconZendesk from '../assets/icons/zendesk.svg'
import iconHubspot from '../assets/icons/hubspot.svg'
import iconSentry from '../assets/icons/sentry.svg'
import iconShopify from '../assets/icons/shopify.svg'
import iconMongodb from '../assets/icons/mongodb.svg'
import iconRedis from '../assets/icons/redis.svg'
import iconPostgresql from '../assets/icons/postgresql.svg'
import iconSupabase from '../assets/icons/supabase.svg'
import iconVercel from '../assets/icons/vercel.svg'
import iconGooglecloud from '../assets/icons/googlecloud.svg'
import iconLinear from '../assets/icons/linear.svg'
import iconJira from '../assets/icons/jira.svg'
import iconZoom from '../assets/icons/zoom.svg'
import iconApple from '../assets/icons/apple.svg'
import iconTodoist from '../assets/icons/todoist.svg'
import iconEvernote from '../assets/icons/evernote.svg'
import iconClickup from '../assets/icons/clickup.svg'
import iconX from '../assets/icons/x.svg'
import iconAnthropic from '../assets/icons/anthropic.svg'
import iconOpenai from '../assets/icons/openai.svg'
import iconOpenrouter from '../assets/icons/openrouter.svg'
import iconOllama from '../assets/icons/ollama.svg'

const integrationIcons = [
  { name: 'Craft', src: iconCraft },
  { name: 'Notion', src: iconNotion },
  { name: 'Obsidian', src: iconObsidian },
  { name: 'Gmail', src: iconGmail },
  { name: 'GitHub', src: iconGithub },
  { name: 'GitLab', src: iconGitlab },
  { name: 'Figma', src: iconFigma },
  { name: 'Dropbox', src: iconDropbox },
  { name: 'Google Drive', src: iconGoogledrive },
  { name: 'Airtable', src: iconAirtable },
  { name: 'Trello', src: iconTrello },
  { name: 'Asana', src: iconAsana },
  { name: 'Discord', src: iconDiscord },
  { name: 'Stripe', src: iconStripe },
  { name: 'Zendesk', src: iconZendesk },
  { name: 'HubSpot', src: iconHubspot },
  { name: 'Sentry', src: iconSentry },
  { name: 'Shopify', src: iconShopify },
  { name: 'MongoDB', src: iconMongodb },
  { name: 'Redis', src: iconRedis },
  { name: 'PostgreSQL', src: iconPostgresql },
  { name: 'Supabase', src: iconSupabase },
  { name: 'Vercel', src: iconVercel },
  { name: 'Google Cloud', src: iconGooglecloud },
  { name: 'Linear', src: iconLinear },
  { name: 'Jira', src: iconJira },
  { name: 'Zoom', src: iconZoom },
  { name: 'Apple', src: iconApple },
  { name: 'Todoist', src: iconTodoist },
  { name: 'Evernote', src: iconEvernote },
  { name: 'ClickUp', src: iconClickup },
  { name: 'X', src: iconX },
  { name: 'Anthropic', src: iconAnthropic },
]


// FAQ items — conversational tone, skeptic getting progressively won over
const faqItems = [
  {
    question: 'How do I connect to Linear, Gmail, Slack...?',
    answer: 'Just tell the agent "add Linear as a source." Really. It finds public APIs and MCP servers, reads their documentation, fetches credentials, and sets everything up. Sources become instantly available. No config files, no setup wizards.',
    links: [
      { text: 'Check out how I just connected to Slack', url: 'https://agents.craft.do/s/DRNQEiy8w2e1v5LPgKl8b' },
    ],
  },
  {
    question: 'But I already have my MCP config JSON...',
    answer: 'Great. Paste it. The agent handles the rest.',
  },
  {
    question: 'What about local MCPs? I need those.',
    answer: 'Fully supported. Stdio-based MCP servers run as local subprocesses right on your machine. Point it at an npx command, a Python script, or any local binary. It just works.',
  },
  {
    question: "Surely it can't handle custom APIs?",
    answer: "It can. Paste an OpenAPI spec, some endpoint URLs, screenshots of docs, whatever you have. It will figure it out and guide you through the rest. And if there's no API? It opens a browser and does the work directly on the website.",
  },
  {
    question: "But I meant APIs. Not MCPs. Are you sure?",
    answer: "Yes. Craft Agents is built to connect to anything. We have it hooked up to a direct Postgres DB behind a jumpbox. And for services with no API at all, the agent opens a built-in browser, logs in, and gets the job done. Skills + Sources + Browser = magic.",
  },
  {
    question: 'Wait, it has a browser?',
    answer: 'Yes. A full Chromium browser, built in. The agent can navigate pages, fill forms, click buttons, extract data, and take screenshots. Sign into a service yourself, then let the agent take over. Or let it browse autonomously. It sees what you see.',
  },
  {
    question: 'How do I import my Claude Code skills and MCPs?',
    answer: 'Ask it. Tell the agent you want to use your skills from Claude Code. It imports them. Done.',
    links: [
      { text: 'Here I imported all my skills in one go', url: 'https://agents.craft.do/s/gWCFqwhObFWaNJIEJmd6j' },
    ],
  },
  {
    question: 'How do I create a new skill?',
    answer: 'Ask it. Describe what the skill should do, give it context. It takes care of the rest.',
  },
  {
    question: 'And then, restart the app, right?',
    answer: 'No. Everything is instant. Mention skills or sources with @, even mid-conversation.',
  },
  {
    question: 'So I can just... ask it anything?',
    answer: "Yes. That's the core idea. Agent-native software means you describe what you want, and it figures out how — via APIs, MCP servers, code, or the browser. That's a good use of tokens. The agent doing the work for you.",
  },
]

// Platform download links with icons
const downloads = [
  {
    label: 'macOS (Apple Silicon)',
    url: 'https://agents.craft.do/electron/latest/Craft-Agents-arm64.dmg',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    label: 'macOS (Intel)',
    url: 'https://agents.craft.do/electron/latest/Craft-Agents-x64.dmg',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    label: 'Windows',
    url: 'https://agents.craft.do/electron/latest/Craft-Agents-x64.exe',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
      </svg>
    ),
  },
  {
    label: 'Linux',
    url: 'https://agents.craft.do/electron/latest/Craft-Agents-x64.AppImage',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.468v.018c0 .135.035.264.092.399.063.06.118.133.183.198-.025.066-.063.066-.09.133a.726.726 0 01-.131.066.873.873 0 01-.085.042.947.947 0 01-.218-.332 1.788 1.788 0 01-.146-.706l-.004.024a.06.06 0 01-.003.021v-.105c0 .02.005.04.005.06a1.724 1.724 0 01.168-.724c.104-.2.244-.398.438-.533.19-.136.37-.198.585-.198zm-2.646.748c.078 0 .14.016.192.08.078.082.104.205.152.331.048.127.086.293.171.47.082.176.198.385.413.584.214.198.489.394.748.592.259.2.478.4.633.605.158.204.258.434.258.671l-.003.03c-.002.182-.081.352-.194.491a1.99 1.99 0 01-.455.377 3.21 3.21 0 01-.56.273c-.189.073-.351.133-.463.184l-.003.003c-.078.033-.127.067-.147.07a.035.035 0 01-.02.002c-.09-.003-.182-.066-.297-.199-.114-.132-.229-.265-.422-.465l-.003-.003c-.2-.166-.4-.399-.6-.601-.202-.199-.4-.426-.644-.625-.165-.135-.367-.265-.565-.2-.199.066-.385.198-.454.537l-.003.03c-.056.365.132.674.297.936.033.066.063.135.093.2a2.22 2.22 0 01-.657-.805 2.1 2.1 0 01-.218-.935c0-.4.126-.734.4-1.002.273-.266.688-.534 1.168-.79.48-.253 1.002-.468 1.41-.604.406-.135.668-.197.803-.197l.014-.002z"/>
      </svg>
    ),
  },
]

export default function HomePage() {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const dropdownRef2 = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInsideDropdown1 = dropdownRef.current?.contains(target)
      const isInsideDropdown2 = dropdownRef2.current?.contains(target)
      if (!isInsideDropdown1 && !isInsideDropdown2) {
        setDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <main className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 pt-[80px] pb-[128px]">
      {/* Craft Agents logo */}
      <img src={agentsLogo} alt="Craft Agents" className="w-[224px] mb-[48px]" />

      {/* Hero header */}
      <div className="text-center max-w-2xl py-2 mb-12">
        <h1 className="text-3xl font-extrabold leading-tight mb-4">
          Work with most powerful agents in the world, with the UX they deserve
        </h1>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Works with <strong>Claude</strong>, <strong>ChatGPT</strong>, <strong>OpenRouter</strong>, <strong>local models</strong>, and more.
          <br />
          Connect to anything — either via Browser, API, MCP server, or local filesystem.
          <br />
          Multitask naturally. Build your next-gen workflow with agents.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap justify-center gap-3 max-w-4xl w-full mb-[48px]">
        {/* Download dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDownloadOpen(!downloadOpen)}
            className="bg-foreground text-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap focus-visible:outline-none"
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

        {/* See how it works button */}
        <a
          href="https://www.youtube.com/watch?v=xQouiAIilvU"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-background rounded-[12px] shadow-strong py-3 px-6 text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 whitespace-nowrap"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" opacity="0.3"/>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
          See how it works
        </a>

        {/* View Source Code */}
        <a
          href="https://github.com/craft-ai-agents/craft-agents-oss"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 whitespace-nowrap"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          View Source Code
        </a>
      </div>

      {/* Hero screenshot with video link */}
      <a
        href="https://www.youtube.com/watch?v=xQouiAIilvU"
        target="_blank"
        rel="noopener noreferrer"
        className="relative block max-w-6xl w-full mb-12 group"
      >
        <img
          src={desktopScreenshot}
          srcSet={`${desktopScreenshot} 1x, ${desktopScreenshot2x} 2x`}
          alt="Craft Agents interface"
          className="w-full rounded-[12px] shadow-hero"
        />
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-black/70 flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-black/90">
            <svg className="w-10 h-10 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </a>

      {/* FAQ section — conversational Q&A list */}
      <div className="max-w-[720px] w-full py-8 mt-16">
        <h2 className="text-2xl font-extrabold leading-tight mb-16 text-center">
          Things that are hard to believe "just work"
        </h2>
        <div className="flex flex-col gap-6">
          {faqItems.map((item, index) => (
            <div key={index}>
              <h3 className="font-semibold text-[15px] mb-1">{item.question}</h3>
              <p className="text-[14px] text-foreground/70 leading-relaxed">
                {item.answer}
              </p>
              {item.links && (
                <span className="flex gap-4 mt-2">
                  {item.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground transition-colors text-[13px] text-foreground/50"
                    >
                      {link.text} &rarr;
                    </a>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bring your own model section */}
      <div className="text-left max-w-4xl w-full py-8 mt-16">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Bring your own model
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Use Claude with your Anthropic API key. Connect your ChatGPT Plus subscription. Route through OpenRouter for 400+ models. Run fully offline with Ollama or LM Studio. Switch anytime — your workflow stays the same.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <div className="flex items-center gap-3 mb-2">
              <img src={iconAnthropic} alt="Anthropic" className="w-5 h-5" />
              <h3 className="font-semibold">Claude</h3>
            </div>
            <p className="text-[14px] text-foreground/70">The most powerful coding agents. Direct API key or Max subscription.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <div className="flex items-center gap-3 mb-2">
              <img src={iconOpenai} alt="OpenAI" className="w-5 h-5" />
              <h3 className="font-semibold">ChatGPT Plus</h3>
            </div>
            <p className="text-[14px] text-foreground/70">Use your existing OpenAI subscription. Full agent capabilities via Codex.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <div className="flex items-center gap-3 mb-2">
              <img src={iconOpenrouter} alt="OpenRouter" className="w-5 h-5" />
              <h3 className="font-semibold">OpenRouter, Vercel AI Gateway & more</h3>
            </div>
            <p className="text-[14px] text-foreground/70">Route through OpenRouter, Vercel AI Gateway, or any compatible gateway. Access hundreds of models through a single endpoint.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <div className="flex items-center gap-3 mb-2">
              <img src={iconOllama} alt="Ollama" className="w-5 h-5" />
              <h3 className="font-semibold">Local Models</h3>
            </div>
            <p className="text-[14px] text-foreground/70">Run Ollama, LM Studio, or any OpenAI-compatible endpoint. Fully private, fully offline.</p>
          </div>
        </div>
        <p className="text-[13px] text-foreground/40 leading-relaxed mt-6">
          Compatible with Anthropic, OpenAI, Google Gemini, xAI Grok, Mistral, DeepSeek, Meta Llama, Cohere, Groq, Together.ai, Fireworks, Cerebras, Perplexity, Amazon Bedrock, Azure OpenAI, Google Vertex, Alibaba Qwen, MiniMax, Inflection Pi, Moonshot, DeepInfra, SambaNova, Zhipu AI, FriendliAI — and any OpenAI-compatible endpoint via OpenRouter, Ollama, or llama.cpp. Powered by the Vercel AI SDK.
        </p>
      </div>

      <hr className="w-[128px] border-foreground/10 mt-[40px]" />

      {/* Connect section */}
      <div className="text-left max-w-4xl w-full py-8 mt-16">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Connect to any API, MCP or local source
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Your agents need information to be useful. Craft Agents lets you connect to anything: REST APIs, MCP servers, or your local filesystem. All in one place.
        </p>
        {/* Icon cloud - shows exactly 2 full rows, hides overflow on resize */}
        <div className="flex flex-wrap gap-6 mt-8 opacity-50 max-h-[88px] overflow-hidden">
          {integrationIcons.map((icon) => (
            <img
              key={icon.name}
              src={icon.src}
              alt={icon.name}
              className="w-8 h-8"
              title={icon.name}
            />
          ))}
        </div>
        {/* Integration cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Setup in seconds</h3>
            <p className="text-[14px] text-foreground/70">Just tell the agent "connect to Linear". It fetches credentials, reads docs, and configures everything automatically.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Private APIs welcome</h3>
            <p className="text-[14px] text-foreground/70">No MCP required. Enrich your workflows with internal company data, private endpoints, and custom services.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Apps on your device</h3>
            <p className="text-[14px] text-foreground/70">Integrate Apple Notes, Obsidian vaults, local databases, and files directly into your agent workflows.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Full control</h3>
            <p className="text-[14px] text-foreground/70">Set fine-grained permissions per source. Define exactly what each connection can read, write, or execute.</p>
          </div>
        </div>
      </div>

      {/* Multitasking section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Multitasking, without the learning curve
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          The UX feels like email and task managers. Working with agents shouldn't feel different. Organize, prioritize, and switch contexts naturally.
        </p>
        {/* Image + description side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <img
            src={multitaskingScreenshot}
            srcSet={`${multitaskingScreenshot} 1x, ${multitaskingScreenshot2x} 2x`}
            alt="Multitasking interface"
            className="w-full rounded-[12px] shadow-strong aspect-square md:aspect-auto object-cover object-top"
          />
          <div className="bg-background rounded-[12px] shadow-minimal p-6 pl-[26px] flex flex-col">
            <h3 className="font-semibold mb-[10px]">Work like you already do</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              Track what's done and what still needs work. Set up custom states that fit your workflow. Organize agent conversations just like messages in your inbox.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">Switch without losing focus</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              Jump between tasks freely. Each session keeps its full history. Pause one, start another, and return exactly where you left off.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">Runs in the background</h3>
            <p className="text-[14px] text-foreground/70">
              Start long-running tasks and let them work while you focus on something else. Get notified when they're done.
            </p>
          </div>
        </div>
      </div>

      {/* Explore, Plan, Execute section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Explore, plan, refine, delegate
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          To get the most out of agents, you need to trust them with execution and focus on the bigger picture. Align on the goal, refine the approach together, then step back and let them work. Review the results when they're done. It's the same dynamic that makes great teams effective: clear direction, autonomy in execution, and accountability at the end.
        </p>
      </div>

      {/* Full-width hero image for Explore/Plan section */}
      <img
        src={planScreenshot}
        srcSet={`${planScreenshot} 1x, ${planScreenshot2x} 2x`}
        alt="Explore and plan workflow"
        className="max-w-4xl w-full rounded-[12px] shadow-hero"
      />

      {/* Explore/Execute mode cards */}
      <div className="max-w-4xl w-full py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Explore mode</h3>
            <p className="text-[14px] text-foreground/70">Read-only by default. Let the agent research, analyze, and draft a plan. Review proposals before any changes happen. Iterate until you're aligned.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Execute mode</h3>
            <p className="text-[14px] text-foreground/70">Once aligned, switch to Execute. The agent executes without interruption. Review the results when done, just like reviewing delivered work from a teammate.</p>
          </div>
        </div>
      </div>

      {/* Browser section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          A browser, built right in
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Navigate websites, fill forms, extract data, take screenshots — all without leaving your workflow. The agent sees what you see and acts on your behalf.
        </p>
      </div>

      {/* Browser screenshot */}
      <img
        src={browserScreenshot}
        srcSet={`${browserScreenshot} 1x, ${browserScreenshot2x} 2x`}
        alt="Built-in browser"
        className="max-w-4xl w-full rounded-[12px]"
      />

      {/* Browser feature cards */}
      <div className="max-w-4xl w-full py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">See and interact</h3>
            <p className="text-[14px] text-foreground/70">The agent navigates real web pages. Click, fill, scroll, and extract — all through natural language.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Login and authenticate</h3>
            <p className="text-[14px] text-foreground/70">Sign into services the agent needs. OAuth flows, cookie-based auth, or just browsing as yourself.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Extract and transform</h3>
            <p className="text-[14px] text-foreground/70">Pull structured data from any webpage. Tables, listings, dashboards — into your workflow instantly.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Screenshot and capture</h3>
            <p className="text-[14px] text-foreground/70">Take annotated screenshots of any page or element. Document, debug, or compare UI states visually.</p>
          </div>
        </div>
      </div>

      {/* Sharing section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Share your plans, decisions and logic. Your entire conversation.
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          With AI, conversations become the documentation. Every decision, rationale, and implementation detail lives in the thread. Attach sessions to tickets, issues, or PRs. Share with your team so they understand not just what changed, but why.
        </p>
        {/* Image + description side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <a
            href="https://agents.craft.do/s/xW1SfMIhfMvMfRL2pJKMI"
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <img
              src={sharedSessionsScreenshot}
              srcSet={`${sharedSessionsScreenshot} 1x, ${sharedSessionsScreenshot2x} 2x`}
              alt="Shared session interface"
              className="w-full rounded-[12px] shadow-strong aspect-square md:aspect-auto object-cover object-top hover:opacity-90 transition-opacity cursor-pointer"
            />
          </a>
          <div className="bg-background rounded-[12px] shadow-minimal p-6 pl-[26px] flex flex-col">
            <h3 className="font-semibold mb-[10px]">Decisions with context</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              The conversation captures every trade-off considered, alternative rejected, and reason behind each choice. Context that usually gets lost is preserved.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">Link to your workflow</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              Attach shared sessions to Linear issues, GitHub PRs, or Confluence pages. Reviewers see the full reasoning, not just the end result.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">Host it yourself</h3>
            <p className="text-[14px] text-foreground/70">
              Deploy the viewer on your own infrastructure. Keep everything internal and maintain full control over where your data lives.
            </p>
          </div>
        </div>
      </div>

      {/* Customization section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Make Craft Agents yours
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Craft Agents adapts to how you work. Customize themes, create your own skills, and configure behaviors to match your preferences. Everything is a file you can edit, version, and share.
        </p>
      </div>

      {/* Theming hero image */}
      <img
        src={themingScreenshot}
        srcSet={`${themingScreenshot} 1x, ${themingScreenshot2x} 2x`}
        alt="Custom theming interface"
        className="max-w-6xl w-full rounded-[12px] shadow-hero"
      />

      {/* Customization cards */}
      <div className="max-w-4xl w-full py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Look, feel, and behavior</h3>
            <p className="text-[14px] text-foreground/70">Themes, statuses, workflows, permissions. Everything lives in files the agent can edit in real time. Make it truly yours.</p>
          </div>
          <div className="bg-background rounded-[12px] shadow-minimal p-6">
            <h3 className="font-semibold mb-2">Skills</h3>
            <p className="text-[14px] text-foreground/70">Claude Code skills, built in. Create reusable prompts and workflows that the agent follows for specific tasks. Your shortcuts, your way.</p>
          </div>
        </div>
      </div>

      {/* Agent Native section */}
      <div className="text-left max-w-4xl w-full py-8 mt-8">
        <h2 className="text-2xl font-extrabold leading-tight mb-4">
          Agent Native Architecture
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          Software is changing. Instead of rigid, predetermined systems, applications can now grow and adapt with you. We built Craft Agents with{' '}
          <a
            href="https://every.to/chain-of-thought/agent-native-architectures-how-to-build-apps-after-the-end-of-code"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            Agent Native
          </a>{' '}
          principles: the agent isn't a feature, it's the foundation.
        </p>
        {/* Image + description side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <img
            src={agentNativeScreenshot}
            srcSet={`${agentNativeScreenshot} 1x, ${agentNativeScreenshot2x} 2x`}
            alt="Agent native architecture"
            className="w-full rounded-[12px] shadow-strong aspect-square md:aspect-auto object-cover object-top"
          />
          <div className="bg-background rounded-[12px] shadow-minimal p-6 pl-[26px] flex flex-col">
            <h3 className="font-semibold mb-[10px]">Specification over implementation</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              Describe what you want, not how to build it. Features become prompts, not code. The agent handles the complexity.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">Flexible by design</h3>
            <p className="text-[14px] text-foreground/70 mb-4">
              Modify behavior through natural language. No complex settings UIs. Just describe the change and it happens.
            </p>
            <h3 className="font-semibold mt-1 mb-[10px]">True flexibility</h3>
            <p className="text-[14px] text-foreground/70">
              Modify every angle, from UI to behavior to integrations. Craft Agents is built entirely with Craft Agents. Every feature, every fix starts as a conversation.
            </p>
          </div>
        </div>
      </div>

      {/* Closing CTA section */}
      <div className="text-center max-w-xl py-2 mt-16">
        <h2 className="text-3xl font-extrabold leading-tight mb-4">
          The future of personal software is remixing
        </h2>
        <p className="text-[18px] text-foreground/70 leading-relaxed">
          We can't wait to see how you make it yours, shape it to your workflow, and build something that reflects your own taste.
        </p>
      </div>

      {/* CTA buttons */}
      <div className="flex gap-3 max-w-xl w-full mt-8 mb-8">
        {/* Download dropdown */}
        <div ref={dropdownRef2} className="relative flex-1">
          <button
            onClick={() => setDownloadOpen(!downloadOpen)}
            className="w-full bg-foreground text-background rounded-[12px] shadow-strong py-3 px-6 text-center text-[14px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none"
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
          href="https://github.com/craft-ai-agents/craft-agents-oss"
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

    </main>
  )
}
