import * as React from 'react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { Terminal, Copy, Check, ChevronRight, Search, FolderSearch } from 'lucide-react'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/ThemeContext'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import type { TerminalPreviewData } from '../../../shared/types'

interface TerminalPreviewAppProps {
  sessionId: string
  previewId: string
}

/**
 * ANSI color code to CSS color mapping
 * Supports both foreground (30-37, 90-97) and background (40-47, 100-107) colors
 */
const ANSI_COLORS: Record<number, string> = {
  // Standard foreground colors (30-37)
  30: '#1a1a1a', // Black
  31: '#ef4444', // Red
  32: '#22c55e', // Green
  33: '#eab308', // Yellow
  34: '#3b82f6', // Blue
  35: '#a855f7', // Magenta
  36: '#06b6d4', // Cyan
  37: '#e4e4e4', // White
  // Bright foreground colors (90-97)
  90: '#666666', // Bright Black (Gray)
  91: '#f87171', // Bright Red
  92: '#4ade80', // Bright Green
  93: '#facc15', // Bright Yellow
  94: '#60a5fa', // Bright Blue
  95: '#c084fc', // Bright Magenta
  96: '#22d3ee', // Bright Cyan
  97: '#ffffff', // Bright White
  // Standard background colors (40-47)
  40: '#1a1a1a', // Black
  41: '#ef4444', // Red
  42: '#22c55e', // Green
  43: '#eab308', // Yellow
  44: '#3b82f6', // Blue
  45: '#a855f7', // Magenta
  46: '#06b6d4', // Cyan
  47: '#e4e4e4', // White
  // Bright background colors (100-107)
  100: '#666666',
  101: '#f87171',
  102: '#4ade80',
  103: '#facc15',
  104: '#60a5fa',
  105: '#c084fc',
  106: '#22d3ee',
  107: '#ffffff',
}

interface AnsiSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
}

/**
 * Parse ANSI escape codes and convert to styled spans
 */
function parseAnsi(input: string): AnsiSpan[] {
  const result: AnsiSpan[] = []
  // Match ANSI escape sequences: ESC[...m
  const regex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let currentFg: string | undefined
  let currentBg: string | undefined
  let currentBold = false

  let match
  while ((match = regex.exec(input)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index)
      if (text) {
        result.push({ text, fg: currentFg, bg: currentBg, bold: currentBold })
      }
    }

    // Parse the SGR codes
    const codes = match[1].split(';').map(c => parseInt(c, 10) || 0)
    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentFg = undefined
        currentBg = undefined
        currentBold = false
      } else if (code === 1) {
        // Bold
        currentBold = true
      } else if (code === 39) {
        // Default foreground
        currentFg = undefined
      } else if (code === 49) {
        // Default background
        currentBg = undefined
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        // Foreground color
        currentFg = ANSI_COLORS[code]
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        // Background color
        currentBg = ANSI_COLORS[code]
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex)
    if (text) {
      result.push({ text, fg: currentFg, bg: currentBg, bold: currentBold })
    }
  }

  return result
}

/**
 * Strip ANSI escape codes from text (for copying)
 */
function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Check if output looks like grep content output (with line numbers)
 * Pattern: starts with lines like "123:" (match) or "123-" (context)
 */
function isGrepContentOutput(output: string): boolean {
  const lines = output.split('\n').slice(0, 5) // Check first 5 lines
  return lines.some(line => /^\d+[:\-]/.test(line))
}

interface GrepLine {
  lineNum: string
  isMatch: boolean
  content: string
}

/**
 * Parse grep content output into structured lines
 */
function parseGrepOutput(output: string): GrepLine[] {
  return output.split('\n').map(line => {
    const match = line.match(/^(\d+)([:])(.*)$/)
    const context = line.match(/^(\d+)(-)(.*)$/)
    if (match) {
      return { lineNum: match[1], isMatch: true, content: match[3] }
    } else if (context) {
      return { lineNum: context[1], isMatch: false, content: context[3] }
    }
    return { lineNum: '', isMatch: false, content: line }
  })
}

/**
 * TerminalPreviewApp - Terminal-style view for Bash command and output
 */
