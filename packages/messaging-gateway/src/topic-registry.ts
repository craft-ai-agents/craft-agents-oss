/**
 * TopicRegistry — workspace-scoped cache of automation forum topics.
 *
 * Each entry maps a user-specified topic name to a Telegram forum-topic
 * thread ID. The first time a name is requested for a workspace, the
 * registry calls the supplied `createTopic` callback and persists the
 * resulting threadId. Subsequent requests for the same name return the
 * cached entry — so multiple automations sharing a `telegramTopic`
 * value share one topic.
 *
 * Storage: `{messagingDir}/topic-registry.json`
 *
 * Concurrency: an in-memory async mutex per `(workspaceId, topicName)`
 * serializes simultaneous create-or-reuse requests, so two automation
 * runs racing on the same name only create the topic once.
 *
 * Errors raised by `createTopic` propagate to the caller (so the
 * caller can surface "no Manage Topics permission" etc. without
 * the registry making a policy decision).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MessagingLogger } from './types'

export interface AutomationTopicEntry {
  /** User-specified topic name (case-sensitive). The cache key together with workspaceId. */
  topicName: string
  platform: 'telegram'
  /** Telegram chat ID of the supergroup hosting this topic. */
  chatId: string
  /** Telegram `message_thread_id` returned by `createForumTopic`. */
  threadId: number
  createdAt: number
  lastUsedAt: number
}

interface RegistryFileShape {
  version: 1
  entries: AutomationTopicEntry[]
}

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

const FILE_NAME = 'topic-registry.json'

export class TopicRegistry {
  private readonly filePath: string
  private readonly dirPath: string
  private readonly log: MessagingLogger
  /** Cache: keyed by `topicName`. One workspace per registry instance. */
  private byName = new Map<string, AutomationTopicEntry>()
  /** In-flight find-or-create promises per topic name, used as a mutex. */
  private inflight = new Map<string, Promise<AutomationTopicEntry>>()

  constructor(storageDir: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, FILE_NAME)
    this.log = logger
    this.load()
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  get(topicName: string): AutomationTopicEntry | undefined {
    return this.byName.get(topicName)
  }

  list(): AutomationTopicEntry[] {
    return Array.from(this.byName.values())
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /**
   * Return the cached entry for `topicName`; if none exists, call
   * `createTopic(topicName)` to create a forum topic in `chatId`,
   * persist the result, and return the new entry.
   *
   * Concurrent calls with the same name share the same in-flight
   * promise — only one `createTopic` call is made.
   */
  async findOrCreate(args: {
    topicName: string
    chatId: string
    createTopic: (name: string) => Promise<{ threadId: number; name: string }>
  }): Promise<AutomationTopicEntry> {
    const { topicName, chatId, createTopic } = args

    const existing = this.byName.get(topicName)
    if (existing) {
      // Touch lastUsedAt — best-effort, don't block on persistence
      existing.lastUsedAt = Date.now()
      this.save()
      return existing
    }

    const inflight = this.inflight.get(topicName)
    if (inflight) return inflight

    const promise = (async (): Promise<AutomationTopicEntry> => {
      // Re-check inside the mutex in case another caller raced us between
      // the get() above and the inflight set below.
      const racedExisting = this.byName.get(topicName)
      if (racedExisting) {
        racedExisting.lastUsedAt = Date.now()
        this.save()
        return racedExisting
      }

      const created = await createTopic(topicName)
      const now = Date.now()
      const entry: AutomationTopicEntry = {
        topicName,
        platform: 'telegram',
        chatId,
        threadId: created.threadId,
        createdAt: now,
        lastUsedAt: now,
      }
      this.byName.set(topicName, entry)
      this.save()
      this.log.info('topic created', {
        event: 'topic_created',
        topicName,
        chatId,
        threadId: entry.threadId,
      })
      return entry
    })()

    this.inflight.set(topicName, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(topicName)
    }
  }

  async remove(topicName: string): Promise<void> {
    if (!this.byName.delete(topicName)) return
    this.save()
    this.log.info('topic entry removed', {
      event: 'topic_removed',
      topicName,
    })
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as RegistryFileShape
      if (!parsed?.entries || !Array.isArray(parsed.entries)) return
      for (const entry of parsed.entries) {
        if (typeof entry?.topicName !== 'string') continue
        if (typeof entry.threadId !== 'number') continue
        if (typeof entry.chatId !== 'string') continue
        this.byName.set(entry.topicName, {
          topicName: entry.topicName,
          platform: 'telegram',
          chatId: entry.chatId,
          threadId: entry.threadId,
          createdAt: entry.createdAt ?? Date.now(),
          lastUsedAt: entry.lastUsedAt ?? entry.createdAt ?? Date.now(),
        })
      }
    } catch (err) {
      this.log.error('failed to load topic registry; ignoring file', {
        event: 'topic_registry_load_failed',
        path: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dirPath, { recursive: true })
      const payload: RegistryFileShape = {
        version: 1,
        entries: Array.from(this.byName.values()),
      }
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (err) {
      this.log.error('failed to save topic registry', {
        event: 'topic_registry_save_failed',
        path: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
