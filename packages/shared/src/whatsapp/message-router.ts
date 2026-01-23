import type { WhatsAppMessage } from './types'
import { getSessionId } from './session-mapper'

export class WhatsAppMessageRouter {
  constructor(
    private workspaceId: string,
    private sessionManager: any, // SessionManager from main process
  ) {}

  /**
   * Route incoming WhatsApp message to Vespr session
   *
   * Logic:
   * 1. Determine session ID from (groupJid, senderJid)
   * 2. Get or create session with WhatsApp metadata
   * 3. Enforce safe mode (hardcoded for MVP)
   * 4. Send message to agent (non-blocking)
   * 5. Monitor for session completion
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

      // Step 3: Enforce safe mode
      // In MVP, all WhatsApp sessions are safe mode (read-only)
      // Phase 2b: Add directive parsing to override
      await this.sessionManager.setSessionPermissionMode(sessionId, 'safe')

      // Step 4: Send message to agent
      // Non-blocking: don't wait for agent response
      void this.sessionManager.sendMessage(
        sessionId,
        msg.content,
        msg.attachments
      )

      // Step 5: Monitor for completion
      this.monitorSessionForResults(sessionId, msg)

    } catch (error) {
      console.error('Failed to route WhatsApp message:', error)
      throw error
    }
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