export function TerminalPreviewApp({ sessionId, previewId }: TerminalPreviewAppProps) {
  const [data, setData] = useState<TerminalPreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'command' | 'output' | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)

  // Fetch terminal data on mount
  useEffect(() => {
    async function fetchData() {
      if (!sessionId || !previewId) {
        setError('Missing session or preview ID')
        return
      }

      if (!window.electronAPI?.getTerminalPreviewData) {
        setError('API not available')
        return
      }

      try {
        const result = await window.electronAPI.getTerminalPreviewData(sessionId, previewId)
        if (!result) {
          setError('Terminal data not found')
          return
        }
        setData(result)
      } catch (err) {
        setError(String(err))
      }
    }

    fetchData()
  }, [sessionId, previewId])

  // Copy to clipboard (strip ANSI codes for clean text)
  const copyToClipboard = async (text: string, type: 'command' | 'output') => {
    try {
      await navigator.clipboard.writeText(stripAnsi(text))
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Memoize ANSI-parsed output for performance
  const parsedOutput = useMemo(() => {
    if (!data?.output) return []
    return parseAnsi(data.output)
  }, [data?.output])

  // Check if this looks like grep content output
  const isGrepOutput = useMemo(() => {
    if (!data?.output) return false
    return isGrepContentOutput(data.output)
  }, [data?.output])

  // Parse grep output if applicable
  const grepLines = useMemo(() => {
    if (!isGrepOutput || !data?.output) return []
    return parseGrepOutput(data.output)
  }, [isGrepOutput, data?.output])

  const { resolvedMode } = useTheme()
  const isDark = resolvedMode === 'dark'

  // Theme-aware colors
  const bgColor = isDark ? '#1e1e1e' : '#ffffff'
  const textColor = isDark ? '#e4e4e4' : '#1a1a1a'
  const mutedColor = isDark ? '#888888' : '#666666'
  const promptColor = '#22c55e' // Green for prompt
  const cmdColor = isDark ? '#60a5fa' : '#2563eb' // Blue for command
  const toolbarBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'
  const codeBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
  const outputBg = isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)'

  // Tool type badge config
  const toolConfig = useMemo(() => {
    const toolType = data?.toolType || 'bash'
    switch (toolType) {
      case 'grep':
        return { Icon: Search, label: 'Grep', ...BADGE_CONFIGS.grep }
      case 'glob':
        return { Icon: FolderSearch, label: 'Glob', ...BADGE_CONFIGS.glob }
      default:
        return { Icon: Terminal, label: 'Bash', ...BADGE_CONFIGS.bash }
    }
  }, [data?.toolType])

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor: bgColor, color: textColor }}>
        <WindowHeader borderColor={toolbarBorder}>
          <WindowHeaderBadge
            Icon={toolConfig.Icon}
            label={toolConfig.label}
            bgColor={toolConfig.bgColor}
            textColor={toolConfig.textColor}
          />
          {data?.description && (
            <WindowHeaderBadge
              label={data.description}
              {...(isDark ? BADGE_CONFIGS.dimmedDark : BADGE_CONFIGS.dimmedLight)}
            />
          )}
        </WindowHeader>

        {/* Error overlay */}
        {error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            Error: {error}
          </div>
        )}

        {/* Terminal content */}
        {data && !error && (
          <div className="flex-1 overflow-auto p-4 font-mono text-sm" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            {/* Command section */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs" style={{ color: mutedColor }}>
                  <ChevronRight className="w-3 h-3" style={{ color: promptColor }} />
                  <span>Command</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(data.command, 'command')}
                      className={`h-6 w-6 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                    >
                      {copied === 'command' ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" style={{ color: mutedColor }} />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {copied === 'command' ? 'Copied!' : 'Copy command'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div
                className="p-3 rounded-lg overflow-x-auto"
                style={{ backgroundColor: codeBg }}
              >
                <code style={{ color: cmdColor }}>{data.command}</code>
              </div>
            </div>

            {/* Output section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs" style={{ color: mutedColor }}>
                  <Terminal className="w-3 h-3" />
                  <span>Output</span>
                  {data.exitCode !== undefined && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{
                        backgroundColor: data.exitCode === 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: data.exitCode === 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)',
                      }}
                    >
                      exit {data.exitCode}
                    </span>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(data.output, 'output')}
                      className={`h-6 w-6 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                    >
                      {copied === 'output' ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" style={{ color: mutedColor }} />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {copied === 'output' ? 'Copied!' : 'Copy output'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <pre
                ref={outputRef}
                className="p-3 rounded-lg overflow-auto"
                style={{
                  backgroundColor: outputBg,
                  color: textColor,
                  maxHeight: 'calc(100vh - 200px)',
                }}
              >
                {/* Grep output with line number highlighting */}
                {isGrepOutput && grepLines.length > 0 ? (
                  <div className="space-y-0">
                    {grepLines.map((line, i) => (
                      <div
                        key={i}
                        className="flex"
                        style={{
                          backgroundColor: line.isMatch ? 'rgba(34, 197, 94, 0.08)' : undefined,
                        }}
                      >
                        {/* Line number */}
                        {line.lineNum && (
                          <span
                            className="select-none pr-3 text-right shrink-0"
                            style={{
                              color: line.isMatch ? '#22c55e' : mutedColor,
                              minWidth: '3rem',
                            }}
                          >
                            {line.lineNum}
                            <span style={{ color: line.isMatch ? '#22c55e' : (isDark ? '#444444' : '#cccccc') }}>
                              {line.isMatch ? ':' : '-'}
                            </span>
                          </span>
                        )}
                        {/* Content */}
                        <span
                          className="whitespace-pre-wrap break-words"
                          style={{ color: line.isMatch ? textColor : mutedColor }}
                        >
                          {line.content}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : parsedOutput.length > 0 ? (
                  /* ANSI-colored output */
                  <div className="whitespace-pre-wrap break-words">
                    {parsedOutput.map((span, i) => (
                      <span
                        key={i}
                        style={{
                          color: span.fg,
                          backgroundColor: span.bg,
                          fontWeight: span.bold ? 'bold' : undefined,
                          // Add padding for background colors
                          padding: span.bg ? '0 2px' : undefined,
                          borderRadius: span.bg ? '2px' : undefined,
                        }}
                      >
                        {span.text}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: mutedColor }}>(no output)</span>
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
