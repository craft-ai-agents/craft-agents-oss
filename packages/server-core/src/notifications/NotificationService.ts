/**
 * NotificationService — backend store + broadcast for workspace bell entries.
 *
 * Persists to `<workspaceRoot>/notifications.json` (atomic write). Per-workspace
 * mutex serializes read-modify-write. Caps the file at 500 entries (oldest
 * cleared/acknowledged dropped first).
 *
 * Dedupe: on `add`, an existing entry with the same (message, goalSlug ?? null)
 * created within the last hour and not yet cleared is bumped to "now" instead
 * of producing a duplicate.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RpcServer } from '@craft-agent/server-core/transport';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { NotificationEntry } from '@craft-agent/shared/notifications/types';
import type { PulseTickEntry } from '@craft-agent/shared/pulses';

const NOTIFICATIONS_FILE = 'notifications.json';
const MAX_ENTRIES = 500;
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export interface NotificationServiceDeps {
  getWorkspaceRootPath: (workspaceId: string) => string;
  emitUpdated?: (workspaceId: string, entries: NotificationEntry[]) => void;
}

function writeFileAtomic(finalPath: string, data: string): void {
  mkdirSync(dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, data, 'utf-8');
    renameSync(tmpPath, finalPath);
  } catch (err) {
    try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

export class NotificationService {
  // Per-workspace serialization. All read-modify-write paths in this service
  // are synchronous (writeFileSync + renameSync), so JS's single-threaded
  // event loop already prevents interleaving between calls. The map is kept
  // as a documented serialization point — switching to async IO later only
  // requires wrapping each method body in `withMutex(...)`.
  private readonly mutexes = new Map<string, true>();

  constructor(private readonly deps: NotificationServiceDeps) {}

  private lock<T>(workspaceId: string, fn: () => T): T {
    if (this.mutexes.get(workspaceId)) {
      throw new Error(`re-entrant NotificationService call for workspace ${workspaceId}`);
    }
    this.mutexes.set(workspaceId, true);
    try {
      return fn();
    } finally {
      this.mutexes.delete(workspaceId);
    }
  }

  private filePath(workspaceId: string): string {
    return join(this.deps.getWorkspaceRootPath(workspaceId), NOTIFICATIONS_FILE);
  }

  private readAll(workspaceId: string): NotificationEntry[] {
    const path = this.filePath(workspaceId);
    if (!existsSync(path)) return [];
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as NotificationEntry[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(workspaceId: string, entries: NotificationEntry[]): void {
    const capped = this.cap(entries);
    writeFileAtomic(this.filePath(workspaceId), JSON.stringify(capped, null, 2) + '\n');
  }

  private cap(entries: NotificationEntry[]): NotificationEntry[] {
    if (entries.length <= MAX_ENTRIES) return entries;
    const sorted = [...entries].sort((a, b) => {
      const aDrop = a.clearedAt ? 0 : a.acknowledgedAt ? 1 : 2;
      const bDrop = b.clearedAt ? 0 : b.acknowledgedAt ? 1 : 2;
      if (aDrop !== bDrop) return aDrop - bDrop;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return sorted.slice(sorted.length - MAX_ENTRIES);
  }

  list(workspaceId: string): NotificationEntry[] {
    return this.sortNewestFirst(this.readAll(workspaceId));
  }

  private sortNewestFirst(entries: NotificationEntry[]): NotificationEntry[] {
    return [...entries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private emit(workspaceId: string): void {
    this.deps.emitUpdated?.(workspaceId, this.list(workspaceId));
  }

  add(input: Omit<NotificationEntry, 'id' | 'createdAt'>): NotificationEntry {
    const workspaceId = input.workspaceId;
    const entry = this.lock(workspaceId, () => {
      const entries = this.readAll(workspaceId);
      const now = new Date();
      const cutoff = now.getTime() - DEDUPE_WINDOW_MS;

      // Dedupe key choice:
      //
      // For Pulse-sourced entries we key by (pulseId, goalSlug) — NOT by
      // verbatim message text. LLM-generated messages drift between ticks
      // ("launch goal stalled" vs "launch hasn't moved in 5 days"), so a
      // strict-string match was practically a no-op for repeated concerns.
      //
      // For non-pulse entries we keep the message-text key since they're
      // typically deterministic system strings.
      const isPulseSource = input.source === 'pulse' && Boolean(input.pulseId);
      const goalKey = input.goalSlug ?? null;
      const existing = entries.find((e) => {
        if (e.clearedAt) return false;
        if (e.awaitingResponse !== input.awaitingResponse) return false;
        if (new Date(e.createdAt).getTime() < cutoff) return false;
        if (isPulseSource) {
          return e.source === 'pulse' && e.pulseId === input.pulseId && (e.goalSlug ?? null) === goalKey;
        }
        return e.source === input.source && e.message === input.message && (e.goalSlug ?? null) === goalKey;
      });

      if (existing) {
        existing.createdAt = now.toISOString();
        // For pulse-source dedupe, also refresh the message text and
        // metadata so the user always sees the latest phrasing of an
        // ongoing concern.
        if (isPulseSource) {
          existing.message = input.message;
          existing.urgency = input.urgency;
          if (input.workflowRunId) existing.workflowRunId = input.workflowRunId;
          if (input.workflowSlug) existing.workflowSlug = input.workflowSlug;
        }
        this.writeAll(workspaceId, entries);
        return existing;
      }

      const created: NotificationEntry = {
        ...input,
        id: randomUUID(),
        createdAt: now.toISOString(),
      };
      entries.push(created);
      this.writeAll(workspaceId, entries);
      return created;
    });
    this.emit(workspaceId);
    return entry;
  }

  acknowledge(workspaceId: string, id: string): NotificationEntry | null {
    const result = this.lock(workspaceId, () => {
      const entries = this.readAll(workspaceId);
      const entry = entries.find((e) => e.id === id);
      if (!entry) return null;
      entry.acknowledgedAt = new Date().toISOString();
      this.writeAll(workspaceId, entries);
      return entry;
    });
    if (result) this.emit(workspaceId);
    return result;
  }

  clear(workspaceId: string, id: string): boolean {
    const removed = this.lock(workspaceId, () => {
      const entries = this.readAll(workspaceId);
      const entry = entries.find((e) => e.id === id);
      if (!entry) return false;
      entry.clearedAt = new Date().toISOString();
      this.writeAll(workspaceId, entries);
      return true;
    });
    if (removed) this.emit(workspaceId);
    return removed;
  }

  /**
   * Clear bell entries for a workspace.
   *
   * Default behavior (`force: false`) clears only **unread** entries —
   * i.e. those without an `acknowledgedAt`. A user who acknowledged
   * something to keep it for reference and then clicks "Clear all" intends
   * to dismiss only the unread items. Pass `force: true` to nuke
   * acknowledged entries too.
   *
   * Already-cleared entries are never re-cleared.
   */
  clearAll(workspaceId: string, options: { force?: boolean } = {}): number {
    const force = options.force === true;
    const count = this.lock(workspaceId, () => {
      const entries = this.readAll(workspaceId);
      const now = new Date().toISOString();
      const isClearable = (e: NotificationEntry): boolean => {
        if (e.clearedAt) return false;
        if (force) return true;
        return !e.acknowledgedAt;
      };
      const n = entries.filter(isClearable).length;
      for (const e of entries) {
        if (isClearable(e)) e.clearedAt = now;
      }
      this.writeAll(workspaceId, entries);
      return n;
    });
    if (count > 0) this.emit(workspaceId);
    return count;
  }

  recordResponse(workspaceId: string, id: string, response: string): NotificationEntry | null {
    const result = this.lock(workspaceId, () => {
      const entries = this.readAll(workspaceId);
      const entry = entries.find((e) => e.id === id);
      if (!entry || !entry.awaitingResponse) return null;
      entry.userResponse = response;
      entry.awaitingResponse = false;
      entry.acknowledgedAt = entry.acknowledgedAt ?? new Date().toISOString();
      this.writeAll(workspaceId, entries);
      return entry;
    });
    if (result) this.emit(workspaceId);
    return result;
  }
}

export function pushNotificationsUpdated(
  server: RpcServer,
  workspaceId: string,
  entries: NotificationEntry[],
): void {
  server.push(
    RPC_CHANNELS.notifications.UPDATED,
    { to: 'workspace', workspaceId },
    workspaceId,
    entries,
  );
}

export function pushPulseTick(server: RpcServer, workspaceId: string, tick: PulseTickEntry): void {
  server.push(
    RPC_CHANNELS.pulses.TICK,
    { to: 'workspace', workspaceId },
    workspaceId,
    tick,
  );
}
