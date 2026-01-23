import type { WhatsAppMessage } from './types'
import { getSessionId } from './session-mapper'
import { extractDirective, type PermissionDirective } from './directive-parser'

// SessionManager type from main process IPC bridge
// TODO: Move to shared types once IPC types are formalized
type SessionManager = Record<string, any>

export class WhatsAppMessageRouter {
  constructor(
    private workspaceId: string,
    private sessionManager: SessionManager,
  ) {}

  /**
   * Route incoming WhatsApp message to Vespr session
   *
   * Directive Processing Flow:
   * 1. Extract inline permission directive from message (if present)
   *    - Format: @vespr /safe|/ask|/allow-all <message>
   *    - No directive → defaults to safe mode (read-only)
   * 2. Strip directive prefix from message content before sending to agent
   * 3. Apply permission mode override BEFORE sending message
   *
   * Full Logic:
   * 1. Determine session ID from (groupJid, senderJid)
   * 2. Get or create session with WhatsApp metadata
   * 3. Extract and parse directive (null → safe, /safe → safe, /ask → ask, /allow-all → allow-all)
   * 4. Apply permission mode override via setSessionPermissionMode()
   * 5. Send stripped message content to agent (non-blocking)
   * 6. Monitor for session completion
   */
  async routeIncomingMessage(msg: WhatsAppMessage): Promise<void> {
    try {
      // Step 1: Determine session ID
      const sessionId = getSessionId(msg.groupJid, msg.senderJid)

      // Step 2: Get or create session
      let session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        session = await this.sessionManager.createSession(this.workspaceId, {
          name: `${msg.groupName} / ${msg.senderName}`,
          metadata: {
            type: 'whatsapp',
            groupJid: msg.groupJid,
            groupName: msg.groupName,
            senderJid: msg.senderJid,
            senderPhoneNumber: msg.senderPhoneNumber,
            senderName: msg.senderName,
            createdVia: 'whatsapp',
          } as any,
        })
      }

      // Step 3: Extract and parse directive from message
      const { directive, content: strippedContent } = extractDirective(msg.content)

      // Determine permission mode based on directive
      // null → safe, /safe → safe, /ask → ask, /allow-all → allow-all
      const permissionMode = this.getPermissionModeFromDirective(directive)

      // Step 4: Apply permission mode override BEFORE sending message
      await this.sessionManager.setSessionPermissionMode(sessionId, permissionMode)

      // Step 5: Send stripped message to agent (directive prefix removed)
      // Non-blocking: don't wait for agent response
      void this.sessionManager.sendMessage(
        sessionId,
        strippedContent,
        msg.attachments
      )

      // Step 6: Monitor for completion
      this.monitorSessionForResults(sessionId, msg)

    } catch (error) {
      console.error('Failed to route WhatsApp message:', error)
      throw error
    }
  }

  /**
   * Determine permission mode from directive
   * Mapping:
   * - null (no directive) → 'safe' (default: read-only)
   * - 'safe' → 'safe' (read-only)
   * - 'ask' → 'ask' (prompt for approval)
   * - 'allow-all' → 'allow-all' (auto-approve)
   */
  private getPermissionModeFromDirective(
    directive: PermissionDirective
  ): 'safe' | 'ask' | 'allow-all' {
    // When no directive, default to safe mode
    if (directive === null) {
      return 'safe'
    }

    // Directive is already a valid permission mode
    return directive
  }

  /**
   * Monitor session until completion, then deliver results
   */
  private async monitorSessionForResults(
    sessionId: string,
    originalMsg: WhatsAppMessage,
  ): Promise<void> {
    try {
      // Listen for session completion event
      // This will be implemented via callback in Phase 2 integration
      // For now, provide interface for listening

      // TODO in Phase 2a.4: Wire to result formatter and WhatsApp delivery
    } catch (error) {
      console.error('Failed to monitor session results:', error)
    }
  }

  /**
   * Handle multiple routers per workspace
   */
  async routeMultipleMessages(messages: WhatsAppMessage[]): Promise<void> {
    // Route messages in parallel but maintain order per sender
    // Group by sender, route sequentially per sender, parallel across senders
    const bySender = new Map<string, WhatsAppMessage[]>()

    for (const msg of messages) {
      if (!bySender.has(msg.senderJid)) {
        bySender.set(msg.senderJid, [])
      }
      bySender.get(msg.senderJid)!.push(msg)
    }

    // Route all senders in parallel
    await Promise.all(
      Array.from(bySender.values()).map(senderMessages =>
        this.routeSequentially(senderMessages)
      )
    )
  }

  /**
   * Route messages sequentially for same sender (preserves order)
   */
  private async routeSequentially(messages: WhatsAppMessage[]): Promise<void> {
    for (const msg of messages) {
      try {
        await this.routeIncomingMessage(msg)
      } catch (error) {
        console.error(`Failed to route message from ${msg.senderName}:`, error)
      }
    }
  }
}

export function createMessageRouter(
  workspaceId: string,
  sessionManager: SessionManager,
): WhatsAppMessageRouter {
  return new WhatsAppMessageRouter(workspaceId, sessionManager)
}
