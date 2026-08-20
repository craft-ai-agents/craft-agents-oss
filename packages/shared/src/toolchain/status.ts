/**
 * Статус-машина toolchain: снапшот для UI/CLI + emitter прогресса.
 */

import type { ToolStatus } from './types';

export type StatusListener = (status: ToolStatus) => void;

/** Простой синхронный emitter статусов инструментов. */
export class StatusEmitter {
  private listeners = new Set<StatusListener>();
  private snapshot = new Map<ToolStatus['name'], ToolStatus>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(status: ToolStatus): void {
    this.snapshot.set(status.name, status);
    for (const listener of this.listeners) listener(status);
  }

  get(name: ToolStatus['name']): ToolStatus | undefined {
    return this.snapshot.get(name);
  }

  getAll(): ToolStatus[] {
    return [...this.snapshot.values()];
  }
}
