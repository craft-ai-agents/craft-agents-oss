import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

// Composite key that uniquely identifies a WhatsApp conversation
export interface WhatsAppSessionId {
  groupJid: string // "123-456@g.us"
  senderJid: string // "1234567890@s.whatsapp.net"
  // Composite key: immutable once created
}

/**
 * Deterministically generate Vesper sessionId from WhatsApp identifiers
 * Same (groupJid, senderJid) always maps to same sessionId
 */
export function getSessionId(groupJid: string, senderJid: string): string {
  return `whatsapp_${groupJid}::${senderJid}`
}

/**
 * Manage WhatsApp → Vesper session mappings with persistence
 */
export class SessionMapper {
  private mappings = new Map<string, string>() // groupJid::senderJid → sessionId
  private mappingFilePath: string

  constructor(workspacePath: string) {
    this.mappingFilePath = join(workspacePath, 'whatsapp-mappings.json')
  }

  /**
   * Load persisted mappings from disk
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.mappingFilePath, 'utf-8')
      const data = JSON.parse(content)

      for (const { key, sessionId } of data) {
        this.mappings.set(key, sessionId)
      }
    } catch (error) {
      // File doesn't exist yet - first time
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load WhatsApp mappings:', error)
      }
    }
  }

  /**
   * Persist mappings to disk
   */
  async save(): Promise<void> {
    try {
      const data = Array.from(this.mappings.entries()).map(([key, sessionId]) => ({
        key,
        sessionId,
      }))

      await writeFile(this.mappingFilePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save WhatsApp mappings:', error)
    }
  }

  /**
   * Get or create sessionId for (groupJid, senderJid)
   *
   * Logic:
   * - Same sender + same group = same sessionId (context preserved)
   * - Same sender + different group = different sessionId (new context)
   * - Different senders + same group = different sessionId (isolation)
   * - Sender leaves/rejoins group = same sessionId (context restored)
   */
  async getOrCreateSessionId(groupJid: string, senderJid: string): Promise<string> {
    const key = `${groupJid}::${senderJid}`

    // Already have mapping
    if (this.mappings.has(key)) {
      return this.mappings.get(key)!
    }

    // Create new sessionId
    const sessionId = getSessionId(groupJid, senderJid)
    this.mappings.set(key, sessionId)

    // Persist immediately
    await this.save()

    return sessionId
  }

  /**
   * Get sessionId if mapping exists, return null otherwise
   */
  getSessionId(groupJid: string, senderJid: string): string | null {
    const key = `${groupJid}::${senderJid}`
    return this.mappings.get(key) || null
  }

  /**
   * Clear all mappings (for testing or reset)
   */
  async clear(): Promise<void> {
    this.mappings.clear()
    await this.save()
  }
}
