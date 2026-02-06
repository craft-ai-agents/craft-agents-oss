/**
 * SandboxClient - WebSocket client for remote sandbox tool execution
 *
 * Manages the WebSocket connection to a Cloudflare sandbox instance
 * and routes tool calls (Bash, Read, Write, Edit, etc.) to execute remotely.
 */

// @ts-expect-error - ws module works at runtime, types are not available
import WebSocket from 'ws'
import { encryptAnthropicApiKey } from './sandbox-encryption'
import { parseSDKErrorText, type AgentError } from '@craft-agent/shared/agent/errors'

export interface SandboxToolResult {
  success: boolean
  output?: string
  error?: string
  exitCode?: number
}

/**
 * Events streamed from sandbox execution.
 * Maps to Claude Code's --output-format stream-json output.
 */
export interface SandboxEvent {
  type: 'text_delta' | 'text_complete' | 'tool_start' | 'tool_result' | 'usage' | 'error' | 'typed_error' | 'status'
  text?: string
  toolName?: string
  toolId?: string
  input?: Record<string, unknown>
  output?: string
  isError?: boolean
  inputTokens?: number
  outputTokens?: number
  message?: string
  /** Typed error data for user-friendly error display (matches non-remote behavior) */
  errorData?: AgentError
}

/**
 * Attachment data for sandbox execution
 */
export interface SandboxAttachment {
  name: string
  type: string
  content: string // Base64 for binary
}

interface PendingRequest {
  resolve: (result: SandboxToolResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class SandboxClient {
  private ws: WebSocket | null = null
  private wsUrl: string
  private workspaceApiKey: string
  private workspaceSlug: string
  private encryptedAnthropicKey: string | null = null
  private tokenType: 'api_key' | 'oauth' = 'api_key'
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private requestId = 0
  private reconnectAttempts = 0
  private maxReconnectAttempts = 3
  private reconnectDelay = 1000 // Start with 1 second
  private connected = false
  private connectPromise: Promise<void> | null = null

  constructor(
    wsUrl: string,
    workspaceApiKey: string,
    workspaceSlug: string
  ) {
    this.wsUrl = wsUrl
    this.workspaceApiKey = workspaceApiKey
    this.workspaceSlug = workspaceSlug
  }

  /**
   * Set the Anthropic API key or OAuth token (will be encrypted before sending)
   * @param credential - The API key or OAuth token
   * @param type - 'api_key' for ANTHROPIC_API_KEY, 'oauth' for CLAUDE_CODE_OAUTH_TOKEN
   */
  async setAnthropicApiKey(credential: string, type: 'api_key' | 'oauth' = 'api_key'): Promise<void> {
    this.encryptedAnthropicKey = await encryptAnthropicApiKey(credential, this.workspaceApiKey, this.workspaceSlug)
    this.tokenType = type
  }

  /**
   * Connect to the sandbox WebSocket
   */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      try {
        console.log('[SandboxClient] Connecting to:', this.wsUrl)
        console.log('[SandboxClient] Using workspace:', this.workspaceSlug)

        // WebSocket connections need auth - use query param since it's most reliable
        // Also pass workspace metadata headers for encryption key derivation
        const urlWithAuth = `${this.wsUrl}?apiKey=${encodeURIComponent(this.workspaceApiKey)}`
        console.log('[SandboxClient] URL with auth (redacted):', this.wsUrl + '?apiKey=***')

        this.ws = new WebSocket(urlWithAuth, {
          headers: {
            'X-Workspace-Slug': this.workspaceSlug,
            'X-Api-Key': this.workspaceApiKey,
          },
        })

        this.ws.on('open', () => {
          console.log('[SandboxClient] Connected')
          this.connected = true
          this.reconnectAttempts = 0
          this.reconnectDelay = 1000
          this.connectPromise = null
          resolve()
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString())
        })

        this.ws.on('close', (code: number, reason: Buffer) => {
          console.log(`[SandboxClient] Disconnected: ${code} - ${reason.toString()}`)
          this.connected = false
          this.connectPromise = null
          // Reject all pending requests
          for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout)
            pending.reject(new Error('WebSocket connection closed'))
          }
          this.pendingRequests.clear()
        })

        this.ws.on('error', (error: Error) => {
          console.error('[SandboxClient] WebSocket error:', error)
          this.connectPromise = null
          reject(error)
        })

        // Timeout for initial connection
        const timeout = setTimeout(() => {
          if (!this.connected) {
            this.ws?.close()
            this.connectPromise = null
            reject(new Error('Connection timeout'))
          }
        }, 30000)

