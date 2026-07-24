import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import type { AnyMemory } from './types';

const VAULT_DIR = 'OwnerAgent';

function memoryToMarkdown(memory: AnyMemory): string {
  const tags = memory.tags.map((t) => `#${t}`).join(' ');
  const frontmatter = `---
id: ${memory.id}
class: ${memory.class}
scope: ${memory.scope}
scopeId: ${memory.scopeId ?? ''}
confidence: ${memory.confidence}
sensitivity: ${memory.sensitivity}
tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]
createdAt: ${memory.createdAt}
updatedAt: ${memory.updatedAt}
archived: ${memory.archived}
source_session: ${memory.source?.sessionId ?? ''}
source_message: ${memory.source?.messageId ?? ''}
---`;

  return `${frontmatter}\n\n# ${memory.title}\n\n${memory.content}\n\n${tags ? `Tags: ${tags}\n` : ''}`;
}

export class ObsidianVaultSync {
  private vaultRoot: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
    for (const cls of ['profile', 'semantic', 'episodic', 'procedural']) {
      const dir = join(this.vaultRoot, cls);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  static createSync(vaultRoot: string): ObsidianVaultSync {
    return new ObsidianVaultSync(vaultRoot);
  }

  private getPath(memory: AnyMemory): string {
    const safeTitle = memory.title.replace(/[\\/:*?"\u003c\u003e|]/g, '_').substring(0, 80);
    return join(this.vaultRoot, memory.class, `${safeTitle}_${memory.id}.md`);
  }

  syncMemory(memory: AnyMemory): void {
    const path = this.getPath(memory);
    writeFileSync(path, memoryToMarkdown(memory), 'utf-8');
  }

  syncAll(memories: AnyMemory[]): void {
    for (const m of memories) this.syncMemory(m);
  }

  removeMemory(memory: AnyMemory): void {
    const path = this.getPath(memory);
    if (existsSync(path)) rmSync(path);
  }

  /** Read vault files back into basic memory objects (for re-indexing) */
  readVault(): Array<{ id: string; class: string; title: string; content: string; tags: string[] }> {
    const result: Array<{ id: string; class: string; title: string; content: string; tags: string[] }> = [];
    for (const cls of ['profile', 'semantic', 'episodic', 'procedural']) {
      const dir = join(this.vaultRoot, cls);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const raw = readFileSync(join(dir, file), 'utf-8');
        const idMatch = raw.match(/^id:\s*(.+)$/m);
        const classMatch = raw.match(/^class:\s*(.+)$/m);
        const titleMatch = raw.match(/^#\s*(.+)$/m);
        const tagsMatch = raw.match(/^tags:\s*\[(.+?)\]\s*$/m);
        const content = raw.split('---').slice(2).join('---').trim();
        result.push({
          id: idMatch?.[1]?.trim() ?? file,
          class: classMatch?.[1]?.trim() ?? cls,
          title: titleMatch?.[1]?.trim() ?? 'Untitled',
          content,
          tags: tagsMatch?.[1]?.split(',').map((t) => t.trim().replace(/"/g, '')) ?? [],
        });
      }
    }
    return result;
  }
}
