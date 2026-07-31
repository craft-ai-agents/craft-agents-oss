import { watch, type FSWatcher } from 'fs';
import { join, basename, dirname } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { MemoryRepository } from './repository';
import type { AnyMemory } from './types';
import { ObsidianVaultSync, splitFrontmatter } from './obsidian-sync';

/**
 * Result of a single file-change sync operation.
 */
export interface WatchSyncResult {
  filePath: string;
  action: 'upserted' | 'archived' | 'skipped' | 'error';
  memoryId?: string;
  error?: string;
}

/**
 * Watcher callback fired after each debounced batch of file changes
 * is processed. The renderer can subscribe to this to refresh its
 * display.
 */
export type WatcherCallback = (results: WatchSyncResult[]) => void;

/**
 * VaultWatcher monitors the Obsidian vault directory for file changes
 * and syncs them back into the SQLite memory database (Phase 4).
 *
 * Conflict strategy:
 * - When a vault `.md` file is created/modified externally, the watcher
 *   re-imports that file into the DB. The vault file is treated as the
 *   source of truth for user edits.
 * - When a vault `.md` file is deleted, the corresponding memory is
 *   archived (not hard-deleted) so the user can restore it if the
 *   deletion was accidental.
 * - DB-driven writes (via `syncMemory`) still write to the vault, but
 *   the watcher ignores events it knows were triggered by its own
 *   sync operations to avoid feedback loops.
 *
 * Events are debounced (500ms) so rapid saves (e.g. Obsidian's
 * auto-save) don't trigger a flood of DB writes.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private vaultRoot: string;
  private repo: MemoryRepository;
  private vault: ObsidianVaultSync;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvents: Set<string> = new Set();
  private callbacks: Set<WatcherCallback> = new Set();
  private selfWritePaths: Set<string> = new Set();
  private active = false;

  constructor(vaultRoot: string, repo: MemoryRepository, vault: ObsidianVaultSync) {
    this.vaultRoot = vaultRoot;
    this.repo = repo;
    this.vault = vault;
  }

  /**
   * Start watching the vault directory. Returns true if the watcher
   * was successfully started.
   */
  start(): boolean {
    if (this.watcher) return true;
    if (!existsSync(this.vaultRoot)) return false;

    try {
      // Use recursive watch to catch changes in all class subdirectories
      this.watcher = watch(this.vaultRoot, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        const fullPath = join(this.vaultRoot, filename);
        // Ignore events from our own writes
        if (this.selfWritePaths.has(fullPath)) {
          this.selfWritePaths.delete(fullPath);
          return;
        }
        this.scheduleSync(fullPath, eventType);
      });
      this.active = true;
      return true;
    } catch {
      // Recursive watch may not be supported on all platforms
      return false;
    }
  }

  /** Stop watching and clean up. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.active = false;
    this.pendingEvents.clear();
  }

  /** Whether the watcher is currently active. */
  isActive(): boolean {
    return this.active;
  }

  /** Subscribe to sync results. Returns an unsubscribe function. */
  onSync(callback: WatcherCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Mark a path as being written by our own sync operation so the
   * watcher ignores the resulting file-change event. Called by
   * ObsidianVaultSync.syncMemory when the watcher is active.
   */
  markSelfWrite(path: string): void {
    this.selfWritePaths.add(path);
  }

  /**
   * Perform a full bidirectional sync: export all DB memories to vault,
   * then import any vault files that are newer or missing from DB.
   */
  fullSync(): WatchSyncResult[] {
    const results: WatchSyncResult[] = [];

    // 1. Export all active memories to vault
    const memories = this.repo.listMemories();
    for (const mem of memories) {
      if (mem.archived) continue;
      try {
        this.vault.syncMemory(mem);
        results.push({ filePath: this.vault.pathFor(mem), action: 'upserted', memoryId: mem.id });
      } catch (e) {
        results.push({ filePath: this.vault.pathFor(mem), action: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 2. Import any vault files that aren't in DB or are newer
    const { records, errors } = this.vault.readVault();
    const dbIds = new Set(memories.map(m => m.id));

    for (const record of records) {
      const id = record.frontmatter.id;
      if (!id) {
        results.push({ filePath: record.filePath, action: 'skipped', error: 'no id in frontmatter' });
        continue;
      }

      // Check if vault file is newer than DB record
      const dbMem = this.repo.getMemory(id);
      if (dbMem) {
        const vaultMtime = this.getFileMtime(record.filePath);
        const dbUpdated = Date.parse(dbMem.updatedAt);
        if (vaultMtime > dbUpdated) {
          // Vault file is newer — re-import
          try {
            this.importRecord(record);
            results.push({ filePath: record.filePath, action: 'upserted', memoryId: id });
          } catch (e) {
            results.push({ filePath: record.filePath, action: 'error', error: e instanceof Error ? e.message : String(e) });
          }
        }
      } else if (!dbIds.has(id)) {
        // Not in DB — import as new
        try {
          this.importRecord(record);
          results.push({ filePath: record.filePath, action: 'upserted', memoryId: id });
        } catch (e) {
          results.push({ filePath: record.filePath, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // Surface read errors
    for (const err of errors) {
      results.push({ filePath: err.filePath, action: 'error', error: err.message });
    }

    return results;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private scheduleSync(filePath: string, _eventType: string): void {
    this.pendingEvents.add(filePath);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const paths = [...this.pendingEvents];
      this.pendingEvents.clear();
      this.debounceTimer = null;
      const results = paths.map(p => this.syncFile(p));
      this.callbacks.forEach(cb => cb(results));
    }, 500);
  }

  private syncFile(filePath: string): WatchSyncResult {
    try {
      if (!existsSync(filePath)) {
        // File was deleted — archive the corresponding memory
        return this.handleFileDeleted(filePath);
      }
      return this.handleFileChanged(filePath);
    } catch (e) {
      return { filePath, action: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  private handleFileChanged(filePath: string): WatchSyncResult {
    const raw = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = splitFrontmatter(raw, filePath);
    const id = frontmatter.id;
    if (!id) {
      return { filePath, action: 'skipped', error: 'no id in frontmatter' };
    }

    // Parse and upsert into DB
    try {
      this.importRecord({ filePath, frontmatter, body });
      return { filePath, action: 'upserted', memoryId: id };
    } catch (e) {
      return { filePath, action: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  private handleFileDeleted(filePath: string): WatchSyncResult {
    // Try to find the memory by its file path pattern
    // The filename format is `{title}_{id}.md`
    const filename = basename(filePath, '.md');
    const lastUnderscore = filename.lastIndexOf('_');
    if (lastUnderscore < 0) {
      return { filePath, action: 'skipped', error: 'cannot extract memory id from filename' };
    }
    const memoryId = filename.slice(lastUnderscore + 1);

    const mem = this.repo.getMemory(memoryId);
    if (!mem) {
      return { filePath, action: 'skipped', error: 'memory not found' };
    }
    if (!mem.archived) {
      this.repo.archiveMemory(memoryId);
      return { filePath, action: 'archived', memoryId };
    }
    return { filePath, action: 'skipped', memoryId, error: 'already archived' };
  }

  /**
   * Import a single vault file record into the DB using the repository's
   * bulk importer. Delegates to `importMemories` with a single-element
   * array for transactional safety.
   */
  private importRecord(record: { filePath: string; frontmatter: Record<string, string>; body: string }): void {
    this.repo.importMemories([record], 'vault-watcher');
  }

  private getFileMtime(filePath: string): number {
    try {
      const stat = require('fs').statSync(filePath);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Reconcile vault files against DB — find vault files that have no
   * corresponding DB memory (orphaned vault files) and DB memories that
   * have no corresponding vault file (missing vault files).
   */
  reconcile(): { orphanedVaultFiles: string[]; missingVaultFiles: string[] } {
    const { records } = this.vault.readVault();
    const vaultIds = new Set(records.map(r => r.frontmatter.id).filter(Boolean));
    const dbMemories = this.repo.listMemories();
    const dbIds = new Set(dbMemories.map(m => m.id));

    const orphanedVaultFiles = records
      .filter(r => r.frontmatter.id && !dbIds.has(r.frontmatter.id))
      .map(r => r.filePath);

    const missingVaultFiles = dbMemories
      .filter(m => !m.archived && !vaultIds.has(m.id))
      .map(m => this.vault.pathFor(m));

    return { orphanedVaultFiles, missingVaultFiles };
  }
}