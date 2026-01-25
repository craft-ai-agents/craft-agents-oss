import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TelegramSessionId } from './types'

/**
 * Deterministically generate Vesper sessionId from Telegram identifiers
 * Same (chatId, userId) always maps to same sessionId
 */
export function getSessionId(chatId: number, userId: number): string {
  return `telegram_${chatId}::${userId}`
}

/**
 * Manage Telegram → Vesper session mappings with persistence
 */
export class SessionMapper {
  private mappings = new Map<string, string>() // chatId::userId → sessionId
  private mappingFilePath: string

  constructor(workspacePath: string) {
    this.mappingFilePath = join(workspacePath, 'telegram-mappings.json')
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
        console.error('Failed to load Telegram mappings:', error)
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
      console.error('Failed to save Telegram mappings:', error)
    }
  }

  /**
   * Get or create sessionId for (chatId, userId)
   *
   * Logic:
   * - Same sender + same chat = same sessionId (context preserved)
   * - Same sender + different chat = different sessionId (new context)
   * - Different senders + same chat = different sessionId (isolation)
   */
  async getOrCreateSessionId(chatId: number, userId: number): Promise<string> {
    const key = `${chatId}::${userId}`

    // Already have mapping
    if (this.mappings.has(key)) {
      return this.mappings.get(key)!
    }

    // Create new sessionId
    const sessionId = getSessionId(chatId, userId)
    this.mappings.set(key, sessionId)

    // Persist immediately
    await this.save()

    return sessionId
  }

  /**
   * Get sessionId if mapping exists, return null otherwise
   */
  getSessionId(chatId: number, userId: number): string | null {
    const key = `${chatId}::${userId}`
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