        this.ws.on('open', () => clearTimeout(timeout))

      } catch (error) {
        this.connectPromise = null
        reject(error)
      }
    })

    return this.connectPromise
  }

  /**
   * Disconnect from the sandbox
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.connectPromise = null
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Execute a tool in the sandbox
   */
  async executeTool(toolName: string, input: Record<string, unknown>): Promise<SandboxToolResult> {
    if (!this.isConnected()) {
      await this.connect()
    }

    if (!this.encryptedAnthropicKey) {
      throw new Error('Anthropic API key not set. Call setAnthropicApiKey() first.')
    }

    const id = `req_${++this.requestId}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Tool execution timeout: ${toolName}`))
      }, 120000) // 2 minute timeout

      this.pendingRequests.set(id, { resolve, reject, timeout })

      const message = JSON.stringify({
        type: 'tool',
        id,
        name: toolName,
        input,
        anthropicApiKey: this.encryptedAnthropicKey,
      })

      this.ws!.send(message)
    })
  }

  /**
   * Execute a bash command in the sandbox
   */
  async executeCommand(command: string, timeout?: number): Promise<SandboxToolResult> {
    return this.executeTool('Bash', { command, timeout })
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(filePath: string, offset?: number, limit?: number): Promise<SandboxToolResult> {
    return this.executeTool('Read', { file_path: filePath, offset, limit })
  }

  /**
   * Write a file in the sandbox
   */
  async writeFile(filePath: string, content: string): Promise<SandboxToolResult> {
    return this.executeTool('Write', { file_path: filePath, content })
  }

  /**
   * Edit a file in the sandbox
   */
  async editFile(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<SandboxToolResult> {
    return this.executeTool('Edit', {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      replace_all: replaceAll,
    })
  }

  /**
   * Search for files by glob pattern in the sandbox
   */
  async glob(pattern: string, path?: string): Promise<SandboxToolResult> {
    return this.executeTool('Glob', { pattern, path })
  }

  /**
   * Search file contents in the sandbox
   */
  async grep(pattern: string, path?: string, options?: Record<string, unknown>): Promise<SandboxToolResult> {
    return this.executeTool('Grep', { pattern, path, ...options })
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as {
        type: string
        id?: string
        success?: boolean
        output?: string
        error?: string
        exitCode?: number
      }

      if (message.type === 'tool_result' && message.id) {
        const pending = this.pendingRequests.get(message.id)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(message.id)
          pending.resolve({
            success: message.success ?? false,
            output: message.output,
            error: message.error,
            exitCode: message.exitCode,
          })
        }
      } else if (message.type === 'error') {
        console.error('[SandboxClient] Server error:', message.error)
        // If there's a request ID, reject that specific request
        if (message.id) {
          const pending = this.pendingRequests.get(message.id)
          if (pending) {
            clearTimeout(pending.timeout)
            this.pendingRequests.delete(message.id)
            pending.reject(new Error(message.error || 'Unknown sandbox error'))
          }
        }
      } else if (message.type === 'heartbeat') {
        // Respond to heartbeat
        this.ws?.send(JSON.stringify({ type: 'heartbeat_ack' }))
      }
    } catch (error) {
      console.error('[SandboxClient] Failed to parse message:', error)
    }
  }

  /**
   * Send a heartbeat to keep the sandbox alive
   */
  async sendHeartbeat(): Promise<void> {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify({ type: 'heartbeat' }))
    }
  }

  /**
   * Execute a prompt in the sandbox and stream events back.
   * This runs the entire Claude Code agent in the sandbox.
   *
   * @param prompt - The user's message
   * @param context - Conversation history for continuity
   * @param attachments - File attachments (if any)
   * @param onEvent - Callback for each event from the sandbox
   */
  async executePrompt(
    prompt: string,
    context: string,
    attachments: SandboxAttachment[] | undefined,
    onEvent: (event: SandboxEvent) => void
  ): Promise<void> {
    if (!this.isConnected()) {
      await this.connect()
    }

    if (!this.encryptedAnthropicKey) {
      throw new Error('Anthropic API key not set. Call setAnthropicApiKey() first.')
    }

    return new Promise((resolve, reject) => {
      let completed = false

      const messageHandler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type: string
            data?: string
            message?: string
            exitCode?: number
          }

          console.log(`[SandboxClient] Received message type: ${msg.type}`)
          if (msg.type === 'stream') {
            // Parse Claude Code's stream-json format
            console.log(`[SandboxClient] Stream data: ${msg.data?.substring(0, 200)}...`)
            const result = this.parseClaudeStreamEvent(msg.data || '')

            // Handle single event or array of events
            if (result) {
              const events = Array.isArray(result) ? result : [result]
              console.log(`[SandboxClient] Parsed ${events.length} event(s): ${events.map(e => e.type).join(', ')}`)
              for (const event of events) {
                onEvent(event)
              }
            } else {
              console.log(`[SandboxClient] Parsed event: null`)
            }
          } else if (msg.type === 'complete') {
            completed = true
            cleanup()
            resolve()
          } else if (msg.type === 'error') {
            cleanup()
            reject(new Error(msg.message || 'Sandbox execution failed'))
          }
        } catch (parseError) {
          console.error('[SandboxClient] Failed to parse message:', parseError)
        }
      }

      const errorHandler = (error: Error) => {
        if (!completed) {
          cleanup()
          reject(error)
        }
      }

      const closeHandler = () => {
        if (!completed) {
          cleanup()
          reject(new Error('SANDBOX_DISCONNECTED'))
        }
      }

      const cleanup = () => {
        this.ws?.off('message', messageHandler)
        this.ws?.off('error', errorHandler)
        this.ws?.off('close', closeHandler)
      }

      this.ws!.on('message', messageHandler)
      this.ws!.on('error', errorHandler)
      this.ws!.on('close', closeHandler)

      // Send execute request
      this.ws!.send(JSON.stringify({
        type: 'execute',
        prompt,
        context,
        attachments: attachments?.map(a => ({
          name: a.name,
          type: a.type,
          content: a.content,
        })),
        anthropicApiKey: this.encryptedAnthropicKey,
        tokenType: this.tokenType, // 'api_key' or 'oauth' - determines which env var to use
      }))
    })
  }

  /**
   * Parse Claude Code's stream-json format into our event types.
   *
   * Claude Code outputs one JSON object per line:
   * {"type":"assistant","message":{"content":"Let me..."}}
   * {"type":"tool_use","tool_name":"Read","input":{...}}
   * {"type":"tool_result","result":"..."}
   * {"type":"result","cost":{...}}
   */
  private parseClaudeStreamEvent(line: string): SandboxEvent | SandboxEvent[] | null {
    if (!line.trim()) return null

    try {
      // Claude Code stream-json format uses nested message.content arrays
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(line) as any

      switch (parsed.type) {
        case 'assistant': {
          // message.content is an array of content blocks
          const content = parsed.message?.content
          if (!Array.isArray(content)) return null

          const events: SandboxEvent[] = []
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              // Check if this text is an SDK error (e.g., "API Error: 500 {...}")
              const typedError = parseSDKErrorText(block.text)
              if (typedError) {
                events.push({
                  type: 'typed_error',
                  errorData: typedError,
                })
              } else {
                events.push({
                  type: 'text_delta',
                  text: block.text,
                })
              }
            } else if (block.type === 'tool_use') {
              events.push({
                type: 'tool_start',
                toolName: block.name,
                toolId: block.id || `tool_${Date.now()}`,
                input: block.input,
              })
            }
          }
          return events.length === 1 ? events[0] : events.length > 0 ? events : null
        }

        case 'user': {
          // Tool results come as user messages
          const content = parsed.message?.content
          if (!Array.isArray(content)) return null

          const events: SandboxEvent[] = []
          for (const block of content) {
            if (block.type === 'tool_result') {
              events.push({
                type: 'tool_result',
                toolId: block.tool_use_id,
                output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error || false,
              })
            }
          }
          return events.length === 1 ? events[0] : events.length > 0 ? events : null
        }

        case 'result': {
          // Check if the result text contains an SDK error
          const resultText = parsed.result
          if (resultText && typeof resultText === 'string') {
            const typedError = parseSDKErrorText(resultText)
            if (typedError) {
              return {
                type: 'typed_error',
                errorData: typedError,
              }
            }
          }

          // Final result with usage info
          const usage = parsed.usage || {}
          return {
            type: 'usage',
            inputTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
            outputTokens: usage.output_tokens || 0,
            text: parsed.result, // Include the final result text
          }
        }

        case 'error':
          return {
            type: 'error',
            message: parsed.error || 'Unknown error',
          }
      }
    } catch (parseError) {
      console.error('[SandboxClient] Failed to parse stream line:', line, parseError)
    }

    return null
  }
}
